// Дневник питания и экран «Сегодня»: что съедено, сколько осталось до нормы, вода, быстрая запись блюда.
import { useMemo, useState } from "react";
import { Sheet } from "../components/ui";
import { BarcodeScan } from "../components/BarcodeScan";
import { addMeals, addWater, deleteMeals, diaryWho, rememberBarcode, repeatDay, setDiaryWho, useStore, waterOf } from "../lib/store";
import { closeAll, closeSheet, goPage, openSheet, toast } from "../lib/ui";
import { MEAL_SLOTS, type Meal, type MealSlot } from "../lib/types";
import { micros, planFor, type BodyProfile } from "../lib/nutrition";
import { NUTRIENTS, recipeNutrition, type NutrientKey } from "../lib/recipeNutrition";
import { lookupOff, nameFor, type OffProduct } from "../lib/off";
import { DRINKS, SOURCES, caffeineLimit, caffeineOf, interactionHints, type Drink } from "../lib/interactions";
import { LEVEL_TEXT, ironDay, ironHints } from "../lib/iron";
import { CA_TEXT, calciumDay, mineralHints } from "../lib/minerals";
import { FAT_TEXT, fatSolubleDay, fatSolubleHints } from "../lib/fatsoluble";
import { copyMeal, defaultGrams, dayView, hasMicroData, mealCustom, mealDrink, mealFromComposition, mealFromOff, mealFromRecipe, mealsOf, recentMeals, searchFoods, slotByHour } from "../lib/diary";
import { addDays, cap, norm, ymd } from "../lib/util";

const kcalText = (x: number) => Math.round(x).toLocaleString("ru-RU");
const SLOT_EMOJI: Record<MealSlot, string> = { "завтрак": "🍳", "обед": "🍲", "ужин": "🥗", "перекус": "🍎" };
const toN = (s: string) => { const x = parseFloat(s.replace(",", ".")); return isNaN(x) ? undefined : x; };
const dateTitle = (d: string) => (d === ymd() ? "Сегодня" : d === addDays(ymd(), -1) ? "Вчера" : cap(new Date(d + "T12:00:00").toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "long" })));

/** Данные дня выбранного человека: записи, норма, итог. */
function useDay(date: string) {
  const members = useStore((s) => s.settings.members);
  const meals = useStore((s) => s.meals);
  const who = useStore((s) => diaryWho(s.settings));
  const water = useStore((s) => waterOf(date, s.settings, who));
  const member = members.find((m) => m.id === who);
  const plan = useMemo(() => (member?.body ? planFor(member.body) : null), [member]);
  const list = useMemo(() => mealsOf(meals, date, who), [meals, date, who]);
  const view = useMemo(() => dayView(list, plan, date === ymd() ? new Date().getHours() : 24), [list, plan, date]);
  return { who, member, members, plan, list, view, water, meals };
}

function Bar({ v, max, cls }: { v: number; max: number; cls?: string }) {
  const pct = max ? Math.min(100, (v / max) * 100) : 0;
  return <div className={"dbar " + (cls || "")}><i style={{ width: pct + "%" }} /></div>;
}

/** Карточка «Сегодня» на главной: калории и БЖУ против нормы и кнопка быстрой записи. */
export function TodayCard() {
  const date = ymd();
  const { plan, list, view } = useDay(date);
  const e = view.eaten;
  const cls = view.level === "over" ? "bad" : view.level === "ok" ? "good" : "";
  return (
    <div className="card today">
      <h3>Сегодня съедено <button className="link small" style={{ padding: 0 }} onClick={() => openSheet({ kind: "diary" })}>Дневник ›</button></h3>
      <div className="hero"><b>{kcalText(e.kcal)}</b><span className="muted">{plan ? `из ${kcalText(plan.kcal)} ккал` : "ккал"}</span></div>
      {plan && <Bar v={e.kcal} max={plan.kcal} cls={cls} />}
      {plan ? (
        <p className="muted small" style={{ margin: "6px 0" }}>
          {view.left >= 0 ? `Осталось ${kcalText(view.left)} ккал` : `Выше нормы на ${kcalText(-view.left)} ккал`} · Б {Math.round(e.protein)}/{plan.protein} · Ж {Math.round(e.fat)}/{plan.fat} · У {Math.round(e.carbs)}/{plan.carbs} г
        </p>
      ) : (
        <p className="muted small" style={{ margin: "6px 0" }}>Заполните рост, вес и цель в «Ещё → Питание» — покажу остаток до нормы.</p>
      )}
      {view.hints[0] && <p className="small" style={{ margin: "4px 0" }}>💡 {view.hints[0]}</p>}
      <div className="row2">
        <button className="btn" onClick={() => openSheet({ kind: "meal", date })}>+ Записать еду</button>
        {list.length === 0 && <button className="btn sec" onClick={() => { const c = repeatDay(addDays(date, -1), date, diaryWho()); toast(c.length ? `Повторено записей: ${c.length}` : "Вчера ничего не записано"); }}>Повторить вчера</button>}
      </div>
    </div>
  );
}

/** Окно дневника: день, итог против нормы, вода, список приёмов пищи. */
export function Diary({ date: start }: { date?: string }) {
  const [date, setDate] = useState(start || ymd());
  const { who, members, member, plan, list, view, water } = useDay(date);
  const recipes = useStore((s) => s.recipes);
  const e = view.eaten;
  const waterNorm = plan ? Math.round(plan.water * 1000) : 0;
  const bySlot = MEAL_SLOTS.map((s) => ({ s, items: list.filter((m) => m.slot === s) })).filter((x) => x.items.length);
  const cls = view.level === "over" ? "bad" : view.level === "ok" ? "good" : "";

  function remove(m: Meal) {
    deleteMeals([m.id]);
    toast(`Удалено: ${m.name}`, () => addMeals([m]));
  }
  function repeat() {
    const c = repeatDay(addDays(date, -1), date, who);
    toast(c.length ? `Повторено записей: ${c.length}` : "Вчера ничего не записано");
  }

  return (
    <Sheet title="Дневник питания">
      {members.length > 1 && (
        <div className="chips">
          {members.map((m) => <button key={m.id} className="chip" aria-pressed={m.id === who} onClick={() => setDiaryWho(m.id)}>{m.name}</button>)}
        </div>
      )}
      <div className="dnav">
        <button className="chip" aria-label="Предыдущий день" onClick={() => setDate(addDays(date, -1))}>‹</button>
        <b>{dateTitle(date)}</b>
        <button className="chip" aria-label="Следующий день" disabled={date >= ymd()} onClick={() => setDate(addDays(date, 1))}>›</button>
      </div>

      <div className="card">
        <div className="hero"><b>{kcalText(e.kcal)}</b><span className="muted">{plan ? `из ${kcalText(plan.kcal)} ккал` : "ккал за день"}</span></div>
        {plan && <Bar v={e.kcal} max={plan.kcal} cls={cls} />}
        {plan && <p className="small" style={{ margin: "6px 0" }}>{view.left >= 0 ? `Осталось ${kcalText(view.left)} ккал` : `Выше нормы на ${kcalText(-view.left)} ккал`}</p>}
        <div className="nut-macros">
          <MacroCell t="белки, г" v={e.protein} n={plan?.protein} />
          <MacroCell t="жиры, г" v={e.fat} n={plan?.fat} />
          <MacroCell t="углев., г" v={e.carbs} n={plan?.carbs} />
          <MacroCell t="клетч., г" v={e.fiber} n={plan?.fiber} />
        </div>
        {plan && (e.sugar > 0 || e.na > 0) && <p className="muted small">Сахара {Math.round(e.sugar)} г · натрий {Math.round(e.na)} из {kcalText(plan.naMax)} мг{e.satFat > 0 ? ` · насыщенные жиры ${Math.round(e.satFat)} из ${plan.satFatMax} г` : ""}</p>}
        {!plan && <button className="link" onClick={() => { closeAll(); goPage("nutrition"); }}>Заполнить рост, вес и цель — покажу норму →</button>}
        {view.hints.map((h, i) => <div key={i} className="issue little small">💡 {h}</div>)}
      </div>

      <CombosBlock meals={list} recipes={recipes} limit={caffeineLimit(!!(member?.body?.pregnant || member?.body?.lactating))} />
      {plan && member?.body && <MicroBlock eaten={e} body={member.body} hasMeals={list.length > 0} noData={list.filter((m) => !hasMicroData(m)).length} total={list.length} />}

      <div className="card">
        <div className="wrow">
          <span>💧 Вода: <b>{water} мл</b>{waterNorm ? ` из ≈ ${waterNorm} мл` : ""}</span>
          <span className="wbtn">
            <button className="chip" aria-label="Минус стакан" onClick={() => addWater(date, -250, who)} disabled={!water}>−</button>
            <button className="chip" onClick={() => addWater(date, 250, who)}>+ стакан</button>
          </span>
        </div>
        {waterNorm > 0 && <Bar v={water} max={waterNorm} cls="water" />}
      </div>

      {bySlot.length === 0 && <p className="empty muted">В этот день ничего не записано.</p>}
      {bySlot.map(({ s, items }) => (
        <div key={s}>
          <div className="sec-h"><b>{SLOT_EMOJI[s]} {cap(s)}</b><span className="muted small">{kcalText(items.reduce((a, m) => a + (m.n.kcal || 0), 0))} ккал</span></div>
          <div className="list">
            {items.map((m) => (
              <div className="li" key={m.id}>
                <div className="main"><div className="name">{m.name}</div><div className="meta">{m.qty ? m.qty + " · " : ""}Б {Math.round(m.n.protein || 0)} · Ж {Math.round(m.n.fat || 0)} · У {Math.round(m.n.carbs || 0)}{!hasMicroData(m) ? " · витаминов и минералов нет" : ""}</div></div>
                <span className="end">{kcalText(m.n.kcal || 0)}</span>
                <button className="ib" aria-label={"Удалить " + m.name} onClick={() => remove(m)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <button className="btn" style={{ marginTop: 14 }} onClick={() => openSheet({ kind: "meal", date })}>+ Записать приём пищи</button>
      <button className="btn ghost" onClick={repeat}>Повторить вчера</button>
      <p className="muted small">Калории блюд из рецептов — ориентировочные, по составу сырых продуктов. Блюдо из меню попадает сюда само, когда вы отмечаете «Приготовили».</p>
    </Sheet>
  );
}

const TRACKED = new Set<string>(NUTRIENTS.map((x) => x.key));
const VITAMINS = new Set(["vitC", "vitB1", "vitB2", "vitB6", "niacin", "vitB12", "folate", "pantothenic", "biotin", "vitA", "vitE", "vitD", "vitK", "betaCarotene"]);
const fmt = (x: number) => (x >= 100 ? Math.round(x) : x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100).toLocaleString("ru-RU");

/** Витамины и минералы за день против нормы (МР 2.3.1.0253-21) и то, чего не хватает. Считаются только блюда из рецептов и продукты из справочника. */
function MicroBlock({ eaten, body, hasMeals, noData, total }: { eaten: Record<NutrientKey, number>; body: BodyProfile; hasMeals: boolean; noData: number; total: number }) {
  const [open, setOpen] = useState(true);
  const all = micros(body);
  const rows = all.filter((x) => TRACKED.has(x.key) && x.key !== "na").map((x) => ({ ...x, v: eaten[x.key as NutrientKey] || 0, pct: Math.round(((eaten[x.key as NutrientKey] || 0) / x.amount) * 100) }));
  const na = all.find((x) => x.key === "na");
  const untracked = all.filter((x) => !TRACKED.has(x.key)).map((x) => x.title);
  const lowest = [...rows].sort((a, b) => a.pct - b.pct).slice(0, 3);
  const vit = rows.filter((x) => VITAMINS.has(x.key)), min = rows.filter((x) => !VITAMINS.has(x.key));
  const Row = ({ x }: { x: (typeof rows)[number] }) => (
    <div className="mrow" role="progressbar" aria-label={x.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, x.pct)}>
      <div className="mh"><span>{x.title}</span><b>{x.pct}%</b></div>
      <div className="dbar"><i className={x.pct >= 100 ? "full" : x.pct >= 50 ? "mid" : "low"} style={{ width: Math.min(100, x.pct) + "%" }} /></div>
      <small>{fmt(x.v)} из {fmt(x.amount)} {x.unit}</small>
    </div>
  );
  return (
    <div className="card">
      <h3>Витамины и минералы</h3>
      {noData > 0 && <div className="issue little small">⚠️ У {noData} из {total} записей нет данных о витаминах и минералах (своё блюдо или товар, у которого они не указаны на упаковке). Эти записи в расчёт не входят, поэтому проценты ниже могут быть занижены, а «меньше всего пока» — неточным.</div>}
      {hasMeals ? (
        <p className="small" style={{ margin: "2px 0 6px" }}>{noData > 0 ? "Меньше всего (с учётом записей без данных):" : "Меньше всего пока:"} {lowest.map((x) => `${x.title.toLowerCase()} ${x.pct}%`).join(", ")}.</p>
      ) : <p className="muted small mt0">Появятся, когда запишете еду из рецептов или справочника.</p>}
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Свернуть список" : "Показать все витамины и минералы"}</button>
      {open && (
        <>
          <h4 className="nut-h">Витамины</h4>
          {vit.map((x) => <Row key={x.key} x={x} />)}
          <h4 className="nut-h">Минералы</h4>
          {min.map((x) => <Row key={x.key} x={x} />)}
          {na && <p className="muted small">Натрий: {fmt(eaten.na || 0)} мг — не больше 2 000 мг в день (норма 1 300 мг).</p>}
          {untracked.length > 0 && <p className="muted small">Не учитываются (нет данных по составу продуктов): {untracked.join(", ").toLowerCase()}.</p>}
          <p className="muted small">Считаются блюда из рецептов и продукты из справочника. Своё блюдо и товар по штрихкоду добавляют только калории и БЖУ (у штрихкода ещё сахара, клетчатка, соль), поэтому витаминов по ним нет. Норма — по МР 2.3.1.0253-21, % — доля суточной нормы.</p>
        </>
      )}
    </div>
  );
}

/** Кофеин за день против предела и подсказки по сочетаниям (что усваивается лучше или хуже). */
function CombosBlock({ meals, limit, recipes }: { meals: Meal[]; limit: number; recipes: import("../lib/types").Recipe[] }) {
  const caf = caffeineOf(meals);
  const hints = useMemo(() => [...ironHints(meals, { recipes }), ...mineralHints(meals, { recipes }), ...fatSolubleHints(meals, { recipes }), ...interactionHints(meals, { caffeineLimit: limit })], [meals, limit, recipes]);
  const irons = useMemo(() => ironDay(meals, { recipes }), [meals, recipes]);
  const cas = useMemo(() => calciumDay(meals, { recipes }), [meals, recipes]);
  const fss = useMemo(() => fatSolubleDay(meals, { recipes }), [meals, recipes]);
  if (!caf && !hints.length && !irons.length && !cas.length && !fss.length) return null;
  return (
    <div className="card">
      <h3>Сочетания и усвоение</h3>
      {caf > 0 && (
        <>
          <p className="small" style={{ margin: "2px 0" }}>☕ Кофеин: <b>{Math.round(caf)} мг</b> из {limit} мг</p>
          <Bar v={caf} max={limit} cls={caf > limit ? "bad" : ""} />
        </>
      )}
      {irons.length > 0 && (
        <div className="ironrows">
          {irons.map((r) => (
            <p key={r.slot} className="small" style={{ margin: "4px 0" }}>🩸 {cap(r.slot)}: железа <b>{String(Math.round(r.mg * 10) / 10).replace(".", ",")} мг</b> — {LEVEL_TEXT[r.level]}{r.enhancers.length ? ` (помогают: ${r.enhancers.join(", ")})` : ""}{r.inhibitors.length ? ` (мешают: ${r.inhibitors.join(", ")})` : ""}</p>
          ))}
        </div>
      )}
      {cas.length > 0 && (
        <div className="ironrows">
          {cas.map((r) => (
            <p key={r.slot} className="small" style={{ margin: "4px 0" }}>🦴 {cap(r.slot)}: кальция <b>{Math.round(r.mg)} мг</b> — {CA_TEXT[r.quality]}</p>
          ))}
        </div>
      )}
      {fss.length > 0 && (
        <div className="ironrows">
          {fss.map((r) => (
            <p key={r.slot} className="small" style={{ margin: "4px 0" }}>🥑 {cap(r.slot)}: жира <b>{String(Math.round(r.fat * 10) / 10).replace(".", ",")} г</b> — {FAT_TEXT[r.level]}</p>
          ))}
        </div>
      )}
      {hints.map((h) => (
        <details key={h.id} className="hint" open={h.id.startsWith("caf-limit") || h.id.startsWith("caf-single")}>
          <summary>{h.text}</summary>
          <ul className="small muted">{h.src.map((id) => <li key={id}>{SOURCES[id].cite}</li>)}</ul>
        </details>
      ))}
      {!hints.length && <p className="muted small">Сочетаний, о которых стоит предупредить, пока нет.</p>}
      <p className="muted small">Это подсказки по опубликованным исследованиям, а не расчёт усвоения. Эффект кофеина на магний и кальций небольшой.</p>
    </div>
  );
}

function MacroCell({ t, v, n }: { t: string; v: number; n?: number }) {
  return <div><b>{Math.round(v)}</b><span>{n ? `из ${n} ` : ""}{t}</span></div>;
}

type Tab = "recent" | "recipe" | "product" | "drink" | "own" | "scan";
const TABS: { v: Tab; t: string }[] = [{ v: "recent", t: "Недавнее" }, { v: "recipe", t: "Рецепт" }, { v: "product", t: "Продукт" }, { v: "drink", t: "Напиток" }, { v: "own", t: "Своё" }, { v: "scan", t: "Штрихкод" }];

/** Запись приёма пищи: недавнее, рецепт, продукт из справочника, своё блюдо, штрихкод. */
export function AddMeal({ date, slot: slot0 }: { date: string; slot?: MealSlot }) {
  const recipes = useStore((s) => s.recipes);
  const meals = useStore((s) => s.meals);
  const custom = useStore((s) => s.settings.customCatalog);
  const who = diaryWho(useStore((s) => s.settings));
  const recent = useMemo(() => recentMeals(meals, who), [meals, who]);
  const [slot, setSlot] = useState<MealSlot>(slot0 || slotByHour(new Date().getHours()));
  const [tab, setTab] = useState<Tab>(recent.length ? "recent" : "recipe");

  function save(m: Meal | null) {
    if (!m) { toast("Не получилось посчитать — проверьте данные"); return; }
    addMeals([m]);
    toast(`Записано: ${m.name} · ${kcalText(m.n.kcal || 0)} ккал`, () => deleteMeals([m.id]));
    closeSheet();
  }

  return (
    <Sheet title="Что вы съели">
      <div className="chips">
        {MEAL_SLOTS.map((s) => <button key={s} className="chip" aria-pressed={slot === s} onClick={() => setSlot(s)}>{SLOT_EMOJI[s]} {cap(s)}</button>)}
      </div>
      <div className="chips" role="group" aria-label="Откуда">
        {TABS.map((x) => <button key={x.v} type="button" className="chip" aria-pressed={tab === x.v} onClick={() => setTab(x.v)}>{x.t}</button>)}
      </div>
      <div style={{ marginTop: 12 }}>
        {tab === "recent" && (
          recent.length ? (
            <div className="list">
              {recent.map((m) => (
                <button className="li" key={m.id} onClick={() => save(copyMeal(m, date, slot))}>
                  <div className="main"><div className="name">{m.name}</div><div className="meta">{m.qty || ""}</div></div>
                  <span className="end">{kcalText(m.n.kcal || 0)}</span>
                </button>
              ))}
            </div>
          ) : <p className="muted">Здесь появятся блюда, которые вы записывали раньше, — повторить можно одним касанием.</p>
        )}
        {tab === "recipe" && <RecipePick recipes={recipes} onPick={(r, k) => save(mealFromRecipe(r, k, date, slot, who))} />}
        {tab === "product" && <ProductPick onPick={(name, g) => save(mealFromComposition(name, g, date, slot, who))} />}
        {tab === "drink" && <DrinkPick onPick={(d, k) => save(mealDrink(d, k, date, slot, who))} />}
        {tab === "own" && <OwnForm onSave={(name, v) => save(mealCustom(name, v, date, slot, who))} />}
        {tab === "scan" && <ScanPick custom={custom} onPick={(p, name, g) => save(mealFromOff(p, name, g, date, slot, who))} />}
      </div>
    </Sheet>
  );
}

function Stepper({ v, set, step, min, unit }: { v: number; set: (n: number) => void; step: number; min: number; unit: string }) {
  return (
    <div className="nut-hour" style={{ borderRadius: 12 }}>
      <div className="main"><div>Сколько</div></div>
      <button type="button" aria-label="Меньше" onClick={() => set(Math.max(min, Math.round((v - step) * 100) / 100))}>−</button>
      <b>{String(v).replace(".", ",")} {unit}</b>
      <button type="button" aria-label="Больше" onClick={() => set(Math.round((v + step) * 100) / 100)}>+</button>
    </div>
  );
}

function RecipePick({ recipes, onPick }: { recipes: import("../lib/types").Recipe[]; onPick: (r: import("../lib/types").Recipe, servings: number) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<import("../lib/types").Recipe | null>(null);
  const [k, setK] = useState(1);
  const list = useMemo(() => {
    const w = norm(q);
    return recipes.filter((r) => !w || norm(r.name).includes(w)).slice(0, 30);
  }, [recipes, q]);
  const rn = sel ? recipeNutrition(sel) : null;
  if (sel) {
    return (
      <>
        <div className="card"><h3>{sel.name}</h3>
          <p className="muted small mt0">{rn ? `на порцию ≈ ${kcalText(rn.perServing.kcal)} ккал · Б ${Math.round(rn.perServing.protein)} · Ж ${Math.round(rn.perServing.fat)} · У ${Math.round(rn.perServing.carbs)}` : "Состав рецепта посчитать не удалось"}</p></div>
        <Stepper v={k} set={setK} step={0.5} min={0.5} unit={k === 1 ? "порция" : "порции"} />
        <button className="btn" style={{ marginTop: 12 }} disabled={!rn} onClick={() => onPick(sel, k)}>Записать{rn ? ` · ${kcalText(rn.perServing.kcal * k)} ккал` : ""}</button>
        <button className="btn ghost" onClick={() => setSel(null)}>Другой рецепт</button>
      </>
    );
  }
  return (
    <>
      <input className="inp" value={q} placeholder="Найти рецепт: борщ, омлет…" onChange={(e: any) => setQ(e.target.value)} aria-label="Поиск рецепта" />
      <div className="list" style={{ marginTop: 8 }}>
        {list.map((r) => <button className="li" key={r.id} onClick={() => { setSel(r); setK(1); }}><div className="main"><div className="name">{r.name}</div><div className="meta">{r.servings ? r.servings + " порц." : ""}</div></div></button>)}
        {!list.length && <p className="muted small" style={{ padding: 12 }}>Ничего не нашлось.</p>}
      </div>
    </>
  );
}

function ProductPick({ onPick }: { onPick: (name: string, grams: number) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [g, setG] = useState("100");
  const list = useMemo(() => searchFoods(q), [q]);
  if (sel) {
    const grams = toN(g) || 0;
    const m = mealFromComposition(sel, grams, "", "перекус");
    return (
      <>
        <div className="card"><h3>{sel}</h3><p className="muted small mt0">{m ? `${kcalText(m.n.kcal || 0)} ккал · Б ${Math.round(m.n.protein || 0)} · Ж ${Math.round(m.n.fat || 0)} · У ${Math.round(m.n.carbs || 0)}` : "Укажите вес"}</p></div>
        <label className="f" htmlFor="pg">Вес, г</label>
        <input id="pg" className="inp big" inputMode="decimal" value={g} onChange={(e: any) => setG(e.target.value)} />
        <button className="btn" style={{ marginTop: 12 }} disabled={!m} onClick={() => onPick(sel, grams)}>Записать{m ? ` · ${kcalText(m.n.kcal || 0)} ккал` : ""}</button>
        <button className="btn ghost" onClick={() => setSel(null)}>Другой продукт</button>
      </>
    );
  }
  return (
    <>
      <input className="inp" value={q} placeholder="Найти продукт: яблоко, гречка…" onChange={(e: any) => setQ(e.target.value)} aria-label="Поиск продукта" />
      <div className="list" style={{ marginTop: 8 }}>
        {list.map((n) => <button className="li" key={n} onClick={() => { setSel(n); setG(String(defaultGrams(n))); }}><div className="main"><div className="name">{n}</div></div></button>)}
        {!list.length && <p className="muted small" style={{ padding: 12 }}>В справочнике состава такого нет. Запишите как «Своё» или отсканируйте штрихкод.</p>}
      </div>
    </>
  );
}

function DrinkPick({ onPick }: { onPick: (d: Drink, count: number) => void }) {
  const [sel, setSel] = useState<Drink | null>(null);
  const [k, setK] = useState(1);
  if (sel) {
    return (
      <>
        <div className="card"><h3>{sel.name}</h3><p className="muted small mt0">порция {sel.ml} мл ≈ {sel.caffeine} мг кофеина, {sel.kcal} ккал (типичные значения: зависят от крепости)</p></div>
        <Stepper v={k} set={setK} step={0.5} min={0.5} unit={k === 1 ? "порция" : "порции"} />
        <button className="btn" style={{ marginTop: 12 }} onClick={() => onPick(sel, k)}>Записать · {Math.round(sel.caffeine * k)} мг кофеина</button>
        <button className="btn ghost" onClick={() => setSel(null)}>Другой напиток</button>
      </>
    );
  }
  return (
    <div className="list">
      {DRINKS.map((d) => <button className="li" key={d.key} onClick={() => { setSel(d); setK(1); }}><div className="main"><div className="name">{d.name}</div><div className="meta">{d.ml} мл · кофеин ≈ {d.caffeine} мг</div></div></button>)}
    </div>
  );
}

function OwnForm({ onSave }: { onSave: (name: string, v: { kcal: number; protein?: number; fat?: number; carbs?: number }) => void }) {
  const [name, setName] = useState("");
  const [f, setF] = useState({ kcal: "", protein: "", fat: "", carbs: "" });
  const up = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const kcal = toN(f.kcal);
  return (
    <>
      <label className="f" htmlFor="on">Название</label>
      <input id="on" className="inp" value={name} placeholder="Например: обед в кафе" onChange={(e: any) => setName(e.target.value)} />
      <p className="muted small">Калории и БЖУ — на всё, что вы съели (не на 100 г).</p>
      <div className="nut-grid">
        <div><label className="f" htmlFor="ok">Ккал</label><input id="ok" className="inp" inputMode="decimal" value={f.kcal} onChange={(e: any) => up("kcal", e.target.value)} /></div>
        <div><label className="f" htmlFor="op">Белки, г</label><input id="op" className="inp" inputMode="decimal" value={f.protein} onChange={(e: any) => up("protein", e.target.value)} /></div>
        <div><label className="f" htmlFor="of">Жиры, г</label><input id="of" className="inp" inputMode="decimal" value={f.fat} onChange={(e: any) => up("fat", e.target.value)} /></div>
        <div><label className="f" htmlFor="oc">Углеводы, г</label><input id="oc" className="inp" inputMode="decimal" value={f.carbs} onChange={(e: any) => up("carbs", e.target.value)} /></div>
      </div>
      <button className="btn" style={{ marginTop: 12 }} disabled={!name.trim() || kcal === undefined} onClick={() => onSave(name, { kcal: kcal!, protein: toN(f.protein), fat: toN(f.fat), carbs: toN(f.carbs) })}>Записать</button>
    </>
  );
}

function ScanPick({ custom, onPick }: { custom: import("../lib/types").CatalogItem[]; onPick: (p: OffProduct, name: string, grams: number) => void }) {
  const known = useStore((s) => s.settings.barcodes);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ p: OffProduct; name: string; own?: boolean } | null>(null);
  const [g, setG] = useState("100");
  const [msg, setMsg] = useState("");
  // Товар не найден: вводим данные с этикетки сами (на 100 г) — запомним по штрихкоду
  const [miss, setMiss] = useState<{ code: string } | null>(null);
  const [f, setF] = useState({ name: "", kcal: "", p: "", f: "", c: "", pack: "" });
  const showFound = (p: OffProduct, name: string, own = false) => {
    setFound({ p, name, own });
    setG(String(p.qty && (p.unit === "г" || p.unit === "мл") ? p.qty : 100));
  };
  async function onCode(code: string) {
    setScan(false); setMsg(""); setMiss(null);
    // 1. Свои запомненные товары — без интернета
    const mem = known?.[code];
    if (mem?.off?.per100 && typeof mem.off.per100.kcal === "number") return showFound(mem.off, mem.name, true);
    setBusy(true);
    const r = await lookupOff(code);
    setBusy(false);
    if (!r.ok) { setMiss({ code }); return setMsg(r.why === "offline" ? "Нет интернета, а этого товара в вашей памяти нет. Введите данные с этикетки — приложение запомнит товар." : "Open Food Facts не ответил. Введите данные с этикетки — приложение запомнит товар."); }
    if (!r.product || !r.product.per100 || typeof r.product.per100.kcal !== "number") { setMiss({ code }); return setMsg(r.product ? "У товара в базе нет калорийности. Введите данные с этикетки — приложение запомнит товар." : "Этого товара нет в Open Food Facts (российских товаров там около 37 тысяч). Введите данные с этикетки — приложение запомнит товар."); }
    const name = nameFor(r.product, custom).name;
    rememberBarcode(code, name, r.product);
    showFound(r.product, name);
  }
  const num = (x: string) => { const v = parseFloat(x.replace(",", ".")); return isNaN(v) ? undefined : v; };
  function saveOwn() {
    const kcal = num(f.kcal);
    if (!miss || !f.name.trim() || kcal === undefined) return;
    const per100 = { kcal, ...(num(f.p) !== undefined ? { p: num(f.p) } : {}), ...(num(f.f) !== undefined ? { f: num(f.f) } : {}), ...(num(f.c) !== undefined ? { c: num(f.c) } : {}) };
    const pack = num(f.pack);
    const p: OffProduct = { code: miss.code, title: f.name.trim(), per100, ...(pack ? { qty: pack, unit: "г" as const } : {}) };
    rememberBarcode(miss.code, p.title, p);
    setMiss(null); setMsg("");
    showFound(p, p.title, true);
  }
  if (scan) return <BarcodeScan onCode={onCode} onClose={() => setScan(false)} />;
  if (found) {
    const grams = toN(g) || 0;
    const m = mealFromOff(found.p, found.name, grams, "", "перекус");
    return (
      <>
        <div className="card"><h3>{found.name}</h3><p className="muted small mt0">на 100 г: {Math.round(found.p.per100!.kcal!)} ккал{found.own ? ". Из вашей памяти (введено вами или найдено раньше)." : ". © участники Open Food Facts, ODbL"}</p>
          {m && !hasMicroData(m) && <p className="small" style={{ margin: "4px 0" }}>ℹ️ Железо, кальций и витамины на упаковке не указаны — они не считаются, чтобы не вводить в заблуждение.</p>}</div>
        <label className="f" htmlFor="sg">Сколько съели, г</label>
        <input id="sg" className="inp big" inputMode="decimal" value={g} onChange={(e: any) => setG(e.target.value)} />
        <button className="btn" style={{ marginTop: 12 }} disabled={!m} onClick={() => onPick(found.p, found.name, grams)}>Записать{m ? ` · ${kcalText(m.n.kcal || 0)} ккал` : ""}</button>
        <button className="btn ghost" onClick={() => setFound(null)}>Другой товар</button>
      </>
    );
  }
  if (miss) {
    return (
      <>
        <p className="err" role="alert">{msg}</p>
        <p className="muted small">Код {miss.code}. Значения — на 100 г, как на этикетке.</p>
        <label className="f" htmlFor="mn">Название</label>
        <input id="mn" className="inp" value={f.name} onChange={(e: any) => setF({ ...f, name: e.target.value })} placeholder="Например: Творог 5% Простоквашино" />
        <div className="nut-grid">
          <div><label className="f" htmlFor="mk">Ккал</label><input id="mk" className="inp" inputMode="decimal" value={f.kcal} onChange={(e: any) => setF({ ...f, kcal: e.target.value })} /></div>
          <div><label className="f" htmlFor="mp">Белки, г</label><input id="mp" className="inp" inputMode="decimal" value={f.p} onChange={(e: any) => setF({ ...f, p: e.target.value })} /></div>
          <div><label className="f" htmlFor="mf">Жиры, г</label><input id="mf" className="inp" inputMode="decimal" value={f.f} onChange={(e: any) => setF({ ...f, f: e.target.value })} /></div>
          <div><label className="f" htmlFor="mc">Углеводы, г</label><input id="mc" className="inp" inputMode="decimal" value={f.c} onChange={(e: any) => setF({ ...f, c: e.target.value })} /></div>
          <div><label className="f" htmlFor="mpk">Вес упаковки, г</label><input id="mpk" className="inp" inputMode="decimal" placeholder="по желанию" value={f.pack} onChange={(e: any) => setF({ ...f, pack: e.target.value })} /></div>
        </div>
        <button className="btn" style={{ marginTop: 12 }} disabled={!f.name.trim() || num(f.kcal) === undefined} onClick={saveOwn}>Запомнить товар</button>
        <button className="btn ghost" onClick={() => { setMiss(null); setMsg(""); }}>Отмена</button>
      </>
    );
  }
  return (
    <>
      <button className="btn" disabled={busy} onClick={() => setScan(true)}>{busy ? "Ищу товар…" : "Сканировать штрихкод"}</button>
      {msg && <p className="err" role="alert">{msg}</p>}
      <p className="muted small">Сначала ищу среди ваших запомненных товаров (без интернета), потом в Open Food Facts. Если товара нет — введите данные с этикетки один раз, и в следующий раз он найдётся сразу.</p>
    </>
  );
}
