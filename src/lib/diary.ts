// Дневник питания: чистая логика (без доступа к хранилищу) — записи, суммы за день, остаток до нормы, подсказки.
import type { Meal, MealSlot, Recipe } from "./types";
import { NUTRIENTS, compositionOf, recipeNutrition, type NutrientKey } from "./recipeNutrition";
import type { OffProduct } from "./off";
import type { Drink } from "./interactions";
import type { Plan } from "./nutrition";
import { norm, uid } from "./util";
import DATA from "./compositionData.json";

export type N = Partial<Record<NutrientKey, number>>;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Слот по времени суток: утром — завтрак, днём — обед, вечером — ужин, ночью — перекус. */
export function slotByHour(h: number): MealSlot {
  if (h >= 5 && h < 11) return "завтрак";
  if (h >= 11 && h < 16) return "обед";
  if (h >= 16 && h < 21) return "ужин";
  return "перекус";
}

function mk(date: string, slot: MealSlot, name: string, n: N, who: string | undefined, extra: Partial<Meal> = {}): Meal {
  const rounded: N = {};
  for (const [k, v] of Object.entries(n)) if (typeof v === "number" && isFinite(v)) rounded[k as NutrientKey] = r1(v);
  return { id: uid(), date, t: Date.now(), slot, name, who, n: rounded, ...extra };
}

/** Порции рецепта: пищевая ценность на порцию × число порций. null — рецепт не посчитать. */
export function mealFromRecipe(r: Recipe, servings: number, date: string, slot: MealSlot, who?: string): Meal | null {
  const rn = recipeNutrition(r);
  if (!rn || !(servings > 0)) return null;
  const n: N = {};
  for (const x of NUTRIENTS) n[x.key] = rn.perServing[x.key] * servings;
  const q = servings === 1 ? "1 порция" : `${String(servings).replace(".", ",")} порции`;
  return mk(date, slot, r.name, n, who, { recipeId: r.id, qty: q, servings });
}

/** Продукт из справочника состава на заданный вес в граммах. */
export function mealFromComposition(name: string, grams: number, date: string, slot: MealSlot, who?: string): Meal | null {
  const e = compositionOf(name);
  if (!e || !(grams > 0)) return null;
  const n: N = {};
  NUTRIENTS.forEach((x, k) => { n[x.key] = ((e.v[k] ?? 0) * grams) / 100; });
  return mk(date, slot, name, n, who, { qty: `${Math.round(grams)} г` });
}

/** Товар по штрихкоду (Open Food Facts) на заданный вес. null — на упаковке нет калорийности. */
export function mealFromOff(p: OffProduct, name: string, grams: number, date: string, slot: MealSlot, who?: string): Meal | null {
  const c = p.per100;
  if (!c || typeof c.kcal !== "number" || !(grams > 0)) return null;
  const k = grams / 100;
  const n: N = { kcal: c.kcal * k };
  if (c.p !== undefined) n.protein = c.p * k;
  if (c.f !== undefined) n.fat = c.f * k;
  if (c.c !== undefined) n.carbs = c.c * k;
  if (c.fiber !== undefined) n.fiber = c.fiber * k;
  if (c.sugar !== undefined) n.sugar = c.sugar * k;
  if (c.salt !== undefined) n.na = c.salt * 400 * k; // соль, г → натрий, мг (в соли 40% натрия)
  if (c.fe !== undefined) n.fe = c.fe * k;
  if (c.ca !== undefined) n.ca = c.ca * k;
  if (c.vitC !== undefined) n.vitC = c.vitC * k;
  // На российских этикетках микроэлементы обычно не указаны (в выборке Open Food Facts для России железо есть у 5% товаров):
  // недостающее оцениваем по справочнику состава для такого же продукта и помечаем как оценку
  const estimated = estimateMissing(n, name, grams);
  return mk(date, slot, name, n, who, { qty: `${Math.round(grams)} г`, ...(estimated ? { estimated: true } : {}), ...(p.cats ? { cats: p.cats } : {}), ...(p.ingredients ? { ingredients: p.ingredients } : {}) });
}

const MACRO_KEYS = new Set<NutrientKey>(["kcal", "protein", "fat", "carbs", "fiber", "sugar"]);
/** Дополняет микроэлементы по справочнику состава (на 100 г × вес). Возвращает true, если что-то добавлено. */
export function estimateMissing(n: N, name: string, grams: number): boolean {
  const e = compositionOf(name);
  if (!e || !(grams > 0)) return false;
  let added = false;
  NUTRIENTS.forEach((x, i) => {
    if (MACRO_KEYS.has(x.key) || n[x.key] !== undefined || e.v[i] == null) return;
    n[x.key] = ((e.v[i] as number) * grams) / 100;
    added = true;
  });
  return added;
}

/** Своё блюдо: человек вводит калории и БЖУ на всё съеденное. */
export function mealCustom(name: string, v: { kcal: number; protein?: number; fat?: number; carbs?: number }, date: string, slot: MealSlot, who?: string): Meal | null {
  if (!name.trim() || !(v.kcal >= 0)) return null;
  const n: N = { kcal: v.kcal };
  if (v.protein !== undefined) n.protein = v.protein;
  if (v.fat !== undefined) n.fat = v.fat;
  if (v.carbs !== undefined) n.carbs = v.carbs;
  return mk(date, slot, name.trim(), n, who);
}

/** Напиток с кофеином: количество порций × кофеин и калории порции. */
export function mealDrink(d: Drink, count: number, date: string, slot: MealSlot, who?: string): Meal | null {
  if (!(count > 0)) return null;
  const k = count;
  const ml = d.ml * k;
  return mk(date, slot, d.name, { kcal: d.kcal * k }, who, { qty: `${Math.round(ml)} мл`, caffeine: Math.round(d.caffeine * k) });
}

/** Та же запись на другую дату или в другое время суток («повторить вчера», «ещё раз»). */
export function copyMeal(m: Meal, date: string, slot: MealSlot = m.slot): Meal {
  const { planEntryId: _p, ...rest } = m;
  return { ...rest, id: uid(), date, slot, t: Date.now() };
}

/** Ключи показателей, которые суммируем в дневнике. */
export const DAY_KEYS: NutrientKey[] = ["kcal", "protein", "fat", "carbs", "fiber", "sugar", "satFat", "na", "chol"];

export function sumMeals(meals: Meal[]): Record<NutrientKey, number> {
  const s = Object.fromEntries(NUTRIENTS.map((x) => [x.key, 0])) as Record<NutrientKey, number>;
  for (const m of meals) for (const [k, v] of Object.entries(m.n)) s[k as NutrientKey] += v || 0;
  return s;
}

/** Записи дня одного человека, по порядку приёмов пищи и времени. */
export function mealsOf(all: Meal[], date: string, who?: string): Meal[] {
  const order: MealSlot[] = ["завтрак", "обед", "ужин", "перекус"];
  return all.filter((m) => m.date === date && (!who || !m.who || m.who === who))
    .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || a.t - b.t);
}

export type Level = "low" | "ok" | "over";
/** Калории: до 90% нормы — мало, 90–110% — в норме, выше — много. */
export function kcalLevel(eaten: number, target: number): Level {
  if (!target) return "ok";
  const r = eaten / target;
  return r < 0.9 ? "low" : r <= 1.1 ? "ok" : "over";
}

export interface DayView {
  eaten: Record<NutrientKey, number>;
  /** Остаток до нормы по калориям (может быть отрицательным — перебор). */
  left: number;
  level: Level;
  /** Подсказки «чего не хватает» и о превышении пределов. */
  hints: string[];
}

/** Итог дня против нормы из planFor(): остаток калорий, подсказки по белку, клетчатке и пределам «не больше». */
export function dayView(meals: Meal[], plan: Plan | null, hour = 24): DayView {
  const eaten = sumMeals(meals);
  const hints: string[] = [];
  if (!plan) return { eaten, left: 0, level: "ok", hints };
  const left = plan.kcal - eaten.kcal;
  const late = hour >= 15 && meals.length > 0; // днём ещё рано упрекать
  if (meals.length && late && eaten.protein < plan.protein * 0.6 && left > 0) hints.push(`Белка пока ${Math.round(eaten.protein)} из ${plan.protein} г — добавьте мясо, рыбу, яйца, творог или бобовые.`);
  if (meals.length && hour >= 17 && eaten.fiber < plan.fiber * 0.5) hints.push(`Клетчатки ${Math.round(eaten.fiber)} из ${plan.fiber} г — добавьте овощи, фрукты, цельнозерновой хлеб или крупы.`);
  if (eaten.sugar > plan.sugarMax * 2.5 && plan.sugarMax) hints.push("Много сахаров: в сумме с природными это не страшно, но добавленных сладостей лучше меньше.");
  if (eaten.na > plan.naMax) hints.push(`Натрия ${Math.round(eaten.na)} мг — выше предела ${plan.naMax} мг (около ${plan.saltMax} г соли).`);
  if (eaten.chol > plan.cholMax) hints.push(`Холестерина ${Math.round(eaten.chol)} мг — выше предела ${plan.cholMax} мг.`);
  if (eaten.satFat > plan.satFatMax) hints.push(`Насыщенных жиров ${Math.round(eaten.satFat)} г — выше предела ${plan.satFatMax} г.`);
  if (left < -0.1 * plan.kcal) hints.push(`Калорий больше нормы на ${Math.round(-left)} ккал — завтра можно чуть легче, но без голодания.`);
  return { eaten, left, level: kcalLevel(eaten.kcal, plan.kcal), hints };
}

/** Недавние уникальные блюда — для быстрого повтора в один касание. */
export function recentMeals(all: Meal[], who: string | undefined, limit = 8): Meal[] {
  const seen = new Set<string>();
  const out: Meal[] = [];
  for (const m of [...all].sort((a, b) => b.t - a.t)) {
    if (who && m.who && m.who !== who) continue;
    const k = norm(m.name) + "|" + (m.qty || "");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

/** Поиск по справочнику состава продуктов (названия). */
export function searchFoods(q: string, limit = 30): string[] {
  const k = norm(q);
  const names = (DATA as unknown as { items: { n: string }[] }).items.map((x) => x.n);
  if (!k) return names.slice(0, limit);
  const starts = names.filter((n) => norm(n).startsWith(k));
  const has = names.filter((n) => !norm(n).startsWith(k) && norm(n).includes(k));
  return [...starts, ...has].slice(0, limit);
}

/** Вес порции по умолчанию для продукта: «шт» из справочника, иначе 100 г. */
export function defaultGrams(name: string): number {
  const e = compositionOf(name);
  const u = e?.u?.["шт"];
  return typeof u === "number" && u > 0 ? Math.round(u) : 100;
}
