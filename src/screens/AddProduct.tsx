// Добавление продукта за 2–3 касания: подсказки из справочника, частые продукты, последняя цена.
import { useMemo, useRef, useState } from "react";
import { Seg, Sheet } from "../components/ui";
import { addProduct, deleteProduct, frequentNames, useStore } from "../lib/store";
import { findCatalog, shelfDays, suggest } from "../lib/catalog";
import { compileRules, checkProduct } from "../lib/exclusions";
import type { CatalogItem, Place, Unit } from "../lib/types";
import { PLACES, UNITS } from "../lib/types";
import { addDays, cap, dateText, daysLeft, norm, rub, toNum, untilText, ymd } from "../lib/util";
import { quickAmounts } from "../lib/units";
import { closeSheet, openSheet, toast } from "../lib/ui";

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
  function pick(n: string) {
    const c = findCatalog(n, settings.customCatalog);
    const l = settings.lastBuy[norm(n)];
    const shown = c && norm(c.n) === norm(n) ? c.n : cap(n);
    const u: Unit = l?.unit || c?.u || "шт";
    const p: Place = l?.place || c?.p || "Холодильник";
    setName(shown);
    setUnit(u);
    setQty(l ? String(l.qty).replace(".", ",") : DEFAULT_QTY[u]);
    setPlace(p);
    setUntil(autoUntil(c, p));
    setPrice(l ? String(l.price).replace(".", ",") : "");
    setTouched({ until: false, place: false, unit: false });
    setShowSugg(false);
    setErr("");
    if (!l) setTimeout(() => priceRef.current?.focus(), 50);
  }

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
    const it = addProduct({ name: n, qty: q, unit, place, until, price: pr });
    toast(`Добавлено: ${it.name}`, () => deleteProduct(it.id));
    setName(""); setQty(""); setPrice(""); setErr(""); setShowSugg(true);
    setTouched({ until: false, place: false, unit: false });
    setUntil(addDays(ymd(), 5));
    nameRef.current?.focus();
  }

  const days = daysLeft(until);

  return (
    <Sheet title="Новый продукт">
      <div className="row2" style={{ marginTop: 8 }}>
        <button type="button" className="btn sec" onClick={() => openSheet({ kind: "receipt", mode: "photo" })}>📷 Из чека</button>
        <button type="button" className="btn sec" onClick={() => openSheet({ kind: "receipt", mode: "text" })}>📋 Текст чека</button>
      </div>
      <button type="button" className="btn ghost" onClick={() => { closeSheet(); openSheet({ kind: "recipeNew" }); }}>📖 Новый рецепт</button>
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
