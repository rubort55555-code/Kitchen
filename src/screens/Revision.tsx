// Ревизия: быстро пройтись по продуктам и поправить остатки — «есть / меньше / нет».
import { useMemo, useRef, useState } from "react";
import { Sheet } from "../components/ui";
import { setSettings, undoWriteOff, useStore, valueOf, writeOff, type Undo } from "../lib/store";
import { closeSheet } from "../lib/ui";
import { findCatalog } from "../lib/catalog";
import { PLACES, type Product, type Reason } from "../lib/types";
import { qtyText } from "../lib/units";
import { rub, toNum, untilText, ymd } from "../lib/util";

export function Revision() {
  const { products, settings } = useStore((s) => s);
  // Список фиксируем при открытии: продукты не «убегают» из-под пальца, пока правим остатки
  const ids = useMemo(() => {
    const order = (p: Product) => PLACES.indexOf(p.place);
    return [...products].sort((a, b) => order(a) - order(b) || (a.until || "9").localeCompare(b.until || "9")).map((p) => p.id);
  }, []);
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<null | "less" | "none">(null);
  const [reason, setReason] = useState<Reason>("eaten");
  const [exact, setExact] = useState("");
  const [stat, setStat] = useState({ kept: 0, less: 0, none: 0, lostRub: 0 });
  const last = useRef<Undo | null>(null);
  const x0 = useRef<number | null>(null);

  const p = products.find((x) => x.id === ids[i]);
  const finish = () => { setSettings({ lastRevision: ymd() }); };
  const next = () => { setMode(null); setExact(""); setReason("eaten"); setI((v) => v + 1); };
  const done = i >= ids.length;

  const keep = () => { last.current = null; setStat((s) => ({ ...s, kept: s.kept + 1 })); next(); };
  const less = (newQty: number) => {
    if (!p || !(newQty >= 0) || newQty >= p.qty) return;
    const u = writeOff(p.id, Math.round((p.qty - newQty) * 1000) / 1000, reason);
    last.current = u;
    setStat((s) => ({ ...s, less: s.less + 1, lostRub: s.lostRub + (reason === "spoiled" ? valueOf(p) * (1 - newQty / p.qty) : 0) }));
    next();
  };
  const none = (r: Reason) => {
    if (!p) return;
    const v = valueOf(p);
    last.current = writeOff(p.id, p.qty, r);
    setStat((s) => ({ ...s, none: s.none + 1, lostRub: s.lostRub + (r === "spoiled" ? v : 0) }));
    next();
  };
  const back = () => {
    if (last.current) { undoWriteOff(last.current); last.current = null; }
    setMode(null); setI((v) => Math.max(0, v - 1));
  };

  if (!ids.length) return <Sheet title="Ревизия"><div className="empty"><div className="big">🧺</div><p>Продуктов пока нет — проверять нечего.</p></div></Sheet>;

  return (
    <Sheet title="Ревизия" onClose={() => { if (done) finish(); closeSheet(); }}>
      {done ? (
        <div className="center" style={{ paddingTop: 20 }}>
          <div style={{ fontSize: 56 }}>✅</div>
          <h2>Ревизия закончена</h2>
          <p className="muted">Всё в порядке: {stat.kept} · стало меньше: {stat.less} · закончилось: {stat.none}.{stat.lostRub > 0 ? ` Пропало на ${rub(stat.lostRub)}.` : ""}</p>
          <button className="btn" onClick={() => { finish(); closeSheet(); }}>Готово</button>
        </div>
      ) : !p ? (
        <div className="center" style={{ paddingTop: 20 }}><p className="muted">Продукт уже списан.</p><button className="btn" onClick={next}>Дальше</button></div>
      ) : (
        <div
          onTouchStart={(e: any) => { x0.current = e.touches[0].clientX; }}
          onTouchEnd={(e: any) => {
            if (x0.current === null || mode) return;
            const dx = e.changedTouches[0].clientX - x0.current; x0.current = null;
            if (dx > 80) keep(); else if (dx < -80) setMode("none");
          }}>
          <div className="cm-dots" aria-hidden="true">
            {ids.length <= 40 && ids.map((_, j) => <span key={j} className={j === i ? "on" : j < i ? "past" : ""} />)}
          </div>
          <p className="muted center small">{p.place} · {i + 1} из {ids.length}</p>
          <div className="center" style={{ padding: "6px 0 14px" }}>
            <div style={{ fontSize: 64 }}>{findCatalog(p.name, settings.customCatalog)?.e || "🛒"}</div>
            <h2 style={{ margin: "6px 0" }}>{p.name}</h2>
            <div className="rev-qty">{qtyText(p.qty, p.unit)}</div>
            <div className="muted">{untilText(p.until)} · {rub(valueOf(p))}</div>
          </div>

          {mode === null && (
            <>
              <button className="btn" style={{ minHeight: 60, fontSize: 20 }} onClick={keep}>✓ Есть</button>
              <div className="row2" style={{ marginTop: 10 }}>
                <button className="btn sec" style={{ minHeight: 56 }} onClick={() => setMode("less")}>Меньше</button>
                <button className="btn danger" style={{ minHeight: 56 }} onClick={() => setMode("none")}>Нет</button>
              </div>
              <p className="muted small center">Свайп вправо — «Есть», влево — «Нет».</p>
            </>
          )}
          {mode === "less" && (
            <>
              <label className="f">Сколько осталось?</label>
              <div className="chips">
                {[0.75, 0.5, 0.25].map((f) => <button key={f} className="chip" onClick={() => less(Math.round(p.qty * f * 1000) / 1000)}>{f === 0.75 ? "¾" : f === 0.5 ? "½" : "¼"} · {qtyText(Math.round(p.qty * f * 1000) / 1000, p.unit)}</button>)}
              </div>
              <div className="field-row">
                <div style={{ flex: 2 }}><input className="inp" inputMode="decimal" placeholder={`Своё, ${p.unit}`} value={exact} onChange={(e: any) => setExact(e.target.value)} aria-label="Сколько осталось" /></div>
                <div><button className="btn" disabled={toNum(exact) === null || (toNum(exact) as number) >= p.qty} onClick={() => less(toNum(exact) as number)}>ОК</button></div>
              </div>
              <label className="f">Куда делось</label>
              <div className="chips">
                <button className="chip" aria-pressed={reason === "eaten"} onClick={() => setReason("eaten")}>Съели</button>
                <button className="chip" aria-pressed={reason === "spoiled"} onClick={() => setReason("spoiled")}>Пропало</button>
              </div>
              <button className="btn ghost" onClick={() => setMode(null)}>Назад</button>
            </>
          )}
          {mode === "none" && (
            <>
              <label className="f">Что с этим продуктом?</label>
              <div className="row2">
                <button className="btn sec" style={{ minHeight: 56 }} onClick={() => none("eaten")}>Съели</button>
                <button className="btn danger" style={{ minHeight: 56 }} onClick={() => none("spoiled")}>Пропало</button>
              </div>
              <button className="btn ghost" onClick={() => setMode(null)}>Назад</button>
            </>
          )}
          {i > 0 && mode === null && <button className="link" onClick={back}>← Предыдущий{last.current ? " (отменить)" : ""}</button>}
        </div>
      )}
    </Sheet>
  );
}
