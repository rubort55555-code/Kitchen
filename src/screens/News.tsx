// «Что нового»: окно после обновления; открывается и вручную из «Ещё → О приложении».
import { useEffect } from "react";
import { Sheet } from "../components/ui";
import { markNewsSeen } from "../lib/store";
import { LATEST } from "../lib/whatsnew";
import { closeSheet } from "../lib/ui";

export function NewsSheet() {
  useEffect(() => { markNewsSeen(LATEST.id); }, []);
  return (
    <Sheet title="Что нового">
      <div style={{ paddingTop: 8 }}>
        <h2>{LATEST.title}</h2>
        <ul style={{ lineHeight: 1.5 }}>{LATEST.items.map((x) => <li key={x}>{x}</li>)}</ul>
        {LATEST.note && <div className="issue little small">🔒 {LATEST.note}</div>}
        <button className="btn" onClick={closeSheet}>Понятно</button>
      </div>
    </Sheet>
  );
}
