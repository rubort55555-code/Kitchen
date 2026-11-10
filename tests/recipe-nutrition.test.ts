// Проверка расчёта пищевой ценности рецептов: node node_modules/.bin/tsx tests/recipe-nutrition.test.ts
import { compositionOf, gramsOf, recipeNutrition, unitKey } from "../src/lib/recipeNutrition";
import { parseRecipeText } from "../tools/recipes.mjs";
import { readFileSync, readdirSync } from "node:fs";
import type { Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const near = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol;

// Единицы и граммы
ok("единица: зубчика → зубчик", unitKey("зубчика") === "зубчик");
ok("единица: ст.л. → ст. л.", unitKey("ст.л.") === "ст. л.");
const g = (name: string, amount: string) => gramsOf({ name, amount });
ok("граммы: 150 г", g("Мука", "150 г") === 150);
ok("граммы: 0,5 кг", g("Картофель", "0,5 кг") === 500);
ok("граммы: по вкусу = 0", g("Соль", "по вкусу") === 0);
ok("граммы: 2 ст. л. муки ≈ 20 г", near(g("Мука", "2 ст. л.")!, 20, 6), g("Мука", "2 ст. л."));
ok("граммы: яйцо ≈ 50–60 г", near(g("Яйца", "1 шт")!, 55, 6), g("Яйца", "1 шт"));
ok("граммы: 2 зубчика чеснока ≈ 10 г", near(g("Чеснок", "2 зубчика")!, 10, 4), g("Чеснок", "2 зубчика"));
ok("граммы: 1–2 шт → среднее", near(g("Яйца", "1–2 шт")!, g("Яйца", "1 шт")! * 1.5, 0.01));
ok("граммы: 200 мл молока ≈ 200 г", near(g("Молоко", "200 мл")!, 206, 8), g("Молоко", "200 мл"));
ok("граммы: непонятная единица → null", g("Мука", "2 горсти") === null);
ok("состав: «Помидоры черри» через справочник", !!compositionOf("Помидоры черри"));

// Все ингредиенты базы рецептов посчитаны
const all: Recipe[] = [];
for (const f of readdirSync("recipes").filter((x) => x.endsWith(".txt"))) all.push(...(parseRecipeText(readFileSync("recipes/" + f, "utf8"), f).recipes as Recipe[]));
const notCounted = new Map<string, number>();
for (const r of all) { const n = recipeNutrition(r); for (const m of n?.missing || []) notCounted.set(m, (notCounted.get(m) || 0) + 1); }
ok("все ингредиенты базы посчитаны", notCounted.size === 0, [...notCounted].slice(0, 20));

// Правдоподобие: известные блюда (на порцию)
const R = (name: string) => all.find((r) => r.name === name)!;
const per = (name: string) => recipeNutrition(R(name))!.perServing;
const om = per("Омлет классический");
ok("омлет: 200–300 ккал на порцию", om.kcal > 200 && om.kcal < 300, om.kcal);
ok("омлет: белка 13–17 г", om.protein > 13 && om.protein < 17, om.protein);
ok("омлет: витамин B12 есть, витамина C почти нет", om.vitB12 > 0.5 && om.vitC < 2, [om.vitB12, om.vitC]);
const oat = per("Овсяная каша на молоке");
ok("овсянка на молоке: 300–400 ккал", oat.kcal > 300 && oat.kcal < 400, oat.kcal);
ok("овсянка: клетчатка 4–7 г", oat.fiber > 4 && oat.fiber < 7, oat.fiber);
const borsch = per("Борщ классический со свёклой");
ok("борщ: 200–400 ккал", borsch.kcal > 200 && borsch.kcal < 400, borsch.kcal);
ok("борщ: натрий от соли 600–1500 мг", borsch.na > 600 && borsch.na < 1500, borsch.na);
ok("борщ: витамин C из капусты и картофеля > 15 мг", borsch.vitC > 15, borsch.vitC);
ok("порции: вдвое больше порций — вдвое меньше на порцию", near(recipeNutrition(R("Омлет классический"), 4)!.perServing.kcal * 2, om.kcal, 0.5));

// Сверка калорийности с Приложением 3 МР 2.3.1.0253-21: белки 4, жиры 9, усвояемые углеводы 4, клетчатка 2 ккал/г
const atwater = (v: { protein: number; fat: number; carbs: number; fiber: number }) => 4 * v.protein + 9 * v.fat + 4 * v.carbs + 2 * v.fiber;
const offMR = all.map((r) => { const v = recipeNutrition(r)!.perServing; return { name: r.name, pct: Math.abs(v.kcal - atwater(v)) / atwater(v) * 100 }; }).filter((x) => x.pct > 10);
ok("калории рецептов расходятся с Приложением 3 МР не больше чем на 10%", offMR.length === 0, offMR.slice(0, 5));
const sorted = all.map((r) => recipeNutrition(r)!.perServing.kcal).sort((a, b) => a - b);
const med = sorted[Math.floor(sorted.length / 2)];
ok("в среднем расхождение с МР до 2%", near(all.reduce((s2, r) => { const v = recipeNutrition(r)!.perServing; return s2 + (v.kcal - atwater(v)) / atwater(v); }, 0) / all.length, 0, 0.02));
// Порция блюда в разумных пределах (кости целой птицы не считаются съедобными)
const heavyKcal = all.map((r) => ({ name: r.name, kcal: recipeNutrition(r)!.perServing.kcal })).filter((x) => x.kcal < 50 || x.kcal > 1300);
ok("калорийность порции каждого рецепта 50–1300 ккал", heavyKcal.length === 0, heavyKcal);
const duck = per("Утка, запечённая с яблоками");
ok("утка запечённая: порция 700–1300 ккал (кости не едят)", duck.kcal > 700 && duck.kcal < 1300, duck.kcal);
const duck2 = per("Утка тушёная с капустой");
ok("утка тушёная с капустой: порция 600–1100 ккал", duck2.kcal > 600 && duck2.kcal < 1100, duck2.kcal);
ok("утка: съедобная доля тушки меньше 1", (compositionOf("Утка") as { y?: number }).y! < 1);
ok("медиана калорийности порции 250–450 ккал", med > 250 && med < 450, med);

// Без известных продуктов — нет расчёта
ok("неизвестные продукты → null", recipeNutrition({ id: "x", name: "x", ingredients: [{ name: "Зюзюка", amount: "1 шт" }], steps: [], source: "manual", createdAt: 0 }) === null);

console.log(`recipe-nutrition: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
