// Карточка продукта: изменить количество, цену, срок, место; списать (в том числе частично).
import { useState } from "react";
import { Seg, Sheet } from "../components/ui";
import { deleteProduct, openPackage, undoWriteOff, updateProduct, useStore, valueOf, writeOff } from "../lib/store";
import { findCatalog } from "../lib/catalog";
import type { Place, Reason, Unit } from "../lib/types";
import { PLACES, UNITS } from "../lib/types";
import { addDays, dateText, num, rub, toNum, untilText, ymd } from "../lib/util";
import { qtyText, stepFor } from "../lib/units";
import { closeSheet, toast } from "../lib/ui";

export function ProductSheet({ id }: { id: string }) {
  const p = useStore((s) => s.products.find((x) => x.id === id));
  const custom = useStore((s) => s.settings.customCatalog);
  const [part, setPart] = useState<"all" | "half" | "custom">("all");
  const [custQty, setCustQty] = useState("");
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ name: "", qty: "", unit: "шт" as Unit, price: "", place: "Холодильник" as Place, until: "" as string, bought: "" });
  const [err, setErr] = useState("");

  if (!p) {
    return (<Sheet title="Продукт"><p className="empty">Этого продукта уже нет — его списали или удалили.</p></Sheet>);
  }
  const cat = findCatalog(p.name, custom);

  function startEdit() {
    setF({ name: p!.name, qty: String(p!.qty).replace(".", ","), unit: p!.unit, price: String(p!.price).replace(".", ","), place: p!.place, until: p!.until || "", bought: p!.bought });
    setErr("");
    setEdit(true);
  }
  function saveEdit() {
    const q = toNum(f.qty), pr = toNum(f.price);
    if (!f.name.trim()) return setErr("Напишите название.");
    if (q === null || q < 0) return setErr("Проверьте количество.");
    if (pr === null || pr < 0) return setErr("Проверьте цену.");
    // Цена была за купленное количество; при смене единицы считаем, что поменяли всё целиком
    updateProduct(p!.id, { name: f.name.trim(), qty: q, unit: f.unit, price: pr, place: f.place, until: f.until || null, bought: f.bought || p!.bought, ...(f.unit !== p!.unit ? { initialQty: q } : {}) });
    setEdit(false);
    toast("Сохранено");
  }

  const take = part === "all" ? p.qty : part === "half" ? Math.round((p.qty / 2) * 1000) / 1000 : toNum(custQty) ?? 0;
  function off(reason: Reason) {
    if (!(take > 0)) return setErr("Укажите, сколько списать.");
    const u = writeOff(p!.id, take, reason);
    const word = reason === "eaten" ? "съедено" : reason === "spoiled" ? "пропало" : "выброшено";
    if (u) toast(`${p!.name}: ${qtyText(Math.min(take, p!.qty), p!.unit)} — ${word}`, () => undoWriteOff(u));
    if (take >= p!.qty) closeSheet();
    setPart("all"); setCustQty(""); setErr("");
  }

  if (edit) {
    return (
      <Sheet title="Изменить" left={<button className="x l" onClick={() => setEdit(false)}>Отмена</button>} right={<button className="x" onClick={saveEdit}>Сохранить</button>}>
        <label className="f" htmlFor="eName">Название</label>
        <input id="eName" className="inp" value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} />
        <label className="f" htmlFor="eQty">Осталось</label>
        <div className="stepper">
          <button type="button" aria-label="Меньше" onClick={() => setF({ ...f, qty: num(Math.max(0, (toNum(f.qty) || 0) - stepFor(f.unit)), 3).replace(/ /g, "") })}>−</button>
          <input id="eQty" className="inp big" inputMode="decimal" value={f.qty} onChange={(e: any) => setF({ ...f, qty: e.target.value })} />
          <button type="button" aria-label="Больше" onClick={() => setF({ ...f, qty: num((toNum(f.qty) || 0) + stepFor(f.unit), 3).replace(/ /g, "") })}>+</button>
        </div>
        <Seg label="Единица" value={f.unit} onChange={(u) => setF({ ...f, unit: u })} options={UNITS.map((u) => ({ v: u, t: u }))} />
        <label className="f" htmlFor="ePrice">Цена за всё купленное ({qtyText(p.initialQty, p.unit)}), ₽</label>
        <input id="ePrice" className="inp" inputMode="decimal" value={f.price} onChange={(e: any) => setF({ ...f, price: e.target.value })} />
        <label className="f">Где хранится</label>
        <Seg label="Место" value={f.place} onChange={(pl) => setF({ ...f, place: pl })} options={PLACES.map((x) => ({ v: x, t: x }))} />
        <label className="f" htmlFor="eUntil">Годен до</label>
        <input id="eUntil" type="date" className="inp" value={f.until} onChange={(e: any) => setF({ ...f, until: e.target.value })} />
        <div className="chips">
          <button type="button" className="chip" onClick={() => setF({ ...f, until: addDays(f.until || ymd(), 1) })}>+1 день</button>
          <button type="button" className="chip" onClick={() => setF({ ...f, until: addDays(f.until || ymd(), 3) })}>+3 дня</button>
          <button type="button" className="chip" aria-pressed={!f.until} onClick={() => setF({ ...f, until: "" })}>Без срока</button>
        </div>
        <label className="f" htmlFor="eBought">Дата покупки</label>
        <input id="eBought" type="date" className="inp" value={f.bought} onChange={(e: any) => setF({ ...f, bought: e.target.value })} />
        {err && <p className="err">{err}</p>}
        <button className="btn" style={{ marginTop: 18 }} onClick={saveEdit}>Сохранить</button>
        <p className="muted small">Изменение количества здесь записывается как «Исправлено» и не попадает в потери. Чтобы отметить, что продукт съели или он пропал, используйте списание.</p>
      </Sheet>
    );
  }

  return (
    <Sheet title={p.name}>
      <div className="center" style={{ fontSize: 44, marginTop: 8 }}>{cat?.e || "🛒"}</div>
      <div className="list">
        <div className="kv"><span>Осталось</span><span>{qtyText(p.qty, p.unit)}{p.qty !== p.initialQty ? ` из ${qtyText(p.initialQty, p.unit)}` : ""}</span></div>
        <div className="kv"><span>Стоимость остатка</span><span>{rub(valueOf(p))}</span></div>
        <div className="kv"><span>Цена покупки</span><span>{rub(p.price)}</span></div>
        <div className="kv"><span>Годен до</span><span className={untilClass(p.until)}>{p.until ? `${dateText(p.until)}, ${untilText(p.until)}` : "без срока"}</span></div>
        <div className="kv"><span>Место</span><span>{p.place}</span></div>
        <div className="kv"><span>Куплено</span><span>{dateText(p.bought)}{p.opened ? ` · вскрыто ${dateText(p.opened)}` : ""}</span></div>
      </div>
      <div className="row2" style={{ marginTop: 10 }}>
        <button className="btn sec" onClick={startEdit}>Изменить</button>
        {!p.opened && <button className="btn sec" onClick={() => { openPackage(p.id); toast(cat?.o ? `Срок после вскрытия: ${cat.o} дн.` : "Отмечено: вскрыто"); }}>Вскрыли</button>}
      </div>

      <h2>Списать</h2>
      <Seg label="Сколько списать" value={part} onChange={setPart} options={[{ v: "all", t: "Всё" }, { v: "half", t: "Половину" }, { v: "custom", t: "Часть…" }]} />
      {part === "custom" && (
        <input className="inp" inputMode="decimal" placeholder={`Сколько, ${p.unit}`} value={custQty} onChange={(e: any) => { setCustQty(e.target.value); setErr(""); }} aria-label="Сколько списать" />
      )}
      {take > 0 && <p className="muted small">Спишется {qtyText(Math.min(take, p.qty), p.unit)} на {rub(p.initialQty ? (p.price * Math.min(take, p.qty)) / p.initialQty : 0)}</p>}
      {err && <p className="err">{err}</p>}
      <button className="btn" onClick={() => off("eaten")}>✓ Съели</button>
      <div className="row2" style={{ marginTop: 10 }}>
        <button className="btn danger" onClick={() => off("spoiled")}>Пропало</button>
        <button className="btn danger" onClick={() => off("thrown")}>Выбросили</button>
      </div>
      <p className="muted small">«Пропало» — испортилось или истёк срок. «Выбросили» — другая причина. Обе идут в потери.</p>
      <button className="link" style={{ color: "var(--bad)", marginTop: 12 }} onClick={() => { const snapshot = p; deleteProduct(p.id); closeSheet(); toast(`Удалено: ${snapshot.name}`); }}>Удалить (добавлен по ошибке)</button>
    </Sheet>
  );
}

function untilClass(until: string | null) {
  const n = until ? Math.round((new Date(until + "T00:00").getTime() - new Date(ymd() + "T00:00").getTime()) / 86400000) : null;
  return n === null ? "" : n < 0 ? "t-bad" : n <= 2 ? "t-soon" : "";
}
