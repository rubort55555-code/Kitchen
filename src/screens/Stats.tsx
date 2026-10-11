// Статистика: съедено / пропало / осталось — в количестве и в рублях, динамика, топ потерь, цены, находки.
import { useMemo, useState } from "react";
import { Header, Seg } from "../components/ui";
import { useStore } from "../lib/store";
import { goPage } from "../lib/ui";
import { PERIOD_TEXT, amountText, byMonth, insights, periodDays, periodStart, priceTrends, report, type Period } from "../lib/stats";
import { rub } from "../lib/util";

function Bars({ rows, pick, color }: { rows: { label: string; v: number }[]; pick?: string; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="sbars" role="img" aria-label={rows.map((r) => `${r.label}: ${rub(r.v)}`).join(", ")}>
      {rows.map((r, i) => (
        <div key={i} className="sbar">
          <span className="v">{r.v ? rub(r.v).replace(/\s?₽/, "") : ""}</span>
          <div className="col"><i style={{ height: Math.max(r.v ? 4 : 0, (r.v / max) * 100) + "%", background: color }} /></div>
          <span className="l">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Stats() {
  const { log, products } = useStore((s) => s);
  const [p, setP] = useState<Period>("month");
  const rep = useMemo(() => report(log, products, periodStart(p)), [log, products, p]);
  const months = useMemo(() => byMonth(log), [log]);
  const prices = useMemo(() => priceTrends(log).slice(0, 5), [log]);
  const tips = useMemo(() => insights(log, rep, periodDays(p)), [log, rep, p]);
  const empty = log.length === 0;
  const used = rep.eaten.rub + rep.lost.rub;
  return (
    <div className="screen">
      <Header title="Статистика" screen="stats" onBack={() => goPage(null)} backText="Ещё" />
      <Seg label="Период" value={p} onChange={setP} options={(Object.keys(PERIOD_TEXT) as Period[]).map((v) => ({ v, t: PERIOD_TEXT[v] }))} />
      {empty ? (
        <div className="empty"><div className="big">📊</div><p>Пока нечего считать. Добавляйте продукты и списывайте их — здесь появятся цифры. Чтобы посмотреть, как это выглядит, загрузите демо-данные в «Ещё → Данные».</p></div>
      ) : (
        <>
          <div className="card">
            <div className={"hero" + (rep.lost.rub > 0 ? " bad" : "")}>
              <b>{rub(rep.lost.rub)}</b>
              <span className="muted">{rep.lost.rub > 0 ? `пропало · ${rep.lostPct}% от использованного` : "ничего не пропало"}</span>
            </div>
            <div className="stats3">
              <div><b>{rub(rep.bought.rub)}</b><span>куплено</span></div>
              <div><b>{rub(rep.eaten.rub)}</b><span>съедено</span></div>
              <div><b>{rub(rep.left.rub)}</b><span>осталось</span></div>
            </div>
            <table className="qt">
              <tbody>
                <tr><td>Куплено</td><td>{amountText(rep.bought.amount)}</td><td>{rep.bought.n} {rep.bought.n === 1 ? "покупка" : "покупок"}</td></tr>
                <tr><td>Съедено и приготовлено</td><td>{amountText(rep.eaten.amount)}</td><td>{rub(rep.eaten.rub)}</td></tr>
                <tr><td>Пропало и выброшено</td><td>{amountText(rep.lost.amount)}</td><td className={rep.lost.rub ? "t-bad" : ""}>{rub(rep.lost.rub)}</td></tr>
                <tr><td>Осталось дома</td><td>{rep.left.n} {rep.left.n === 1 ? "продукт" : "продуктов"}</td><td>{rub(rep.left.rub)}</td></tr>
              </tbody>
            </table>
            {used > 0 && (
              <div className="split" aria-hidden="true"><i style={{ width: (rep.eaten.rub / used) * 100 + "%" }} /><i className="bad" style={{ width: (rep.lost.rub / used) * 100 + "%" }} /></div>
            )}
          </div>

          {tips.length > 0 && (
            <div className="card">
              <h3>Находки</h3>
              {tips.map((t, i) => <p key={i} className="tip">💡 {t}</p>)}
            </div>
          )}

          <div className="card">
            <h3>Потери по месяцам</h3>
            <Bars rows={months.map((m) => ({ label: m.label, v: m.lost }))} color="var(--bad)" />
            <p className="muted small">Процент потерь: {months.map((m) => `${m.label} ${m.pct}%`).join(" · ")}</p>
          </div>

          <div className="card">
            <h3>Расходы на продукты</h3>
            <Bars rows={months.map((m) => ({ label: m.label, v: m.bought }))} color="var(--accent)" />
          </div>

          <div className="card">
            <h3>Что пропадает чаще всего</h3>
            {rep.topLost.length === 0 ? <p className="muted mt0">За этот период ничего.</p> : rep.topLost.map((t) => (
              <div key={t.name} className="ing"><span>{t.name} <span className="muted small">· {amountText(t.amount)}, {t.n} раз</span></span><span className="a t-bad">{rub(t.rub)}</span></div>
            ))}
          </div>

          {rep.byPlace.length > 0 && (
            <div className="card">
              <h3>Где пропадает</h3>
              {rep.byPlace.map((x) => <div key={x.place} className="ing"><span>{x.place}</span><span className="a">{rub(x.rub)}</span></div>)}
            </div>
          )}

          {rep.byCategory.length > 0 && (
            <div className="card">
              <h3>По категориям</h3>
              {rep.byCategory.map((x) => (
                <div key={x.cat} className="ing"><span>{x.cat}</span><span className="a">съедено {rub(x.eaten)}{x.lost ? <> · <span className="t-bad">пропало {rub(x.lost)}</span></> : null}</span></div>
              ))}
            </div>
          )}

          <div className="card">
            <h3>Цены</h3>
            {prices.length === 0 ? <p className="muted mt0">Появятся, когда один продукт куплен два раза и больше.</p> : prices.map((x) => (
              <div key={x.name + x.unit} className="ing">
                <span>{x.name} <span className="muted small">· за {x.unit}</span></span>
                <span className="a">{rub(x.last)} <span className={x.changePct > 0 ? "t-bad" : x.changePct < 0 ? "t-ok" : ""}>{x.changePct > 0 ? "▲" : x.changePct < 0 ? "▼" : ""}{x.changePct ? Math.abs(x.changePct) + "%" : ""}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
