// Вкладка «Покупки»: список, подсказки, минимальные запасы, «Купил — в продукты».
import { useMemo, useState } from "react";
import { Header, Seg, Sheet, Tip } from "../components/ui";
import { deleteProduct, frequentNames, setSettings, useStore } from "../lib/store";
import { addMany, addShop, belowMin, buy, estimate, hintsFor, missingFor, parseAmount, removeShop, restoreShop, shopText, toggleShop, type BuyRow } from "../lib/shop";
import { recipesInPlan, weekDays } from "../lib/plan";
import { findCatalog, suggest } from "../lib/catalog";
import { autoUntil } from "./AddProduct";
import type { MinStock, Place, ShopItem, Unit } from "../lib/types";
import { PLACES, UNITS } from "../lib/types";
import { norm, plural, rub, toNum, ymd } from "../lib/util";
import { closeSheet, goMenu, openSheet, toast } from "../lib/ui";

export function Shop() {
  const st = useStore((s) => s);
  const list = st.settings.shop || [];
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState("");
  const [showMin, setShowMin] = useState(false);
  const open = list.filter((x) => !x.done);
  const done = list.filter((x) => x.done);
  const est = useMemo(() => estimate(list), [list, st.settings.lastBuy, st.products]);
  const low = useMemo(() => belowMin(st.settings.minStock).filter((x) => !open.some((o) => norm(o.name) === norm(x.name))), [st.settings.minStock, st.products, list]);
  const week = weekDays(ymd());
  const menuMissing = useMemo(() => missingFor(recipesInPlan(week)).filter((x) => !open.some((o) => norm(o.name) === norm(x.name))), [st.settings.plan, st.products, st.recipes, list]);
  const sugg = useMemo(() => (name.trim() ? suggest(name, st.settings.customCatalog, frequentNames(st.settings), 5) : []), [name, st.settings]);

  function add(e?: { preventDefault(): void }, n = name) {
    e?.preventDefault();
    if (!n.trim()) return;
    if (addShop(n, amount)) { setName(""); setAmount(""); setMsg(""); }
    else setMsg("Этот продукт уже есть в списке.");
  }

  // Группируем по отделам магазина (категории справочника)
  const groups = useMemo(() => {
    const g = new Map<string, ShopItem[]>();
    for (const x of open) {
      const c = findCatalog(x.name, st.settings.customCatalog)?.c || "Другое";
      g.set(c, [...(g.get(c) || []), x]);
    }
    return Array.from(g.entries()).sort((a, b) => (a[0] === "Другое" ? 1 : b[0] === "Другое" ? -1 : a[0].localeCompare(b[0], "ru")));
  }, [list, st.settings.customCatalog]);

  async function copy() {
    const t = shopText(list);
    try { await navigator.clipboard.writeText(t); toast("Список скопирован — вставьте его в мессенджер"); }
    catch { setMsg("Не удалось скопировать автоматически."); }
  }

  return (
    <div className="screen">
      <Header title="Покупки" screen="shop" sub={open.length ? `${open.length} ${plural(open.length, "позиция", "позиции", "позиций")}${est.known ? ` · примерно ${rub(est.sum)}` : ""}` : undefined} />
      <form className="card" onSubmit={add} autoComplete="off">
        <div className="field-row">
          <div style={{ flex: 2 }}><input className="inp" style={{ background: "var(--card2)" }} value={name} onChange={(e: any) => { setName(e.target.value); setMsg(""); }} placeholder="Что купить" aria-label="Что купить" enterKeyHint="done" /></div>
          <div><input className="inp" style={{ background: "var(--card2)" }} value={amount} onChange={(e: any) => setAmount(e.target.value)} placeholder="Сколько" aria-label="Сколько" /></div>
        </div>
        {sugg.length > 0 && norm(sugg[0].n) !== norm(name) && (
          <div className="chips">{sugg.map((c) => <button type="button" key={c.n} className="chip" onClick={() => add(undefined, c.n)}>{c.e} {c.n}</button>)}</div>
        )}
        {name.trim() && hintsFor(name).banned && <p className="err">⚠️ «{hintsFor(name).banned!.rule.title}» у вас в исключениях.</p>}
        {msg && <p className="err">{msg}</p>}
        <button className="btn" type="submit" style={{ marginTop: 10 }} disabled={!name.trim()}>Добавить в список</button>
      </form>

      {low.length > 0 && (
        <div className="banner warn">
          <span className="txt">Заканчивается: {low.map((x) => x.name.toLowerCase()).join(", ")}.</span>
          <button className="chip" onClick={() => { const n = addMany(low, "Запасы"); toast(`Добавлено: ${n}`); }}>В список</button>
        </div>
      )}
      {menuMissing.length > 0 && (
        <div className="banner">
          <span className="txt">Для меню на неделю не хватает: {menuMissing.slice(0, 4).map((x) => x.name.toLowerCase()).join(", ")}{menuMissing.length > 4 ? ` и ещё ${menuMissing.length - 4}` : ""}.</span>
          <button className="chip" onClick={() => { const n = addMany(menuMissing, "Меню"); toast(`Добавлено: ${n}`); }}>В список</button>
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">
          <div className="big">🛒</div>
          <p>Список пуст. Впишите, что купить, или добавьте недостающее из рецептов и меню на неделю.</p>
          <button className="link" onClick={goMenu}>Открыть меню на неделю</button>
        </div>
      ) : (
        <>
          <Tip id="shop-check">В магазине отмечайте купленное галочкой. Потом нажмите «Купил — в продукты».</Tip>
          {groups.map(([cat, items]) => (
            <section key={cat}>
              <div className="group-h"><span>{cat}</span></div>
              <div className="list">{items.map((x) => <ShopRow key={x.id} x={x} />)}</div>
            </section>
          ))}
          {done.length > 0 && (
            <>
              <div className="group-h"><span>Отмечено · {done.length}</span></div>
              <div className="list">{done.map((x) => <ShopRow key={x.id} x={x} />)}</div>
              <button className="btn" onClick={() => openSheet({ kind: "buy" })}>Купил — в продукты ({done.length})</button>
              <button className="btn ghost" onClick={() => { const before = list; restoreShop(open); toast(`Убрано: ${done.length}`, () => restoreShop(before)); }}>Просто убрать отмеченные</button>
            </>
          )}
          {open.length > 0 && <button className="btn ghost" style={{ marginTop: 10 }} onClick={copy}>Скопировать список</button>}
          {est.known > 0 && <p className="muted small center">Примерно {rub(est.sum)} по прошлым ценам (известны для {est.known} из {est.total}).</p>}
        </>
      )}

      <h2>Всегда держать дома</h2>
      <p className="muted small mt0">Когда запаса меньше, приложение предложит добавить его в список.</p>
      <div className="list">
        {(st.settings.minStock || []).map((m, i) => (
          <div key={i} className="li">
            <span className="ico">{findCatalog(m.name, st.settings.customCatalog)?.e || "📦"}</span>
            <div className="main"><div className="name">{m.name}</div><div className="meta">не меньше {String(m.qty).replace(".", ",")} {m.unit}</div></div>
            <button className="link" style={{ color: "var(--bad)" }} aria-label={`Убрать запас: ${m.name}`} onClick={() => setSettings({ minStock: st.settings.minStock.filter((_, k) => k !== i) })}>Убрать</button>
          </div>
        ))}
      </div>
      {showMin ? <MinForm onDone={() => setShowMin(false)} /> : <button className="btn sec" onClick={() => setShowMin(true)}>Добавить запас</button>}
    </div>
  );
}

function ShopRow({ x }: { x: ShopItem }) {
  const h = hintsFor(x.name);
  const e = findCatalog(x.name, useStore((s) => s.settings.customCatalog))?.e || "🛒";
  return (
    <div className="li" style={{ opacity: x.done ? 0.55 : 1 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}>
        <input type="checkbox" className="check" checked={x.done} onChange={() => toggleShop(x.id)} aria-label={`Куплено: ${x.name}`} />
        <span className="ico" style={{ width: 28, fontSize: 22 }}>{e}</span>
        <div className="main">
          <div className="name" style={{ textDecoration: x.done ? "line-through" : undefined }}>{x.name}{x.amount ? <span className="muted"> · {x.amount}</span> : null}</div>
          <div className="meta">
            {h.banned && <span className="tag bad">в исключениях</span>}
            {h.have && <span className="tag soon">дома есть: {h.have}</span>}
            {h.loss !== null && h.loss >= 0.3 && <span className="tag soon">часто пропадает — возьмите меньше</span>}
            {x.from && <span>{x.from === "Меню" || x.from === "Запасы" ? x.from.toLowerCase() : "для: " + x.from}</span>}
            {h.price !== null && <span> · ~{rub(h.price)}</span>}
          </div>
        </div>
      </label>
      <button className="link" style={{ color: "var(--muted)", fontSize: 22, padding: "4px 6px" }} aria-label={`Убрать из списка: ${x.name}`} onClick={() => removeShop(x.id)}>×</button>
    </div>
  );
}

function MinForm({ onDone }: { onDone: () => void }) {
  const min = useStore((s) => s.settings.minStock || []);
  const [n, setN] = useState("");
  const [q, setQ] = useState("");
  const [u, setU] = useState<Unit>("шт");
  const [err, setErr] = useState("");
  const save = () => {
    const qty = toNum(q);
    if (!n.trim()) return setErr("Напишите продукт.");
    if (qty === null || qty <= 0) return setErr("Укажите, сколько держать.");
    const item: MinStock = { name: n.trim(), qty, unit: u };
    setSettings({ minStock: [...min.filter((m) => norm(m.name) !== norm(item.name)), item] });
    onDone();
  };
  return (
    <div className="card">
      <input className="inp" style={{ background: "var(--card2)" }} value={n} onChange={(e: any) => { setN(e.target.value); const c = findCatalog(e.target.value); if (c) setU(c.u); }} placeholder="Продукт, например яйца" aria-label="Продукт" />
      <input className="inp" style={{ background: "var(--card2)", marginTop: 8 }} inputMode="decimal" value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Не меньше, например 10" aria-label="Сколько держать" />
      <Seg label="Единица" value={u} onChange={setU} options={UNITS.map((x) => ({ v: x, t: x }))} />
      {err && <p className="err">{err}</p>}
      <div className="row2"><button className="btn" onClick={save}>Сохранить</button><button className="btn ghost" onClick={onDone}>Отмена</button></div>
    </div>
  );
}

/** «Купил — в продукты»: проверка количества и цены каждой отмеченной строки. */
export function BuySheet() {
  const st = useStore((s) => s);
  const done = (st.settings.shop || []).filter((x) => x.done);
  const [rows, setRows] = useState<(BuyRow & { qtyT: string; priceT: string })[]>(() => done.map((x) => {
    const cat = findCatalog(x.name, st.settings.customCatalog);
    const lb = st.settings.lastBuy[norm(x.name)] || (cat ? st.settings.lastBuy[norm(cat.n)] : undefined);
    const p = parseAmount(x.amount);
    const unit: Unit = p?.unit || lb?.unit || cat?.u || "шт";
    const qty = p?.qty ?? lb?.qty ?? 1;
    const place: Place = lb?.place || cat?.p || "Холодильник";
    const name = cat && norm(cat.n) === norm(x.name) ? cat.n : x.name;
    return { id: x.id, name, qty, unit, price: lb?.price ?? 0, place, until: autoUntil(cat, place), qtyT: String(qty).replace(".", ","), priceT: lb ? String(lb.price).replace(".", ",") : "" };
  }));
  const [err, setErr] = useState("");
  const upd = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (toNum(r.priceT) || 0), 0);

  function save() {
    const out: BuyRow[] = [];
    for (const r of rows) {
      const q = toNum(r.qtyT), p = toNum(r.priceT);
      if (q === null || q <= 0) return setErr(`Проверьте количество: ${r.name}.`);
      if (p === null || p < 0) return setErr(`Укажите цену: ${r.name}. Если не знаете — напишите 0.`);
      out.push({ ...r, qty: q, price: p });
    }
    const before = st.settings.shop;
    const ids = buy(out);
    closeSheet();
    toast(`В продукты: ${ids.length} на ${rub(total)}`, () => { ids.forEach(deleteProduct); restoreShop(before); });
  }

  if (!rows.length) return <Sheet title="Купленное"><p className="empty">Нет отмеченных покупок.</p></Sheet>;
  return (
    <Sheet title="Купленное — в продукты" right={<button className="x" onClick={save}>Сохранить</button>}>
      <p className="muted small">Проверьте количество и цену. Срок годности и место подставятся сами — их можно поправить потом в продукте.</p>
      {rows.map((r, i) => (
        <div key={r.id} className="card" style={{ background: "var(--card2)", boxShadow: "none" }}>
          <h3>{findCatalog(r.name, st.settings.customCatalog)?.e || "🛒"} {r.name}</h3>
          <div className="field-row">
            <div><label className="f mt0" htmlFor={"bq" + i}>Сколько</label><input id={"bq" + i} className="inp" style={{ background: "var(--card)" }} inputMode="decimal" value={r.qtyT} onChange={(e: any) => upd(i, { qtyT: e.target.value })} /></div>
            <div><label className="f mt0" htmlFor={"bp" + i}>Цена, ₽</label><input id={"bp" + i} className="inp" style={{ background: "var(--card)" }} inputMode="decimal" value={r.priceT} placeholder="за всё" onChange={(e: any) => upd(i, { priceT: e.target.value })} /></div>
          </div>
          <Seg label="Единица" value={r.unit} onChange={(u) => upd(i, { unit: u })} options={UNITS.map((u) => ({ v: u, t: u }))} />
          <Seg label="Место" value={r.place} onChange={(pl) => upd(i, { place: pl, until: autoUntil(findCatalog(r.name, st.settings.customCatalog), pl) })} options={PLACES.map((p) => ({ v: p, t: p }))} />
        </div>
      ))}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" onClick={save}>Сохранить в продукты · {rub(total)}</button>
    </Sheet>
  );
}
