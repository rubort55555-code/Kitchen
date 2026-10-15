// Экран «Питание» (пробная функция): профиль каждого члена семьи и личные нормы на день.
import { Fragment, useMemo, useState } from "react";
import { Header, Seg, Sheet } from "../components/ui";
import { setSettings, useStore } from "../lib/store";
import { goPage } from "../lib/ui";
import type { Member } from "../lib/types";
import {
  GOALS, bmr, dayEnergy, fromHours, hm, micros, newProfile, normSegs, parseHm, planFor, templateDay,
  type BodyProfile, type DayLog, type Goal, type Plan,
} from "../lib/nutrition";
import { ACTIVITIES, ACT_GROUPS, actByKey, actKey, searchActs, type ActGroup, type Activity } from "../lib/activities";

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
          <li>Расход за день — по дневнику: каждое занятие из таблицы 2024 Adult Compendium of Physical Activities (код и MET). Энергия = MET × основной обмен × минуты, плюс 10% на переваривание пищи.</li>
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
        <p className="muted small mt0">Заполните рост, вес и дневник обычного дня — и я посчитаю нормы.</p>
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
          {plan.diary && (
            <>
              <h4 className="nut-h">Расход по дневнику</h4>
              <div className="nut-kv">
                {plan.diary.map(({ d, e }) => <Fragment key={d.id}><span>{d.title} × {d.perWeek}</span><span>{kcalText(Math.round(e.activity * 1.1))} ккал · движение {fmtMin(e.moveMin)}</span></Fragment>)}
              </div>
              <p className="muted small">Энергия каждого занятия = MET из таблицы Compendium × ваш основной обмен × минуты, плюс 10% на переваривание пищи.</p>
            </>
          )}
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

const met = (m: number) => m.toFixed(1).replace(".", ",");
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? " " + (m % 60) + " мин" : ""}` : `${m} мин`);
const GROUP_E = Object.fromEntries(ACT_GROUPS.map((g) => [g.id, g.e])) as Record<ActGroup, string>;
const uid = () => "d" + Math.random().toString(36).slice(2, 8);

type View = { v: "profile" } | { v: "day"; i: number } | { v: "seg"; i: number; j: number | null };

/** Профиль и дневник в одном окне: анкета → день → отрезок дня. */
function ProfileSheet({ m, onSave, onClose }: { m: Member; onSave: (b: BodyProfile | undefined) => void; onClose: () => void }) {
  const [b, setB] = useState<BodyProfile>(() => {
    if (!m.body) return newProfile(m.id === "m1" ? "f" : "m");
    const body = JSON.parse(JSON.stringify(m.body)) as BodyProfile;
    // Старый профиль «часы по категориям» → дневник
    if (!body.days?.length) body.days = [body.day ? fromHours(body.day, body.workouts) : templateDay()];
    return body;
  });
  const [view, setView] = useState<View>({ v: "profile" });
  const [err, setErr] = useState("");
  const up = (patch: Partial<BodyProfile>) => { setB({ ...b, ...patch }); setErr(""); };
  const days = b.days || [];
  const setDay = (i: number, d: DayLog) => up({ days: days.map((x, k) => (k === i ? d : x)) });
  const numField = (v: number | undefined) => (v === undefined || isNaN(v) ? "" : String(v).replace(".", ","));
  const toN = (s: string) => { const x = parseFloat(s.replace(",", ".")); return isNaN(x) ? undefined : x; };
  const year = new Date().getFullYear();
  const okBody = b.born > year - 110 && b.born <= year && b.height >= 100 && b.height <= 250 && b.weight >= 30 && b.weight <= 300;
  const bm = okBody ? bmr(b) : 1500;
  const week = days.reduce((s, d) => s + d.perWeek, 0);

  function submit() {
    if (!b.born || b.born < year - 110 || b.born > year) return setErr("Проверьте год рождения.");
    if (!b.height || b.height < 100 || b.height > 250) return setErr("Рост — в сантиметрах, например 168.");
    if (!b.weight || b.weight < 30 || b.weight > 300) return setErr("Вес — в килограммах, например 64,5.");
    if (!days.length) return setErr("Добавьте хотя бы один день в дневник.");
    const { day: _d, workouts: _w, ...rest } = b;
    onSave({ ...rest, days: days.map((d) => ({ ...d, segs: normSegs(d.segs) })), updated: new Date().toISOString().slice(0, 10) });
  }

  if (view.v === "day") {
    const d = days[view.i];
    return <DayView d={d} bmr={bm} onChange={(nd) => setDay(view.i, nd)} onBack={() => setView({ v: "profile" })} onSeg={(j) => setView({ v: "seg", i: view.i, j })}
      onDelete={days.length > 1 ? () => { up({ days: days.filter((_, k) => k !== view.i) }); setView({ v: "profile" }); } : undefined} />;
  }
  if (view.v === "seg") {
    const d = days[view.i];
    const segs = normSegs(d.segs);
    const cur = view.j === null ? null : segs[view.j];
    const nextFree = view.j === null ? Math.min(1430, (segs[segs.length - 1]?.start ?? 0) + 30) : cur!.start;
    return <SegView title={d.title} start={cur ? cur.start : nextFree} act={cur?.act} isFirst={view.j === 0}
      onBack={() => setView({ v: "day", i: view.i })}
      onSave={(start, act) => {
        const rest = view.j === null ? segs : segs.filter((_, k) => k !== view.j);
        setDay(view.i, { ...d, segs: normSegs([...rest, { start: view.j === 0 ? 0 : start, act }]) });
        setView({ v: "day", i: view.i });
      }}
      onDelete={view.j ? () => { setDay(view.i, { ...d, segs: segs.filter((_, k) => k !== view.j) }); setView({ v: "day", i: view.i }); } : undefined} />;
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

      <label className="f">Дневник: чем заняты дни</label>
      <p className="muted small mt0">Распишите типичный день по времени — с какого часа что делаете. Каждое занятие сверяется с таблицей энергозатрат. Если дни разные (будни, выходные, дни тренировок) — заведите несколько и укажите, сколько таких дней в неделю.</p>
      <div className="list">
        {days.map((d, i) => {
          const e = dayEnergy(d, bm);
          return (
            <button className="li" key={d.id} onClick={() => setView({ v: "day", i })}>
              <span className="ico">📅</span>
              <div className="main"><div className="name">{d.title}</div><div className="meta">{d.perWeek} {d.perWeek === 1 ? "день" : d.perWeek < 5 ? "дня" : "дней"} в неделю · {normSegs(d.segs).length} занятий · движение {fmtMin(e.moveMin)}</div></div>
              <span className="end">{kcalText(Math.round(e.activity * 1.1))} ккал</span>
            </button>
          );
        })}
      </div>
      {week !== 7 && <p className="issue little small">Дней в неделю вместе: {week}. Лучше, чтобы получилось 7 — например, будни × 5 и выходной × 2.</p>}
      <div className="row2" style={{ marginTop: 10 }}>
        <button type="button" className="btn sec" onClick={() => { const src = days[days.length - 1] || templateDay(); const nd: DayLog = { ...JSON.parse(JSON.stringify(src)), id: uid(), title: days.length === 1 ? "Выходной" : "Ещё день", perWeek: Math.max(1, 7 - week) }; up({ days: [...days, nd] }); setView({ v: "day", i: days.length }); }}>+ Копия дня</button>
        <button type="button" className="btn sec" onClick={() => { up({ days: [...days, { ...templateDay(days.length ? "Новый день" : "Будний день", Math.max(1, 7 - week)), id: uid() }] }); setView({ v: "day", i: days.length }); }}>+ Из примера</button>
      </div>

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

/** Один день: лента занятий по времени. */
function DayView({ d, bmr: bm, onChange, onBack, onSeg, onDelete }: { d: DayLog; bmr: number; onChange: (d: DayLog) => void; onBack: () => void; onSeg: (j: number | null) => void; onDelete?: () => void }) {
  const e = dayEnergy(d, bm);
  const groups = Object.entries(e.byGroup).sort((a, b) => b[1].kcal - a[1].kcal);
  const max = Math.max(...groups.map(([, g]) => g.kcal), 1);
  return (
    <Sheet title={d.title} onClose={onBack} left={<button className="x" onClick={onBack}>‹ Профиль</button>} right={<button className="x" onClick={onBack}>Готово</button>}>
      <label className="f" htmlFor="dt">Название дня</label>
      <input id="dt" className="inp" value={d.title} onChange={(ev: any) => onChange({ ...d, title: ev.target.value })} />
      <div className="nut-hour" style={{ marginTop: 10, borderRadius: 12 }}>
        <div className="main"><div>Таких дней в неделю</div></div>
        <button type="button" aria-label="Меньше дней" onClick={() => onChange({ ...d, perWeek: Math.max(0, d.perWeek - 1) })}>−</button>
        <b aria-label="Дней в неделю">{d.perWeek}</b>
        <button type="button" aria-label="Больше дней" onClick={() => onChange({ ...d, perWeek: Math.min(7, d.perWeek + 1) })}>+</button>
      </div>

      <div className="hero" style={{ marginTop: 14 }}><b>{kcalText(Math.round(e.activity * 1.1))}</b><span className="muted">ккал за день · движение {fmtMin(e.moveMin)}</span></div>
      <div className="nut-bars">
        {groups.map(([g, x]) => (
          <div key={g}><span>{GROUP_E[g as ActGroup]} {ACT_GROUPS.find((y) => y.id === g)?.title}</span><i style={{ width: `${(x.kcal / max) * 100}%` }} /><b>{fmtMin(x.min)} · {kcalText(Math.round(x.kcal))}</b></div>
        ))}
      </div>

      <label className="f">Занятия по времени</label>
      <div className="list nut-tl">
        {e.rows.map((r, j) => (
          <button className="li" key={r.start} onClick={() => onSeg(j)}>
            <span className="tm">{hm(r.start)}<small>{hm(r.end)}</small></span>
            <div className="main"><div className="name">{GROUP_E[r.act.g]} {r.act.n}</div><div className="meta">{fmtMin(r.min)} · MET {met(r.act.m)}{r.act.est ? "*" : ""} · код {r.act.c}</div></div>
            <span className="end">{kcalText(Math.round(r.kcal))}</span>
          </button>
        ))}
      </div>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => onSeg(null)}>+ Добавить занятие</button>
      <p className="muted small">Каждое занятие длится до начала следующего. Цифра справа — ккал без переваривания пищи; в итог дня добавлено 10%. * — значение MET в таблице оценочное.</p>
      {onDelete && <button className="btn ghost" onClick={onDelete}>Удалить этот день</button>}
    </Sheet>
  );
}

/** Отрезок дня: время начала и занятие из таблицы. */
function SegView({ title, start, act, isFirst, onBack, onSave, onDelete }: { title: string; start: number; act?: string; isFirst: boolean; onBack: () => void; onSave: (start: number, act: string) => void; onDelete?: () => void }) {
  const [t, setT] = useState(hm(start));
  const [sel, setSel] = useState<string | undefined>(act);
  const [q, setQ] = useState("");
  const [g, setG] = useState<ActGroup>(() => (act && actByKey(act)?.g) || "rest");
  const [err, setErr] = useState("");
  const list = useMemo(() => (q.trim() ? searchActs(q) : ACTIVITIES.filter((a) => a.g === g)), [q, g]);
  const cur = sel ? actByKey(sel) : undefined;
  function save() {
    const s = isFirst ? 0 : parseHm(t);
    if (s === null) return setErr("Время — в виде 07:30.");
    if (!sel) return setErr("Выберите, чем были заняты.");
    onSave(s, sel);
  }
  return (
    <Sheet title={title} onClose={onBack} left={<button className="x" onClick={onBack}>‹ День</button>} right={<button className="x" onClick={save}>Готово</button>}>
      <label className="f" htmlFor="st">С какого времени</label>
      <input id="st" className="inp big" type="time" step={300} value={t} disabled={isFirst} onChange={(ev: any) => { setT(ev.target.value); setErr(""); }} />
      {isFirst && <p className="muted small">Первое занятие всегда с 00:00 — обычно это сон.</p>}
      {cur && <div className="nut-cur"><b>{GROUP_E[cur.g]} {cur.n}</b><span>MET {met(cur.m)}{cur.est ? " (оценочное)" : ""} · код Compendium {cur.c}</span></div>}
      <label className="f" htmlFor="sq">Чем заняты</label>
      <input id="sq" className="inp" value={q} placeholder="Поиск: душ, бег, компьютер…" onChange={(ev: any) => setQ(ev.target.value)} />
      {!q.trim() && (
        <div className="chips">
          {ACT_GROUPS.map((x) => <button type="button" key={x.id} className="chip" aria-pressed={g === x.id} onClick={() => setG(x.id)}>{x.e} {x.title}</button>)}
        </div>
      )}
      <div className="list nut-pick" role="listbox" aria-label="Занятия">
        {list.map((a: Activity) => (
          <button key={actKey(a)} className="li" role="option" aria-selected={sel === actKey(a)} onClick={() => { setSel(actKey(a)); setErr(""); }}>
            <div className="main"><div className="name">{a.n}</div><div className="meta">MET {met(a.m)}{a.est ? "*" : ""} · {a.c}</div></div>
            {sel === actKey(a) && <span className="end">✓</span>}
          </button>
        ))}
        {!list.length && <p className="muted small" style={{ padding: 12 }}>Ничего не нашлось — попробуйте другое слово или выберите раздел.</p>}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" style={{ marginTop: 12 }} onClick={save}>Сохранить</button>
      {onDelete && <button className="btn ghost" onClick={onDelete}>Удалить занятие</button>}
    </Sheet>
  );
}
