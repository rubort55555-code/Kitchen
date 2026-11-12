// Меню на неделю против норм человека (этап 2 плана): порции под человека и оценка по приоритетам.
// Приоритеты (выше — важнее, ниже никогда не ухудшает выше):
//  1) запреты (аллергии, исключения); 2) калории ±5% и БЖУ каждый день; 3) пределы «не больше» в среднем за неделю;
//  4) витамины, минералы, клетчатка не ниже 90% нормы в среднем за неделю; 5) разнообразие.
// Продукты дома, сроки и бюджет здесь не оцениваются: они выбирают только между равноценными вариантами.
import type { Meal, PlanEntry, Recipe } from "./types";
import { mealFromRecipe } from "./diary";
import { assess, type Row } from "./assess";
import type { BodyProfile, Plan } from "./nutrition";
import { checkRecipe, compileRules } from "./exclusions";
import { proteinOf } from "./plan";
import { garnishNeed } from "./garnish";

export const PORTION_MIN = 0.5;
export const PORTION_MAX = 2;
export const PORTION_STEP = 0.25;
/** Доля суточной нормы на приёмы пищи, которые стоят в меню дня: если выбран только обед, нормы всего дня на него не накладываются. */
const SLOT_SHARE: Record<string, number> = { завтрак: 0.3, обед: 0.4, ужин: 0.3, перекус: 0.1 };
export function daySlotShare(slots: Iterable<string>): number {
  let t = 0;
  for (const s of new Set(slots)) t += SLOT_SHARE[s] || 0;
  return Math.min(1, t) || 1;
}
/** Нормы человека на часть дня. */
export function scalePlan(plan: Plan, share: number): Plan {
  if (share >= 1) return plan;
  return { ...plan, kcal: plan.kcal * share, protein: plan.protein * share, fat: plan.fat * share, carbs: plan.carbs * share, fiber: plan.fiber * share };
}

export const KCAL_TOL = 0.05; // калории дня: ±5% цели
export const FAT_CARB_TOL = 0.1; // жиры и углеводы дня: ±10% нормы
export const MICRO_MIN = 0.9; // витамины и минералы в среднем за неделю: не ниже 90% нормы

export const snapPortion = (x: number) => Math.min(PORTION_MAX, Math.max(PORTION_MIN, Math.round(x / PORTION_STEP) * PORTION_STEP));
/** Порция основного блюда этого человека; не задана — одна. Салат и десерт к блюду считаются как одна порция. */
export const portionOf = (e: PlanEntry, who: string) => e.portions?.[who] ?? 1;

interface Calc { meals: Meal[]; unknown: string[] }
/** Блюда меню как записи питания человека (по порциям). Блюда без рецепта или без расчёта состава возвращаются в unknown. */
export function menuMeals(entries: PlanEntry[], recipes: Recipe[], who: string): Calc {
  const meals: Meal[] = [];
  const unknown: string[] = [];
  const add = (id: string | undefined, name: string, servings: number, e: PlanEntry) => {
    const r = id ? recipes.find((x) => x.id === id) : undefined;
    const m = r ? mealFromRecipe(r, servings, e.date, e.slot, who) : null;
    if (m) meals.push({ ...m, planEntryId: e.id });
    else unknown.push(name);
  };
  for (const e of entries) {
    add(e.recipeId, e.name, portionOf(e, who), e);
    // Гарнир идёт вместе с блюдом: порция та же
    if (e.garnish) add(e.garnish.id, e.garnish.name, portionOf(e, who), e);
    if (e.side) add(e.side.id, e.side.name, 1, e);
    if (e.sweet) add(e.sweet.id, e.sweet.name, 1, e);
  }
  return { meals, unknown };
}

const sum = (ms: Meal[], k: "kcal" | "protein" | "fat" | "carbs") => ms.reduce((s, m) => s + (m.n[k] || 0), 0);

export interface Fit { portions: Record<string, number>; kcal: number; diff: number }
/** Подбор порций основных блюд одного дня под цель по калориям (шаг 0,25, от 0,5 до 2). Салат и десерт остаются одной порцией. */
export function fitDay(entries: PlanEntry[], recipes: Recipe[], who: string, fullPlan: Plan): Fit | null {
  const plan = scalePlan(fullPlan, daySlotShare(entries.map((e) => e.slot)));
  const mealAt = (id: string | undefined, e: PlanEntry) => { const r = id ? recipes.find((x) => x.id === id) : undefined; return r ? mealFromRecipe(r, 1, e.date, e.slot, who) : null; };
  // Блюдо вместе с гарниром на одну порцию
  const unit = (e: PlanEntry) => {
    const m = mealAt(e.recipeId, e);
    if (!m) return null;
    const g = e.garnish ? mealAt(e.garnish.id, e) : null;
    return { kcal: (m.n.kcal || 0) + (g?.n.kcal || 0), protein: (m.n.protein || 0) + (g?.n.protein || 0) };
  };
  const mains = entries.filter((e) => e.recipeId && unit(e));
  if (!mains.length) return null;
  const perOne = new Map(mains.map((e) => [e.id, unit(e)!]));
  const extras = entries.flatMap((e) => [e.side, e.sweet].filter(Boolean).map((x) => mealFromRecipe(recipes.find((r) => r.id === x!.id) as Recipe, 1, e.date, e.slot, who)).filter(Boolean) as Meal[]);
  const fixed = sum(extras, "kcal");
  const T = plan.kcal;
  const base = mains.reduce((s, e) => s + (perOne.get(e.id)!.kcal || 0), 0);
  const p0 = snapPortion(base > 0 ? (T - fixed) / base : 1);
  const p: Record<string, number> = Object.fromEntries(mains.map((e) => [e.id, p0]));
  const total = () => fixed + mains.reduce((s, e) => s + p[e.id] * (perOne.get(e.id)!.kcal || 0), 0);
  const prot = () => extras.reduce((s, m) => s + (m.n.protein || 0), 0) + mains.reduce((s, e) => s + p[e.id] * (perOne.get(e.id)!.protein || 0), 0);
  // Чем меньше, тем лучше: отклонение по калориям; при равенстве — белок не ниже нормы и порции ближе друг к другу
  const cost = () => Math.abs(total() - T) + Math.max(0, plan.protein - prot()) * 2 + Object.values(p).reduce((s, x) => s + Math.abs(x - p0), 0) * 3;
  for (let it = 0; it < 60; it++) {
    let best = cost(), move: [string, number] | null = null;
    for (const e of mains) for (const d of [-PORTION_STEP, PORTION_STEP]) {
      const nv = p[e.id] + d;
      if (nv < PORTION_MIN || nv > PORTION_MAX) continue;
      const old = p[e.id]; p[e.id] = nv;
      const c = cost();
      p[e.id] = old;
      if (c < best - 1e-9) { best = c; move = [e.id, nv]; }
    }
    if (!move) break;
    p[move[0]] = move[1];
  }
  const kcal = total();
  return { portions: p, kcal: Math.round(kcal), diff: Math.round(((kcal - T) / T) * 1000) / 10 };
}

/** Порции для всех дней меню человека: id блюда меню → порции. */
export function fitWeek(entries: PlanEntry[], recipes: Recipe[], who: string, plan: Plan): { portions: Record<string, number>; days: { date: string; fit: Fit }[] } {
  const portions: Record<string, number> = {};
  const days: { date: string; fit: Fit }[] = [];
  for (const date of [...new Set(entries.map((e) => e.date))].sort()) {
    const fit = fitDay(entries.filter((e) => e.date === date), recipes, who, plan);
    if (!fit) continue;
    Object.assign(portions, fit.portions);
    days.push({ date, fit });
  }
  return { portions, days };
}

export interface DayRes { date: string; kcal: number; target: number; pct: number; protein: number; fat: number; carbs: number; kcalOk: boolean; proteinOk: boolean; fatOk: boolean; carbsOk: boolean; ok: boolean; slots: number }
export interface Level { n: 1 | 2 | 3 | 4 | 5; title: string; ok: boolean; items: string[] }
export interface MenuEval {
  days: number;
  unknown: string[];
  dayRes: DayRes[];
  limits: Row[];
  micro: Row[];
  /** Витамины и минералы ниже 90% нормы (по которым есть данные). */
  lacking: Row[];
  /** По каким нутриентам в рецептах нет данных вовсе. */
  noData: string[];
  levels: Level[];
  /** Все уровни 1–4 в норме. */
  ok: boolean;
}

/** Оценка меню на нужные даты для одного человека по приоритетам. */
export function evaluateMenu(entries: PlanEntry[], dates: string[], recipes: Recipe[], member: { id: string; body: BodyProfile }, fullPlan: Plan, rules: Parameters<typeof compileRules>): MenuEval {
  const mine = entries.filter((e) => dates.includes(e.date));
  const { meals, unknown } = menuMeals(mine, recipes, member.id);
  const compiled = compileRules(...rules);

  // 1. Запреты
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const e of mine) for (const [id, name] of [[e.recipeId, e.name], [e.garnish?.id, e.garnish?.name], [e.side?.id, e.side?.name], [e.sweet?.id, e.sweet?.name]] as [string | undefined, string | undefined][]) {
    const r = id ? recipes.find((x) => x.id === id) : undefined;
    if (!r || !name) continue;
    const res = checkRecipe(r, compiled, [member.id]);
    if (res.verdict === "hidden" && !seen.has(r.id)) { seen.add(r.id); bad.push(`${name}: ${res.issues[0]?.msg || "запрещено правилами"}`); }
  }

  // 2. Каждый день
  const dayRes: DayRes[] = [...new Set(mine.map((e) => e.date))].sort().map((date) => {
    const dm = meals.filter((m) => m.date === date);
    const plan = scalePlan(fullPlan, daySlotShare(mine.filter((e) => e.date === date).map((e) => e.slot)));
    const kcal = sum(dm, "kcal"), protein = sum(dm, "protein"), fat = sum(dm, "fat"), carbs = sum(dm, "carbs");
    const kcalOk = Math.abs(kcal - plan.kcal) <= plan.kcal * KCAL_TOL;
    const proteinOk = protein >= plan.protein;
    const fatOk = Math.abs(fat - plan.fat) <= plan.fat * FAT_CARB_TOL;
    const carbsOk = Math.abs(carbs - plan.carbs) <= plan.carbs * FAT_CARB_TOL;
    return { date, kcal: Math.round(kcal), target: plan.kcal, pct: Math.round((kcal / plan.kcal) * 100), protein: Math.round(protein), fat: Math.round(fat), carbs: Math.round(carbs), kcalOk, proteinOk, fatOk, carbsOk, ok: kcalOk && proteinOk && fatOk && carbsOk, slots: mine.filter((e) => e.date === date).length };
  });

  // 3–4. Среднее за неделю: считает та же оценка, что и в дневнике
  const a = assess(meals, fullPlan, member.body, 0, recipes);
  const limits = a ? a.limits : [];
  const micro = a ? a.micro : [];
  const noData = micro.filter((r) => r.v === 0).map((r) => r.title);
  const withData = micro.filter((r) => r.v > 0 || false);
  const lacking = withData.filter((r) => r.pct < MICRO_MIN * 100);
  const fiber = a?.macro.find((r) => r.key === "fiber");
  if (fiber && fiber.pct < MICRO_MIN * 100) lacking.unshift(fiber);

  // 5. Разнообразие
  const variety: string[] = [];
  const counts = new Map<string, number>();
  for (const e of mine) if (e.recipeId) counts.set(e.recipeId, (counts.get(e.recipeId) || 0) + 1);
  for (const [id, n] of counts) if (n > 2) variety.push(`«${recipes.find((r) => r.id === id)?.name || "Блюдо"}» в меню ${n} раза за неделю — не больше двух`);
  const mainEntries = mine.filter((e) => e.recipeId && (e.slot === "обед" || e.slot === "ужин"));
  if (mainEntries.length >= 6 && mainEntries.filter((e) => proteinOf(recipes.find((r) => r.id === e.recipeId) as Recipe) === "рыба").length < 2) variety.push("Рыбы меньше двух раз за неделю");

  for (const e of mine) {
    const r = e.recipeId ? recipes.find((x) => x.id === e.recipeId) : undefined;
    if (r && !e.garnish && garnishNeed(r, e.slot) === "required") variety.push(`К «${e.name}» нужен гарнир`);
  }

  const levels: Level[] = [
    { n: 1, title: "Запреты", ok: !bad.length, items: bad },
    { n: 2, title: "Калории и БЖУ каждый день", ok: dayRes.length > 0 && dayRes.every((d) => d.ok), items: dayRes.filter((d) => !d.ok).map((d) => `${d.date}: ${d.pct}% калорий${d.proteinOk ? "" : ", белка мало"}${d.fatOk ? "" : ", жиры вне нормы"}${d.carbsOk ? "" : ", углеводы вне нормы"}`) },
    { n: 3, title: "Пределы «не больше»", ok: limits.every((r) => r.status === "ok"), items: limits.filter((r) => r.status !== "ok").map((r) => `${r.title}: в среднем ${r.v} ${r.unit} при пределе ${r.target}`) },
    { n: 4, title: "Витамины, минералы, клетчатка", ok: lacking.length === 0, items: lacking.map((r) => `${r.title}: ${r.pct}% нормы`) },
    { n: 5, title: "Разнообразие и гарниры", ok: variety.length === 0, items: variety },
  ];
  return { days: dayRes.length, unknown, dayRes, limits, micro, lacking, noData, levels, ok: levels.slice(0, 4).every((l) => l.ok) };
}
