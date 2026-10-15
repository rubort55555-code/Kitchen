// Добавление продукта за 2–3 касания: подсказки из справочника, частые продукты, последняя цена.
import { useEffect, useMemo, useRef, useState } from "react";
import { Seg, Sheet } from "../components/ui";
import { addProduct, deleteProduct, frequentNames, logScan, useStore } from "../lib/store";
import { findCatalog, shelfDays, suggest } from "../lib/catalog";
import { compileRules, checkProduct } from "../lib/exclusions";
import type { CatalogItem, Place, Unit } from "../lib/types";
import { PLACES, UNITS } from "../lib/types";
import { addDays, cap, dateText, daysLeft, norm, rub, toNum, untilText, ymd } from "../lib/util";
import { quickAmounts } from "../lib/units";
import { closeSheet, openSheet, toast } from "../lib/ui";
import { BarcodeScan, type ScanHow } from "../components/BarcodeScan";
import { lookupOff, nameFor, offPage, per100Text, OFF_CREDIT, type OffProduct } from "../lib/off";

const POPULAR = ["Молоко", "Яйца", "Хлеб", "Куриное филе", "Картофель", "Помидоры", "Огурцы", "Сыр твёрдый", "Бананы", "Творог"];
const DEFAULT_QTY: Record<Unit, string> = { г: "500", мл: "500", кг: "1", л: "1", шт: "1", уп: "1" };

/** Срок по справочнику для выбранного места. */
export function autoUntil(cat: CatalogItem | null, place: Place): string | null {
  const today = ymd();
  const d = shelfDays(cat, place);
  if (d === 0) return null;
  if (typeof d === "number") return addDays(today, d);
  return addDays(today, place === "Морозилка" ? 90 : place === "Шкаф" ? 30 : 5);
}

export function AddProduct() {
  const settings = useStore((s) => s.settings);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState<Unit>("шт");
  const [place, setPlace] = useState<Place>("Холодильник");
  const [until, setUntil] = useState<string | null>(addDays(ymd(), 5));
  const [price, setPrice] = useState("");
  const [touched, setTouched] = useState({ until: false, place: false, unit: false });
  const [err, setErr] = useState("");
  const [showSugg, setShowSugg] = useState(true);
  const nameRef = useRef<HTMLInputElement | null>(null);
  // Штрихкод: сканер открыт; найденный товар и что с поиском
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState<{ code: string; off?: OffProduct | null; status: "known" | "loading" | "found" | "none" | "offline" | "busy" | "error" } | null>(null);
  const priceRef = useRef<HTMLInputElement | null>(null);

  const frequent = useMemo(() => {
    const f = frequentNames(settings);
    return f.length >= 4 ? f : Array.from(new Set(f.concat(POPULAR))).slice(0, 10);
  }, [settings]);
  const list = useMemo(() => suggest(name, settings.customCatalog, frequent, 7), [name, settings.customCatalog, frequent]);
  const compiled = useMemo(() => compileRules(settings.rules, settings.customCatalog, settings.members), [settings]);
  const last = settings.lastBuy[norm(name)];
  const cat = useMemo(() => findCatalog(name, settings.customCatalog), [name, settings.customCatalog]);
  const banned = name.trim() ? checkProduct(name, compiled, settings.members.map((m) => m.id)) : null;

  /** Выбрали продукт из подсказок или частых: заполняем всё, что знаем. */
  function pick(n: string, pack?: { qty?: number; unit?: Unit }) {
    const c = findCatalog(n, settings.customCatalog);
    const l = settings.lastBuy[norm(n)];
    const shown = c && norm(c.n) === norm(n) ? c.n : cap(n);
    // Вес/объём с упаковки (из Open Food Facts) точнее, чем прошлая покупка
    const u: Unit = pack?.qty && pack.unit ? pack.unit : l?.unit || c?.u || "шт";
    const p: Place = l?.place || c?.p || "Холодильник";
    setName(shown);
    setUnit(u);
    setQty(pack?.qty && pack.unit ? String(pack.qty).replace(".", ",") : l ? String(l.qty).replace(".", ",") : DEFAULT_QTY[u]);
    setPlace(p);
    setUntil(autoUntil(c, p));
    setPrice(l ? String(l.price).replace(".", ",") : "");
    setTouched({ until: false, place: false, unit: false });
    setShowSugg(false);
    setErr("");
    if (!l) setTimeout(() => priceRef.current?.focus(), 50);
  }

  /** Прочитали штрихкод: сначала свои запомненные, потом Open Food Facts. */
  async function onCode(c: string, how: ScanHow, sec?: number) {
    setScan(false);
    setErr("");
    const known = settings.barcodes?.[c];
    if (known) {
      logScan({ how, code: c, result: "known", name: known.name, sec });
      setCode({ code: c, off: known.off, status: "known" });
      pick(known.name, known.off || undefined);
      return;
    }
    setCode({ code: c, status: "loading" });
    const r = await lookupOff(c);
    if (!r.ok) { logScan({ how, code: c, result: r.why, sec }); setCode({ code: c, status: r.why }); return; }
    if (!r.product) { logScan({ how, code: c, result: "none", sec }); setCode({ code: c, off: null, status: "none" }); return; }
    logScan({ how, code: c, result: "found", name: r.product.title, sec });
    setCode({ code: c, off: r.product, status: "found" });
    pick(nameFor(r.product, settings.customCatalog).name, r.product);
  }

  // Товар не нашли — сразу ставим курсор в название
  const st = code?.status;
  useEffect(() => {
    if (st === "none" || st === "offline" || st === "busy" || st === "error") nameRef.current?.focus();
  }, [st, code?.code]);

  function onName(v: string) {
    setName(v);
    setShowSugg(true);
    setErr("");
    const c = findCatalog(v, settings.customCatalog);
    if (c) {
      if (!touched.unit) setUnit(c.u);
      const p = touched.place ? place : c.p;
      if (!touched.place) setPlace(p);
      if (!touched.until) setUntil(autoUntil(c, p));
    }
  }

  function changePlace(p: Place) {
    setPlace(p);
    setTouched((t) => ({ ...t, place: true }));
    if (!touched.until) setUntil(autoUntil(cat, p));
  }

  function submit(e?: { preventDefault(): void }) {
    e?.preventDefault();
    const n = name.trim();
    const q = toNum(qty);
    const pr = toNum(price);
    if (!n) return setErr("Напишите, что за продукт.");
    if (q === null || q <= 0) return setErr("Укажите количество.");
    if (pr === null || pr < 0) { priceRef.current?.focus(); return setErr("Укажите цену — без неё не посчитать потери в рублях. Если продукт достался бесплатно, напишите 0."); }
    const bc = code && code.status !== "loading" ? { barcode: code.code, off: code.status === "found" || code.status === "none" ? code.off : undefined } : {};
    const it = addProduct({ name: n, qty: q, unit, place, until, price: pr, ...bc });
    toast(`Добавлено: ${it.name}`, () => deleteProduct(it.id));
    setName(""); setQty(""); setPrice(""); setErr(""); setShowSugg(true); setCode(null);
    setTouched({ until: false, place: false, unit: false });
    setUntil(addDays(ymd(), 5));
    nameRef.current?.focus();
  }

  const days = daysLeft(until);

  return (
    <Sheet title="Новый продукт">
      {scan
        ? <BarcodeScan onCode={onCode} onClose={() => setScan(false)} onFail={(how) => logScan({ how })} />
        : settings.beta?.barcode !== false && <button type="button" className="btn sec" style={{ marginTop: 8 }} onClick={() => { setScan(true); setCode(null); }}>▥ Сканировать штрихкод <span className="beta">проба</span></button>}
      <div className="row2" style={{ marginTop: 10 }}>
        <button type="button" className="btn sec" onClick={() => openSheet({ kind: "receipt", mode: "photo" })}>📷 Из чека</button>
        <button type="button" className="btn sec" onClick={() => openSheet({ kind: "receipt", mode: "text" })}>📋 Текст чека</button>
      </div>
      <button type="button" className="btn ghost" onClick={() => { closeSheet(); openSheet({ kind: "recipeNew" }); }}>📖 Новый рецепт</button>
      {code && <CodeCard c={code} onClear={() => setCode(null)} />}
      <form onSubmit={submit} autoComplete="off">
        <label className="f" htmlFor="pName">Что купили</label>
        <input id="pName" ref={nameRef} className="inp big" value={name} onChange={(e: any) => onName(e.target.value)} placeholder="Например, молоко" enterKeyHint="next" autoCapitalize="sentences" />
        {showSugg && (
          name.trim() ? (
            list.length > 0 && (
              <div className="sugg" role="listbox" aria-label="Подсказки">
                {list.map((c) => (
                  <button type="button" key={c.n} onClick={() => pick(c.n)}>
                    <span className="e">{c.e}</span>{c.n}
                    {settings.lastBuy[norm(c.n)] && <span className="m">{rub(settings.lastBuy[norm(c.n)].price)}</span>}
                  </button>
                ))}
              </div>
            )
          ) : (
            <>
              <label className="f">Часто покупаете</label>
              <div className="chips">
                {frequent.map((f) => {
                  const c = findCatalog(f, settings.customCatalog);
                  return <button type="button" className="chip" key={f} onClick={() => pick(f)}>{c?.e || "🛒"} {cap(f)}</button>;
                })}
              </div>
            </>
          )
        )}
        {banned && <div className="issue small">⚠️ «{banned.rule.title}» у вас в исключениях. Продукт добавится, но в рецептах его не будет.</div>}

        <label className="f" htmlFor="pQty">Сколько</label>
        <input id="pQty" className="inp big" inputMode="decimal" value={qty} onChange={(e: any) => setQty(e.target.value)} placeholder="Кол-во" />
        <Seg label="Единица" value={unit} onChange={(u) => { setUnit(u); setTouched((t) => ({ ...t, unit: true })); }} options={UNITS.map((u) => ({ v: u, t: u }))} />
        <div className="chips">
          {quickAmounts(unit).map((a) => (
            <button type="button" className="chip" key={a} aria-pressed={toNum(qty) === a} onClick={() => setQty(String(a).replace(".", ","))}>{String(a).replace(".", ",")} {unit}</button>
          ))}
        </div>

        <label className="f" htmlFor="pPrice">Цена за всё, ₽ {last && <span>· прошлый раз {rub(last.price)} за {String(last.qty).replace(".", ",")} {last.unit}</span>}</label>
        <input id="pPrice" ref={priceRef} className="inp big" inputMode="decimal" value={price} onChange={(e: any) => { setPrice(e.target.value); setErr(""); }} placeholder="Например, 89" />

        <label className="f">Где хранится</label>
        <Seg label="Место" value={place} onChange={changePlace} options={PLACES.map((p) => ({ v: p, t: p }))} />

        <label className="f" htmlFor="pUntil">Годен до {cat && !touched.until && <span>· по справочнику</span>}</label>
        <input id="pUntil" type="date" className="inp" value={until || ""} onChange={(e: any) => { setUntil(e.target.value || null); setTouched((t) => ({ ...t, until: true })); }} />
        <div className="chips">
          <button type="button" className="chip" onClick={() => { setUntil(addDays(until || ymd(), -1)); setTouched((t) => ({ ...t, until: true })); }}>−1 день</button>
          <button type="button" className="chip" onClick={() => { setUntil(addDays(until || ymd(), 1)); setTouched((t) => ({ ...t, until: true })); }}>+1 день</button>
          <button type="button" className="chip" onClick={() => { setUntil(addDays(until || ymd(), 7)); setTouched((t) => ({ ...t, until: true })); }}>+неделя</button>
          <button type="button" className="chip" aria-pressed={until === null} onClick={() => { setUntil(null); setTouched((t) => ({ ...t, until: true })); }}>Без срока</button>
        </div>
        <p className="muted small">{until ? `${dateText(until)} — ${untilText(until)}` : "Срок не важен (соль, крупы, специи)"}{days !== null && days < 0 ? " — проверьте дату" : ""}</p>

        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn" type="submit" style={{ marginTop: 16 }}>Добавить</button>
        <p className="muted small center">После добавления можно сразу вписать следующий продукт.</p>
      </form>
    </Sheet>
  );
}

/** Что нашлось по штрихкоду. Данные Open Food Facts показываем с указанием источника (условие лицензии ODbL). */
function CodeCard({ c, onClear }: { c: { code: string; off?: OffProduct | null; status: string }; onClear: () => void }) {
  const o = c.off;
  const text: Record<string, string> = {
    loading: "Ищу товар в Open Food Facts…",
    none: "Этого товара нет в базе Open Food Facts. Напишите название ниже — в следующий раз я узнаю его по коду сам.",
    offline: "Нет интернета — не могу поискать товар. Напишите название, код я запомню.",
    busy: "База Open Food Facts просит подождать минуту. Напишите название сами или попробуйте позже.",
    error: "Не получилось связаться с Open Food Facts. Напишите название сами — код я запомню.",
  };
  return (
    <div className="card code-card" role="status">
      <div className="code-top">
        <span className="muted small">Штрихкод {c.code}</span>
        <button type="button" className="link small" onClick={onClear} aria-label="Убрать штрихкод">Убрать</button>
      </div>
      {o ? (
        <>
          <div className="code-title">{o.title}{o.brand && !o.title.toLowerCase().includes(o.brand.toLowerCase()) ? `, ${o.brand}` : ""}{o.quantityText ? ` · ${o.quantityText}` : ""}</div>
          {o.per100 && <div className="small">На 100 г: {per100Text(o.per100)}</div>}
          <div className="muted small"><a href={offPage(c.code)} target="_blank" rel="noopener">{OFF_CREDIT}</a></div>
        </>
      ) : (
        <p className="small" style={{ margin: "4px 0 0" }}>{c.status === "known" ? "Этот товар вы уже покупали." : text[c.status] || ""}</p>
      )}
      {c.status === "none" && <p className="muted small" style={{ margin: "4px 0 0" }}><a href={offPage(c.code)} target="_blank" rel="noopener">Добавить товар в Open Food Facts</a> — по желанию, это поможет и другим.</p>}
    </div>
  );
}
