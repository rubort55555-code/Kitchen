// Экран «Питание» (пробная функция): профиль каждого члена семьи и личные нормы на день.
import { useState } from "react";
import { Header, Seg, Sheet } from "../components/ui";
import { setSettings, useStore } from "../lib/store";
import { goPage } from "../lib/ui";
import type { Member } from "../lib/types";
import {
  GOALS, ROUTINE, WORKOUTS, micros, newProfile, planFor, restHours, workoutHours,
  type BodyProfile, type DayRoutine, type Goal, type Plan, type WorkoutKind,
} from "../lib/nutrition";

const n1 = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
const kcalText = (x: number) => x.toLocaleString("ru-RU");

export function Nutrition() {
  const members = useStore((s) => s.settings.members);
  const [edit, setEdit] = useState<string | null>(null);
  const plans = members.map((m) => ({ m, plan: m.body ? planFor(m.body) : null }));
  const ready = plans.filter((x) => x.plan);
  const editing = members.find((m) => m.id === edit);

  function save(id: string, body: BodyProfile | undefined) {
    setSettings({ members: members.map((m) => (m.id === id ? { ...m, body } : m)) });
    setEdit(null);
  }

  return (
    <div className="screen">
      <Header title="Питание" sub="Пробная функция" screen="nutrition" onBack={() => goPage(null)} backText="Ещё" />
      <p className="muted mt0">Личные нормы на день для каждого: калории, белки, жиры, углеводы, витамины. Ориентир для здоровых взрослых, не назначение врача.</p>

      {plans.map(({ m, plan }) => (
        <PersonCard key={m.id} m={m} plan={plan} onEdit={() => setEdit(m.id)} />
      ))}

      {ready.length >= 2 && (
        <div className="card">
          <h3>Вся семья в день</h3>
          <div className="nut-macros">
            <Macro v={kcalText(ready.reduce((s, x) => s + x.plan!.kcal, 0))} t="ккал" />
            <Macro v={String(ready.reduce((s, x) => s + x.plan!.protein, 0))} t="белки, г" />
            <Macro v={String(ready.reduce((s, x) => s + x.plan!.fat, 0))} t="жиры, г" />
            <Macro v={String(ready.reduce((s, x) => s + x.plan!.carbs, 0))} t="углев., г" />
          </div>
          <p className="muted small">Эти ориентиры добавляются в запрос «Спросить Claude».</p>
        </div>
      )}

      <details className="card nut-src">
        <summary>Как считается и откуда нормы</summary>
        <ul className="small">
          <li>Основной обмен — формула Миффлина — Сан-Жеора (1990): вес, рост, возраст, пол.</li>
          <li>Расход за день — факторный метод ФАО/ВОЗ/УООН (2004): часы каждого занятия × его коэффициент; тренировки — по таблице Compendium of Physical Activities (2024).</li>
          <li>Белки, жиры, углеводы, клетчатка, витамины и минералы — МР 2.3.1.0253-21 Роспотребнадзора (2021).</li>
          <li>ИМТ и окружность талии — пороги ВОЗ.</li>
          <li>Снижение веса — не больше 20% от расхода и не больше 750 ккал в день, не ниже 1200 ккал (женщины) и 1500 ккал (мужчины).</li>
          <li>Сколько калорий в блюдах и меню — следующий шаг: для этого нужен справочник состава продуктов.</li>
        </ul>
      </details>

      {editing && <ProfileSheet m={editing} onSave={(b) => save(editing.id, b)} onClose={() => setEdit(null)} />}
    </div>
  );
}

function Macro({ v, t }: { v: string; t: string }) {
  return <div><b>{v}</b><span>{t}</span></div>;
}

function PersonCard({ m, plan, onEdit }: { m: Member; plan: Plan | null; onEdit: () => void }) {
  const [more, setMore] = useState(false);
  if (!m.body) {
    return (
      <div className="card">
        <h3>{m.name}</h3>
        <p className="muted small mt0">Заполните рост, вес и обычный день — и я посчитаю нормы.</p>
        <button className="btn sec" onClick={onEdit}>Заполнить</button>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="card">
        <h3>{m.name}<button className="link small" onClick={onEdit}>Изменить</button></h3>
        <p className="small mt0">Расчёт для детей и подростков пока не делается — у них свои нормы роста. Проверьте также год рождения, рост и вес.</p>
      </div>
    );
  }
  const b = m.body;
  const bmiCls = plan.bmi.level === "ok" ? "" : plan.bmi.level === "over" ? " soon" : " bad";
  return (
    <div className="card nut-card">
      <h3>{m.name}<button className="link small" onClick={onEdit}>Изменить</button></h3>
      <div className="hero"><b>{kcalText(plan.kcal)}</b><span className="muted">ккал в день · {GOALS[plan.goal].toLowerCase()}</span></div>
      <div className="nut-macros">
        <Macro v={String(plan.protein)} t="белки, г" />
        <Macro v={String(plan.fat)} t="жиры, г" />
        <Macro v={String(plan.carbs)} t="углев., г" />
        <Macro v={String(plan.fiber)} t="клетч., г" />
      </div>
      <div className="nut-kv">
        <span>ИМТ</span><span className={"pill" + bmiCls}>{n1(plan.bmi.bmi)} — {plan.bmi.cat}</span>
        <span>Расход за день</span><span>{kcalText(plan.tee)} ккал</span>
        {plan.weekly !== 0 && <><span>Вес в неделю</span><span>{plan.weekly > 0 ? "+" : "−"}{n1(Math.abs(plan.weekly))} кг</span></>}
        <span>Вода</span><span>≈ {n1(plan.water)} л питья</span>
      </div>
      {plan.warnings.map((w, i) => <div key={i} className="issue small">⚠️ {w}</div>)}
      <button className="link" onClick={() => setMore(!more)} aria-expanded={more}>{more ? "Скрыть подробности" : "Подробнее: обмен, активность, витамины"}</button>
      {more && (
        <>
          <div className="nut-kv">
            <span>Возраст</span><span>{plan.age}</span>
            <span>Основной обмен</span><span>{kcalText(plan.bmr)} ккал</span>
            <span>Активность (КФА)</span><span>{n1(plan.pal)}</span>
            <span>Группа по МР</span><span>{plan.group.title}</span>
            <span>Насыщенные жиры</span><span>не больше {plan.satFatMax} г</span>
            <span>Добавленный сахар</span><span>не больше {plan.sugarMax} г</span>
          </div>
          {plan.waist && <div className={"nut-waist" + (plan.waist.level === "high" ? " bad" : plan.waist.level === "up" ? " soon" : "")}>Талия: {plan.waist.text}</div>}
          {plan.notes.map((t, i) => <p key={i} className="muted small">{t}</p>)}
          <h4 className="nut-h">Витамины и минералы в день</h4>
          <div className="nut-micro">
            {micros(b).map((x) => (
              <div key={x.key}><span>{x.title}</span><b>{n1(x.amount)} {x.unit}</b>{x.note && <small>{x.note}</small>}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const HOUR_KEYS = ROUTINE.filter((r) => r.key !== "rest") as { key: keyof DayRoutine; title: string; hint: string; par: number }[];

function ProfileSheet({ m, onSave, onClose }: { m: Member; onSave: (b: BodyProfile | undefined) => void; onClose: () => void }) {
  const [b, setB] = useState<BodyProfile>(() => m.body ? { ...m.body, day: { ...m.body.day }, workouts: m.body.workouts.map((w) => ({ ...w })) } : newProfile(m.id === "m1" ? "f" : "m"));
  const [err, setErr] = useState("");
  const up = (patch: Partial<BodyProfile>) => { setB({ ...b, ...patch }); setErr(""); };
  const setHours = (k: keyof DayRoutine, v: number) => up({ day: { ...b.day, [k]: Math.max(0, Math.min(24, Math.round(v * 2) / 2)) } });
  const used = b.day.sleep + b.day.desk + b.day.light + b.day.walk + b.day.heavy + workoutHours(b);
  const rest = restHours(b);
  const numField = (v: number | undefined) => (v === undefined || isNaN(v) ? "" : String(v).replace(".", ","));
  const toN = (s: string) => { const x = parseFloat(s.replace(",", ".")); return isNaN(x) ? undefined : x; };
  const year = new Date().getFullYear();

  function submit() {
    if (!b.born || b.born < year - 110 || b.born > year) return setErr("Проверьте год рождения.");
    if (!b.height || b.height < 100 || b.height > 250) return setErr("Рост — в сантиметрах, например 168.");
    if (!b.weight || b.weight < 30 || b.weight > 300) return setErr("Вес — в килограммах, например 64,5.");
    if (used > 24.01) return setErr(`В сутках 24 часа, а расписано ${n1(used)}. Уменьшите часы.`);
    onSave({ ...b, workouts: b.workouts.filter((w) => w.minutes > 0 && w.perWeek > 0), updated: new Date().toISOString().slice(0, 10) });
  }

  return (
    <Sheet title={m.name} onClose={onClose} right={<button className="x" onClick={submit}>Готово</button>}>
      <label className="f">Пол</label>
      <Seg label="Пол" value={b.sex} onChange={(sex) => up({ sex, pregnant: sex === "m" ? false : b.pregnant, lactating: sex === "m" ? false : b.lactating })} options={[{ v: "f", t: "Женский" }, { v: "m", t: "Мужской" }]} />
      <div className="nut-grid">
        <div><label className="f" htmlFor="nb">Год рождения</label><input id="nb" className="inp" inputMode="numeric" value={numField(b.born)} onChange={(e: any) => up({ born: toN(e.target.value) as number })} /></div>
        <div><label className="f" htmlFor="nh">Рост, см</label><input id="nh" className="inp" inputMode="decimal" value={numField(b.height)} onChange={(e: any) => up({ height: toN(e.target.value) as number })} /></div>
        <div><label className="f" htmlFor="nw">Вес, кг</label><input id="nw" className="inp" inputMode="decimal" value={numField(b.weight)} onChange={(e: any) => up({ weight: toN(e.target.value) as number })} /></div>
        <div><label className="f" htmlFor="nwa">Талия, см</label><input id="nwa" className="inp" inputMode="decimal" placeholder="по желанию" value={numField(b.waist)} onChange={(e: any) => up({ waist: toN(e.target.value) })} /></div>
        <div><label className="f" htmlFor="nhi">Бёдра, см</label><input id="nhi" className="inp" inputMode="decimal" placeholder="по желанию" value={numField(b.hips)} onChange={(e: any) => up({ hips: toN(e.target.value) })} /></div>
      </div>
      <p className="muted small">Талию измеряйте посередине между нижним ребром и тазовой костью, на выдохе.</p>

      <label className="f">Цель</label>
      <div className="chips">
        {(Object.keys(GOALS) as Goal[]).map((g) => <button type="button" key={g} className="chip" aria-pressed={b.goal === g} onClick={() => up({ goal: g })}>{GOALS[g]}</button>)}
      </div>

      <label className="f">Обычный день, часов</label>
      <div className="list">
        {HOUR_KEYS.map((r) => (
          <div className="nut-hour" key={r.key}>
            <div className="main"><div>{r.title}</div>{r.hint && <small className="muted">{r.hint}</small>}</div>
            <button type="button" aria-label={`${r.title}: меньше`} onClick={() => setHours(r.key, b.day[r.key] - 0.5)}>−</button>
            <b aria-label={r.title}>{n1(b.day[r.key])}</b>
            <button type="button" aria-label={`${r.title}: больше`} onClick={() => setHours(r.key, b.day[r.key] + 0.5)}>+</button>
          </div>
        ))}
        <div className="nut-hour"><div className="main"><div>Отдых сидя</div><small className="muted">еда, телефон, ТВ — остальное время</small></div><b>{n1(rest)}</b></div>
      </div>
      {used > 24.01 && <p className="err small">Расписано {n1(used)} ч — больше суток.</p>}

      <label className="f">Тренировки</label>
      {b.workouts.map((w, i) => (
        <div className="card nut-work" key={i}>
          <select className="inp" value={w.kind} aria-label="Вид тренировки" onChange={(e: any) => up({ workouts: b.workouts.map((x, k) => (k === i ? { ...x, kind: e.target.value as WorkoutKind } : x)) })}>
            {(Object.keys(WORKOUTS) as WorkoutKind[]).map((k) => <option key={k} value={k}>{WORKOUTS[k].title}</option>)}
          </select>
          <div className="nut-grid">
            <div><label className="f">Минут за раз</label><input className="inp" inputMode="numeric" aria-label="Минут за раз" value={numField(w.minutes)} onChange={(e: any) => up({ workouts: b.workouts.map((x, k) => (k === i ? { ...x, minutes: toN(e.target.value) || 0 } : x)) })} /></div>
            <div><label className="f">Раз в неделю</label><input className="inp" inputMode="numeric" aria-label="Раз в неделю" value={numField(w.perWeek)} onChange={(e: any) => up({ workouts: b.workouts.map((x, k) => (k === i ? { ...x, perWeek: Math.min(14, toN(e.target.value) || 0) } : x)) })} /></div>
          </div>
          <button type="button" className="link small" onClick={() => up({ workouts: b.workouts.filter((_, k) => k !== i) })}>Убрать</button>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={() => up({ workouts: [...b.workouts, { kind: "walkFast", minutes: 45, perWeek: 3 }] })}>+ Добавить тренировку</button>

      {b.sex === "f" && (
        <div className="chips" style={{ marginTop: 12 }}>
          <button type="button" className="chip" aria-pressed={!!b.pregnant} onClick={() => up({ pregnant: !b.pregnant, lactating: false })}>Беременность</button>
          <button type="button" className="chip" aria-pressed={!!b.lactating} onClick={() => up({ lactating: !b.lactating, pregnant: false })}>Кормлю грудью</button>
        </div>
      )}

      <label className="f" htmlFor="nmed">Рекомендации врача по питанию</label>
      <textarea id="nmed" className="inp" rows={2} value={b.medical || ""} placeholder="Например: меньше соли, без сахара" onChange={(e: any) => up({ medical: e.target.value })} />
      <p className="muted small">Приложение не ставит диагнозы и не назначает диеты — только напоминает о том, что сказал врач.</p>

      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" style={{ marginTop: 12 }} onClick={submit}>Посчитать</button>
      {m.body && <button className="btn ghost" onClick={() => onSave(undefined)}>Удалить профиль</button>}
    </Sheet>
  );
}
