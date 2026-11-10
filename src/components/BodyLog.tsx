// Журнал веса и талии: форма замера, график, изменение за неделю и месяц.
import { useMemo, useState } from "react";
import { addMeasure, deleteMeasure, measuresOf, setSettings, useStore } from "../lib/store";
import { applyCheck, goalCheck } from "../lib/goalcheck";
import type { Plan } from "../lib/nutrition";
import { LIMITS, MEASURE_TITLE, changeOver, chartOf, seriesOf, trendPerWeek, type MeasureKey } from "../lib/body";
import type { Member } from "../lib/types";
import { ymd } from "../lib/util";
import { toast } from "../lib/ui";

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
const sign = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "") + fmt(Math.abs(x));
const dshort = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const num = (s: string) => { const n = Number(s.replace(",", ".")); return s.trim() && isFinite(n) ? n : undefined; };

export function BodyLog({ m, plan }: { m: Member; plan: Plan }) {
  const list = useStore((s) => measuresOf(m.id, s.settings));
  const [k, setK] = useState<MeasureKey>("weight");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(ymd());
  const [f, setF] = useState({ weight: "", waist: "", hips: "" });
  const quiet = !!m.body?.health?.eating; // при расстройстве пищевого поведения цифры динамики не показываем

  const pts = useMemo(() => seriesOf(list, k), [list, k]);
  const chart = useMemo(() => chartOf(pts, 320, 120), [pts]);
  const week = changeOver(pts, 7), month = changeOver(pts, 30), trend = trendPerWeek(pts);

  const settingsMembers = useStore((s) => s.settings.members);
  const check = !quiet && m.body ? goalCheck(m.body, plan, list) : null;
  function resolve(delta: number) {
    if (!m.body) return;
    const body = applyCheck(m.body, delta, ymd());
    setSettings({ members: settingsMembers.map((x) => (x.id === m.id ? { ...x, body } : x)) });
    toast(delta ? "Цель подстроена" : "Оставили как есть");
  }

  function save() {
    const v = { weight: num(f.weight), waist: num(f.waist), hips: num(f.hips) };
    for (const key of ["weight", "waist", "hips"] as MeasureKey[]) {
      const x = v[key];
      if (x !== undefined && (x < LIMITS[key][0] || x > LIMITS[key][1])) { toast(`${MEASURE_TITLE[key]}: от ${LIMITS[key][0]} до ${LIMITS[key][1]}`); return; }
    }
    if (v.weight === undefined && v.waist === undefined && v.hips === undefined) { toast("Введите хотя бы одно значение"); return; }
    addMeasure(m.id, { date, ...v });
    setF({ weight: "", waist: "", hips: "" });
    setOpen(false);
    toast("Замер записан");
  }

  return (
    <div className="bodylog">
      <h4 className="nut-h">Вес и талия</h4>
      <div className="seg">
        {(["weight", "waist", "hips"] as MeasureKey[]).map((x) => (
          <button key={x} aria-pressed={k === x} onClick={() => setK(x)}>{MEASURE_TITLE[x].split(",")[0]}</button>
        ))}
      </div>
      {chart && pts.length >= 2 ? (
        <svg viewBox="0 0 320 120" className="bodychart" role="img" aria-label={`График: ${MEASURE_TITLE[k]}, ${pts.length} замеров`}>
          <path d={chart.path} fill="none" stroke="var(--accent)" strokeWidth="2" />
          {chart.dots.map((d) => <circle key={d.date} cx={d.x} cy={d.y} r="3" fill="var(--accent)"><title>{`${dshort(d.date)}: ${fmt(d.v)}`}</title></circle>)}
        </svg>
      ) : (
        <p className="muted small">{pts.length ? "Один замер. График появится после второго." : "Замеров пока нет. Лучше взвешиваться утром, раз в неделю в одинаковых условиях."}</p>
      )}
      {pts.length > 0 && (
        <div className="nut-kv">
          <span>Последний замер</span><span>{fmt(pts[pts.length - 1].v)} · {dshort(pts[pts.length - 1].date)}</span>
          {!quiet && week && <><span>За неделю</span><span>{sign(week.delta)}</span></>}
          {!quiet && month && <><span>За месяц</span><span>{sign(month.delta)}</span></>}
          {!quiet && trend !== null && <><span>Тренд в неделю</span><span>{sign(trend)}</span></>}
        </div>
      )}
      {!quiet && k === "weight" && pts.length >= 2 && trend === null && <p className="muted small">Тренд появится, когда будет не меньше трёх замеров за неделю и более: вес колеблется на 1–2 кг в течение дня.</p>}
      {check && check.status !== "skip" && (
        <div className={"goalcheck " + check.status}>
          <b>Проверка цели раз в две недели</b>
          <p className="small">{check.text}</p>
          {(check.status === "stalled" || check.status === "too-fast" || check.status === "drift") && (
            <div className="row">
              {check.delta !== 0 && <button className="btn" onClick={() => resolve(check.delta)}>{check.delta > 0 ? "+" : "−"}{Math.abs(check.delta)} ккал в день</button>}
              <button className="btn sec" onClick={() => resolve(0)}>Оставить как есть</button>
            </div>
          )}
          <p className="muted small">Это эвристика приложения, не назначение врача. Вес колеблется на 1–2 кг в течение дня, поэтому ждём не меньше двух недель.</p>
        </div>
      )}
      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Скрыть" : "Записать замер"}</button>
      {open && (
        <div className="bodyform">
          <label>Дата <input type="date" value={date} max={ymd()} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Вес, кг <input inputMode="decimal" value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>
          <label>Талия, см <input inputMode="decimal" value={f.waist} onChange={(e) => setF({ ...f, waist: e.target.value })} /></label>
          <label>Бёдра, см <input inputMode="decimal" value={f.hips} onChange={(e) => setF({ ...f, hips: e.target.value })} /></label>
          <button className="btn" onClick={save}>Сохранить</button>
          <p className="muted small">Талию измеряйте посередине между нижним ребром и тазовой костью, на выдохе. Можно заполнить только то, что измерили.</p>
        </div>
      )}
      {list.length > 0 && open && (
        <ul className="small bodylist">
          {[...list].reverse().slice(0, 8).map((x) => (
            <li key={x.date}>{dshort(x.date)}: {[x.weight !== undefined && `${fmt(x.weight)} кг`, x.waist !== undefined && `талия ${fmt(x.waist)}`, x.hips !== undefined && `бёдра ${fmt(x.hips)}`].filter(Boolean).join(", ")} <button className="link small" onClick={() => deleteMeasure(m.id, x.date)}>удалить</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
