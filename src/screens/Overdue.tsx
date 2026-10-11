// «Что с этими продуктами?» — вопрос о просроченном: съели / пропало / ещё нормальное.
import { useMemo } from "react";
import { Sheet } from "../components/ui";
import { setSettings, updateProduct, useStore, valueOf, writeOff, undoWriteOff } from "../lib/store";
import { closeSheet, toast } from "../lib/ui";
import { qtyText } from "../lib/units";
import { addDays, daysLeft, plural, rub, ymd } from "../lib/util";
import { findCatalog } from "../lib/catalog";
import type { Product } from "../lib/types";

export const isExpired = (p: Product) => { const d = daysLeft(p.until); return d !== null && d < 0; };

export function Overdue() {
  const { products, settings } = useStore((s) => s);
  const list = useMemo(() => products.filter(isExpired).sort((a, b) => (a.until || "").localeCompare(b.until || "")), [products]);
  const done = () => setSettings({ overdueAsked: ymd() });
  const close = () => { done(); closeSheet(); };

  const eaten = (p: Product) => { const u = writeOff(p.id, p.qty, "eaten"); toast(`Съели: ${p.name}`, u ? () => undoWriteOff(u) : undefined); };
  const lost = (p: Product) => { const u = writeOff(p.id, p.qty, "spoiled"); toast(`Пропало: ${p.name} — ${rub(valueOf(p))}`, u ? () => undoWriteOff(u) : undefined); };
  const more = (p: Product, d: number) => { updateProduct(p.id, { until: addDays(ymd(), d) }); toast(`${p.name}: ещё ${d} ${plural(d, "день", "дня", "дней")}`); };

  return (
    <Sheet title="Просрочено" onClose={close} right={<button className="x" onClick={close}>Позже</button>}>
      {list.length === 0 ? (
        <div className="empty"><div className="big">👍</div><p>Просроченного нет.</p><button className="btn" onClick={close}>Хорошо</button></div>
      ) : (
        <>
          <h2 style={{ marginTop: 10 }}>Что с этими продуктами?</h2>
          <p className="muted mt0">Ответ попадёт в статистику: «Пропало» считается потерей в рублях, «Съели» — нет.</p>
          {list.map((p) => {
            const d = -(daysLeft(p.until) ?? 0);
            return (
              <div key={p.id} className="card" style={{ background: "var(--card2)", boxShadow: "none" }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="ico">{findCatalog(p.name, settings.customCatalog)?.e || "🛒"}</span>
                  <div style={{ flex: 1 }}>
                    <b>{p.name}</b>
                    <div className="meta t-bad">{qtyText(p.qty, p.unit)} · {rub(valueOf(p))} · просрочено {d} {plural(d, "день", "дня", "дней")}</div>
                  </div>
                </div>
                <div className="row2" style={{ marginTop: 10 }}>
                  <button className="btn sec" onClick={() => eaten(p)}>Съели</button>
                  <button className="btn danger" onClick={() => lost(p)}>Пропало</button>
                </div>
                <div className="chips" style={{ marginTop: 6 }}>
                  <span className="muted small" style={{ alignSelf: "center" }}>Ещё нормальное:</span>
                  {[1, 3, 7].map((n) => <button key={n} className="chip" onClick={() => more(p, n)}>+{n} {n === 1 ? "день" : n === 3 ? "дня" : "дней"}</button>)}
                </div>
              </div>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
