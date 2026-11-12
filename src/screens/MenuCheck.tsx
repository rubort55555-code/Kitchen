// «Насколько меню подходит»: меню на неделю против норм каждого человека, порции под человека.
import { useMemo, useState } from "react";
import { Sheet } from "../components/ui";
import { setPortion, dayShort, dayTitle } from "../lib/plan";
import { useStore } from "../lib/store";
import { PORTION_MAX, PORTION_MIN, PORTION_STEP, evaluateMenu, portionOf } from "../lib/menucheck";
import { planFor } from "../lib/nutrition";

const f = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");

export function MenuCheck({ days }: { days: string[] }) {
  const members = useStore((s) => s.settings.members);
  const settings = useStore((s) => s.settings);
  const recipes = useStore((s) => s.recipes);
  const people = useMemo(() => members.filter((m) => m.body).map((m) => ({ m, plan: planFor(m.body!) })).filter((x) => x.plan), [members]);
  const [who, setWho] = useState(people[0]?.m.id || "");
  const cur = people.find((x) => x.m.id === who) || people[0];
  const entries = (settings.plan || []).filter((e) => days.includes(e.date));
  const ev = useMemo(() => cur ? evaluateMenu(entries, days, recipes, { id: cur.m.id, body: cur.m.body! }, cur.plan!, [settings.rules, settings.customCatalog, settings.members]) : null, [entries, days, recipes, cur, settings.rules, settings.customCatalog, settings.members]);

  if (!cur || !ev) {
    return <Sheet title="Насколько меню подходит"><p className="empty muted">Заполните в «Ещё → Питание» рост, вес и цель хотя бы одному человеку — тогда я смогу сравнить меню с нормой.</p></Sheet>;
  }
  const mains = (date: string) => entries.filter((e) => e.date === date && e.recipeId);

  return (
    <Sheet title="Насколько меню подходит">
      {people.length > 1 && (
        <div className="chips">{people.map((x) => <button key={x.m.id} className="chip" aria-pressed={x.m.id === cur.m.id} onClick={() => setWho(x.m.id)}>{x.m.name}</button>)}</div>
      )}
      {ev.days === 0 ? (
        <p className="empty muted">В меню на эти дни пока нет блюд.</p>
      ) : (
        <>
          <div className="card">
            <h3>{ev.ok ? "Меню подходит" : "Меню пока не подходит"}</h3>
            <p className="small mt0">Норма: {cur.plan!.kcal} ккал, белок {cur.plan!.protein} г в день. Сначала проверяются запреты, потом калории и БЖУ, пределы, витамины и разнообразие; продукты дома выбирают только между равноценными блюдами.</p>
            {ev.levels.map((l) => (
              <details key={l.n} open={!l.ok && l.n <= 2}>
                <summary>{l.ok ? "✅" : l.n === 5 ? "💡" : "⚠️"} {l.n}. {l.title}{l.ok ? "" : ` — ${l.items.length}`}</summary>
                {l.items.map((x) => <p key={x} className="small" style={{ margin: "2px 0" }}>{x}</p>)}
              </details>
            ))}
            <p className="muted small">Порция — стандартная, на одного человека. Сколько порций съесть, выбираете вы: от {f(PORTION_MIN)} до {PORTION_MAX} с шагом {f(PORTION_STEP)}. Салат и десерт к блюду считаются одной порцией.</p>
          </div>

          {ev.dayRes.map((d) => (
            <div key={d.date} className="card">
              <h4 className="nut-h">{dayTitle(d.date)} <small className="muted">{dayShort(d.date)}</small> · {d.kcal} ккал ({d.pct}%) {d.ok ? "✅" : "⚠️"}</h4>
              <p className="muted small" style={{ margin: "2px 0" }}>Белки {d.protein} г{d.proteinOk ? "" : " (мало)"} · жиры {d.fat} г{d.fatOk ? "" : " (вне нормы)"} · углеводы {d.carbs} г{d.carbsOk ? "" : " (вне нормы)"}</p>
              {mains(d.date).map((e) => {
                const p = portionOf(e, cur.m.id);
                return (
                  <div key={e.id} className="arow">
                    <span>{e.name}{e.garnish ? <small className="muted"> + {e.garnish.name}</small> : ""}</span>
                    <span className="wbtn">
                      <button className="chip" aria-label={`Меньше: ${e.name}`} disabled={p <= PORTION_MIN} onClick={() => setPortion(e.id, cur.m.id, p - PORTION_STEP)}>−</button>
                      <b style={{ margin: "0 6px" }}>{f(p)}</b>
                      <button className="chip" aria-label={`Больше: ${e.name}`} disabled={p >= PORTION_MAX} onClick={() => setPortion(e.id, cur.m.id, p + PORTION_STEP)}>+</button>
                    </span>
                    <span />
                  </div>
                );
              })}
            </div>
          ))}

          <div className="card">
            <h3>В среднем за неделю</h3>
            {ev.limits.map((r) => <div key={r.key} className="arow"><span>{r.title}</span><span><b>{f(r.v)}</b> ≤ {f(r.target)} {r.unit}</span><span className={"pill st-" + r.status}>{r.status === "ok" ? "в пределе" : "выше"}</span></div>)}
            {ev.lacking.length > 0 && <h4 className="nut-h">Не хватает (ниже 90% нормы)</h4>}
            {ev.lacking.map((r) => <div key={r.key} className="arow"><span>{r.title}</span><span><b>{f(r.v)}</b> из {f(r.target)} {r.unit}</span><span className="pill st-low">{r.pct}%</span></div>)}
            {ev.lacking.length === 0 && <p className="small">По витаминам, минералам и клетчатке всё не ниже 90% нормы.</p>}
            {ev.noData.length > 0 && <p className="muted small">Нет данных о составе блюд меню: {ev.noData.join(", ").toLowerCase()} — их не оцениваем.</p>}
          </div>
          {ev.unknown.length > 0 && <div className="issue little small">⚠️ Не посчитаны блюда без рецепта: {ev.unknown.join(", ")}.</div>}
          <p className="muted small">Нормы — МР 2.3.1.0253-21. Калории блюд — ориентировочные. Оценка не заменяет врача.</p>
        </>
      )}
    </Sheet>
  );
}
