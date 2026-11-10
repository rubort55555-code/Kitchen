// Проверка жидкости из блюд: node node_modules/.bin/tsx tests/fluid.test.ts
import { readFileSync } from "node:fs";
import { dishFluidMl, isLiquid, recipeFluidMl } from "../src/lib/fluid";
import { assess } from "../src/lib/assess";
import { planFor, type BodyProfile } from "../src/lib/nutrition";
import { mealCustom, mealFromRecipe } from "../src/lib/diary";
import { parseRecipeText } from "../tools/recipes.mjs";
import type { Recipe } from "../src/lib/types";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

for (const n of ["Вода", "Бульон куриный", "Молоко", "Кефир", "Сок яблочный", "Чай чёрный", "Отвар шиповника"]) ok(`жидкость: ${n}`, isLiquid(n), n);
for (const n of ["Вафли", "Водка", "Молочный шоколад", "Сокол", "Картофель", "Масло оливковое", "Соль", "Чаша"]) ok(`не жидкость: ${n}`, !isLiquid(n), n);

const supy = parseRecipeText(readFileSync("recipes/02-supy.txt", "utf8"), "02-supy.txt").recipes as Recipe[];
const borsch = supy.find((r) => r.name === "Борщ классический со свёклой")!;
const perServing = recipeFluidMl(borsch, 1);
ok("борщ: жидкости на порцию 300–600 мл (2,5 л воды на 6 порций)", perServing >= 300 && perServing <= 600, perServing);
ok("две порции — вдвое больше", Math.abs(recipeFluidMl(borsch, 2) - perServing * 2) <= 2);
const m = mealFromRecipe(borsch, 1, "2026-11-09", "обед", "m1")!;
ok("запись борща: жидкость блюда как у рецепта", dishFluidMl([m], supy) === perServing);
ok("нет рецепта в списке — 0", dishFluidMl([m], []) === 0);
const milk = { ...mealCustom("Молоко", { kcal: 120 }, "2026-11-09", "завтрак", "m1")!, qty: "200 мл" };
ok("жидкий продукт по названию: 200 мл молока", dishFluidMl([milk], []) === 200);
const bread = { ...mealCustom("Хлеб", { kcal: 120 }, "2026-11-09", "завтрак", "m1")!, qty: "100 г" };
ok("твёрдая еда жидкости не даёт", dishFluidMl([bread], []) === 0);
const body: BodyProfile = { sex: "f", born: 1991, height: 165, weight: 62, goal: "keep" };
const plan = planFor(body, new Date("2026-11-10T12:00:00Z"))!;
const a = assess([m], plan, body, 300, supy)!;
ok("оценка: вода + жидкость блюда", a.water!.v === Math.round((300 + perServing) * 10) / 10 && a.fluid.dishes === perServing && a.fluid.water === 300, [a.water, a.fluid]);
console.log(`fluid: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
