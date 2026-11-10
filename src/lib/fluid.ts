// Жидкость из блюд: вода, бульон, молоко и другие жидкие ингредиенты рецепта считаются в питьевой режим.
// МР 2.3.1.0253-21 (раздел о воде): ≈ 60% воды поступает в виде питьевой воды и жидкостей в составе блюд и напитков (чай, кофе, компоты, супы), ≈ 40% — с твёрдой пищей.
// Таблица 7 даёт норму для первой части, поэтому вода из твёрдой пищи (овощи, фрукты, мясо) в этот счёт не входит.
import type { Meal, Recipe } from "./types";
import { gramsOf } from "./recipeNutrition";

const w = (src: string) => new RegExp("^(" + src + ")", "i");
/** Жидкие ингредиенты по названию (начало названия). Сироп, масло, соусы и уксус не считаем. */
const LIQUID = w("вода|бульон|отвар|молоко|кефир|ряженк|простокваш|айран|тан(?![а-яё])|сок(?![а-яё])|квас|компот|морс|чай|кофе|сливки жидк|сливки \\d|рассол|кисель|молочная сыворотка|сыворотка");
export const isLiquid = (name: string) => LIQUID.test(name.trim());

/** Жидкость блюда из рецепта на съеденные порции, мл (оценка по жидким ингредиентам; часть воды при варке испаряется). */
export function recipeFluidMl(r: Recipe, servings: number): number {
  let ml = 0;
  for (const i of r.ingredients) {
    if (!isLiquid(i.name)) continue;
    const g = gramsOf(i);
    if (g && g > 0) ml += g; // 1 г ≈ 1 мл
  }
  return Math.round((ml * servings) / Math.max(1, r.servings || 1));
}

/** Жидкость из записей дневника: блюда с жидкими ингредиентами и жидкие продукты по названию («Молоко», «Кефир»). Напитки с кофеином считаются отдельно (drinksMl). */
export function dishFluidMl(meals: Meal[], recipes: Recipe[]): number {
  let s = 0;
  for (const m of meals) {
    if (m.caffeine !== undefined) continue;
    if (m.recipeId) {
      const r = recipes.find((x) => x.id === m.recipeId);
      if (r) s += recipeFluidMl(r, m.servings ?? 1);
      continue;
    }
    const q = m.qty?.match(/^(\d+(?:[.,]\d+)?)\s*(г|мл)/);
    if (q && isLiquid(m.name)) s += Number(q[1].replace(",", "."));
  }
  return Math.round(s);
}
