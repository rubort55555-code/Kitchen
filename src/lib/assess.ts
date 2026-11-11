// Оценка рациона по МР 2.3.1.0253-21: что съедено за день или за неделю против личной нормы (макронутриенты, пределы «не больше», вода, витамины и минералы).
// Чистая логика. За неделю берём среднее за дни, в которые что-то записано: дни без записей не считаем голоданием.
import type { Meal, Recipe } from "./types";
import { dishFluidMl } from "./fluid";
import { micros, type BodyProfile, type Plan } from "./nutrition";
import { NUTRIENTS, type NutrientKey } from "./recipeNutrition";
import { hasMicroData, sumMeals } from "./diary";

export type Status = "ok" | "near" | "low" | "over";
export interface Row { key: string; title: string; unit: string; v: number; target: number; mode: "target" | "min" | "max"; pct: number; status: Status }
export interface Assessment {
  /** Дней с записями. */
  days: number;
  macro: Row[];
  limits: Row[];
  water: Row | null;
  micro: Row[];
  /** Из чего сложилась жидкость за день в среднем, мл: питьё, напитки из записей, жидкость блюд. */
  fluid: { water: number; drinks: number; dishes: number };
  /** Сколько записей без данных о витаминах и минералах. */
  noMicro: number;
  records: number;
  /** Сколько показателей из макро, пределов и воды в норме и сколько всего. */
  good: number;
  total: number;
  issues: string[];
}

/** Напитки, записанные во вкладке «Напиток» (с кофеином), вместе с объёмом в мл. */
export function drinksMl(meals: Meal[]): number {
  let s = 0;
  for (const m of meals) {
    if (m.caffeine === undefined) continue;
    const q = m.qty?.match(/^(\d+(?:[.,]\d+)?)\s*мл/);
    if (q) s += Number(q[1].replace(",", "."));
  }
  return s;
}

const mk = (key: string, title: string, unit: string, v: number, target: number, mode: Row["mode"], status: Status): Row =>
  ({ key, title, unit, v: Math.round(v * 10) / 10, target: Math.round(target * 10) / 10, mode, pct: target ? Math.round((v / target) * 100) : 0, status });
const range = (v: number, t: number, lo: number, hi: number): Status => (v < t * lo ? "low" : v > t * hi ? "over" : "ok");
const atLeast = (v: number, t: number): Status => (v >= t ? "ok" : v >= t * 0.7 ? "near" : "low");
const atMost = (v: number, t: number): Status => (v > t ? "over" : "ok");

const MICRO_SKIP = new Set(["na"]);

/** meals — записи за нужные даты (одного человека); waterMl — выпитая вода за эти даты, сумма; recipes — для жидкости из блюд. */
export function assess(meals: Meal[], plan: Plan, body: BodyProfile, waterMl: number, recipes: Recipe[] = []): Assessment | null {
  const dates = [...new Set(meals.map((m) => m.date))];
  const days = dates.length;
  if (!days) return null;
  const s = sumMeals(meals);
  const a = (k: NutrientKey) => (s[k] || 0) / days;

  const kcal = a("kcal");
  const macro: Row[] = [
    mk("kcal", "Энергия", "ккал", kcal, plan.kcal, "target", kcal < plan.kcal * 0.9 ? "low" : kcal > plan.kcal * 1.1 ? "over" : "ok"),
    mk("protein", "Белки", "г", a("protein"), plan.protein, "target", plan.uro ? (a("protein") < plan.uro.proteinMin * 0.9 ? "low" : a("protein") > plan.uro.proteinMax ? "over" : "ok") : range(a("protein"), plan.protein, 0.85, 1.3)),
    mk("fat", "Жиры", "г", a("fat"), plan.fat, "target", range(a("fat"), plan.fat, 0.8, 1.2)),
    mk("carbs", "Углеводы", "г", a("carbs"), plan.carbs, "target", range(a("carbs"), plan.carbs, 0.75, 1.25)),
    mk("fiber", "Клетчатка", "г", a("fiber"), plan.fiber, "min", atLeast(a("fiber"), plan.fiber)),
  ];
  // Сахара в записях — все (с природными), поэтому порог мягче, чем «добавленный сахар» нормы (как в подсказках дня)
  const limits: Row[] = [
    mk("sugar", "Сахара (все)", "г", a("sugar"), plan.sugarMax * 2.5, "max", atMost(a("sugar"), plan.sugarMax * 2.5)),
    mk("satFat", "Насыщенные жиры", "г", a("satFat"), plan.satFatMax, "max", atMost(a("satFat"), plan.satFatMax)),
    mk("chol", "Холестерин", "мг", a("chol"), plan.cholMax, "max", atMost(a("chol"), plan.cholMax)),
    mk("na", "Натрий", "мг", a("na"), plan.naMax, "max", atMost(a("na"), plan.naMax)),
  ].concat(plan.uro ? [mk("caMax", "Кальций из еды (при мочекаменной болезни — не больше)", "мг", a("ca"), plan.uro.caMax, "max", atMost(a("ca"), plan.uro.caMax))] : []).filter((r) => r.v > 0 || r.key === "na");
  const dishes = dishFluidMl(meals, recipes);
  const fluid = (waterMl + drinksMl(meals) + dishes) / days;
  const water = plan.water > 0 ? mk("water", "Вода и напитки", "мл", fluid, plan.water * 1000, "min", fluid >= plan.water * 850 ? "ok" : fluid >= plan.water * 600 ? "near" : "low") : null;

  const keys = new Set<string>(NUTRIENTS.map((x) => x.key));
  const micro = micros(body)
    .filter((x) => keys.has(x.key) && !MICRO_SKIP.has(x.key))
    .map((x) => { const v = a(x.key as NutrientKey); return mk(x.key, x.title, x.unit, v, x.amount, "min", v >= x.amount * 0.9 ? "ok" : v >= x.amount * 0.7 ? "near" : "low"); });

  const noMicro = meals.filter((m) => !hasMicroData(m)).length;
  const checked = [...macro, ...limits, ...(water ? [water] : [])];
  const bad = checked.filter((r) => r.status !== "ok");
  const issues = bad.map((r) => {
    if (r.mode === "max") return `${r.title}: ${r.v} ${r.unit} — выше предела ${r.target}`;
    if (r.status === "over") return `${r.title}: ${r.pct}% нормы — больше нормы`;
    return `${r.title}: ${r.pct}% нормы`;
  });
  return { days, macro, limits, water, fluid: { water: Math.round(waterMl / days), drinks: Math.round(drinksMl(meals) / days), dishes: Math.round(dishes / days) }, micro, noMicro, records: meals.length, good: checked.length - bad.length, total: checked.length, issues };
}

export const STATUS_TEXT: Record<Status, string> = { ok: "в норме", near: "чуть не дотягивает", low: "мало", over: "много" };
