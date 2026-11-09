// Проверка дневника питания (чистая логика): node node_modules/.bin/tsx tests/diary.test.ts
import { copyMeal, dayView, defaultGrams, kcalLevel, mealCustom, mealFromComposition, mealFromOff, mealFromRecipe, mealsOf, recentMeals, searchFoods, slotByHour, sumMeals } from "../src/lib/diary";
import { newProfile, planFor, type BodyProfile } from "../src/lib/nutrition";
import { recipeNutrition } from "../src/lib/recipeNutrition";
import { parseRecipeText } from "../tools/recipes.mjs";
import { readFileSync, readdirSync } from "node:fs";
import type { Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const near = (x: number, y: number, tol: number) => Math.abs(x - y) <= tol;

const all: Recipe[] = [];
for (const f of readdirSync("recipes").filter((x) => x.endsWith(".txt"))) all.push(...(parseRecipeText(readFileSync("recipes/" + f, "utf8"), f).recipes as Recipe[]));
const omelet = all.find((r) => r.name === "Омлет классический")!;
const rn = recipeNutrition(omelet)!;

// Слот по времени суток
ok("слот: 8 утра — завтрак, 13 — обед, 19 — ужин, 23 и 3 ночи — перекус", slotByHour(8) === "завтрак" && slotByHour(13) === "обед" && slotByHour(19) === "ужин" && slotByHour(23) === "перекус" && slotByHour(3) === "перекус");

// Рецепт: порции × ценность на порцию
const m1 = mealFromRecipe(omelet, 1, "2026-11-09", "завтрак", "m1")!;
ok("рецепт: 1 порция = ценность на порцию", near(m1.n.kcal!, rn.perServing.kcal, 0.1) && near(m1.n.protein!, rn.perServing.protein, 0.1), [m1.n.kcal, rn.perServing.kcal]);
const m15 = mealFromRecipe(omelet, 1.5, "2026-11-09", "завтрак", "m1")!;
ok("рецепт: 1,5 порции = в полтора раза больше", near(m15.n.kcal!, rn.perServing.kcal * 1.5, 0.2) && m15.qty === "1,5 порции");
ok("рецепт: id и дата записаны", m1.recipeId === omelet.id && m1.date === "2026-11-09" && m1.who === "m1" && m1.slot === "завтрак");
ok("рецепт: ноль порций — нет записи", mealFromRecipe(omelet, 0, "2026-11-09", "обед") === null);

// Продукт из справочника
const apple = mealFromComposition("Яблоки", 200, "2026-11-09", "перекус")!;
ok("продукт: 200 г яблок ≈ 70–130 ккал", apple && apple.n.kcal! > 70 && apple.n.kcal! < 130, apple?.n.kcal);
ok("продукт: клетчатка есть", apple.n.fiber! > 2);
ok("продукт: вес в записи", apple.qty === "200 г");
ok("продукт: неизвестное — нет записи", mealFromComposition("Зюзюка", 100, "2026-11-09", "обед") === null);
ok("продукт: ноль граммов — нет записи", mealFromComposition("Яблоки", 0, "2026-11-09", "обед") === null);
ok("вес по умолчанию: яблоко — штука из справочника, прочее 100", defaultGrams("Яблоки") > 50 && defaultGrams("Зюзюка") === 100);

// Штрихкод: 100 г → из упаковки; соль → натрий
const off = { code: "4600000000000", title: "Йогурт", per100: { kcal: 90, p: 4, f: 3, c: 12, fiber: 0, sugar: 11, salt: 0.1 } };
const o = mealFromOff(off, "Йогурт", 250, "2026-11-09", "перекус")!;
ok("штрихкод: 250 г → ккал и БЖУ в 2,5 раза больше", o.n.kcal === 225 && o.n.protein === 10 && o.n.fat === 7.5 && o.n.carbs === 30);
ok("штрихкод: соль 0,1 г/100 г → натрий 40 мг/100 г", near(o.n.na!, 100, 0.2), o.n.na);
ok("штрихкод: без калорийности — нет записи", mealFromOff({ code: "1", title: "x", per100: { p: 1 } }, "x", 100, "2026-11-09", "обед") === null);

// Своё блюдо
const own = mealCustom("Обед в кафе", { kcal: 650, protein: 30 }, "2026-11-09", "обед")!;
ok("своё: калории и белок записаны, жиров нет", own.n.kcal === 650 && own.n.protein === 30 && own.n.fat === undefined);
ok("своё: без названия — нет записи", mealCustom("  ", { kcal: 100 }, "2026-11-09", "обед") === null);
ok("своё: ккал 0 допустимы (чай)", mealCustom("Чай", { kcal: 0 }, "2026-11-09", "перекус") !== null);

// Копирование
const c = copyMeal({ ...m1, planEntryId: "pe1" }, "2026-11-10", "обед");
ok("копия: новый id, дата, слот; связь с меню не переносится", c.id !== m1.id && c.date === "2026-11-10" && c.slot === "обед" && c.planEntryId === undefined && c.n.kcal === m1.n.kcal);

// Суммы и выборка по дню/человеку
const day = [m1, apple, own, { ...copyMeal(m1, "2026-11-08") }];
ok("суммы: калории = сумма записей", near(sumMeals([m1, apple, own]).kcal, m1.n.kcal! + apple.n.kcal! + own.n.kcal!, 0.2));
const ofDay = mealsOf(day, "2026-11-09", "m1");
ok("день: только своего числа", ofDay.length === 3 && ofDay.every((x) => x.date === "2026-11-09"));
ok("день: порядок по приёмам пищи (завтрак, обед, перекус)", ofDay.map((x) => x.slot).join() === "завтрак,обед,перекус", ofDay.map((x) => x.slot));
ok("день: чужие записи не видны", mealsOf([{ ...m1, who: "m2" }], "2026-11-09", "m1").length === 0 && mealsOf([{ ...m1, who: undefined }], "2026-11-09", "m1").length === 1);

// Итог дня против нормы
const P = (o: Partial<BodyProfile> = {}): BodyProfile => ({ ...newProfile("f"), born: 1991, ...o });
const plan = planFor(P())!;
const empty = dayView([], plan, 24);
ok("пустой день: остаток = норма, уровень «мало»", empty.left === plan.kcal && empty.level === "low");
const full = dayView([{ ...own, n: { kcal: plan.kcal, protein: plan.protein, fiber: plan.fiber } }], plan, 24);
ok("съедена норма: остаток 0, «в норме»", full.left === 0 && full.level === "ok" && full.hints.length === 0, full.hints);
const over = dayView([{ ...own, n: { kcal: plan.kcal * 1.3, protein: plan.protein, fiber: plan.fiber } }], plan, 24);
ok("перебор: уровень «много» и подсказка", over.level === "over" && over.left < 0 && over.hints.some((h) => /больше нормы/.test(h)), over);
ok("уровни калорий: 80% мало, 100% норма, 115% много", kcalLevel(80, 100) === "low" && kcalLevel(100, 100) === "ok" && kcalLevel(115, 100) === "over" && kcalLevel(1, 0) === "ok");
const lowProt = dayView([{ ...own, n: { kcal: 800, protein: 10, fiber: 3 } }], plan, 19);
ok("вечером мало белка и клетчатки — подсказки", lowProt.hints.some((h) => /Белка/.test(h)) && lowProt.hints.some((h) => /Клетчатки/.test(h)), lowProt.hints);
const morning = dayView([{ ...own, n: { kcal: 300, protein: 5, fiber: 1 } }], plan, 9);
ok("утром не упрекаем в нехватке белка и клетчатки", morning.hints.length === 0, morning.hints);
const salty = dayView([{ ...own, n: { kcal: plan.kcal, protein: plan.protein, fiber: plan.fiber, na: 2600, chol: 400, satFat: plan.satFatMax + 5 } }], plan, 24);
ok("пределы: натрий, холестерин и насыщенные жиры выше нормы", salty.hints.filter((h) => /Натрия|Холестерина|Насыщенных/.test(h)).length === 3, salty.hints);
ok("без плана: итог есть, остатка и подсказок нет", (() => { const v = dayView([own], null); return v.eaten.kcal === 650 && v.left === 0 && v.hints.length === 0; })());

// Недавнее
const older = { ...m1, id: "a", t: 1 }, newer = { ...copyMeal(m1, "2026-11-09"), id: "b", t: 5 }, other = { ...own, id: "c", t: 3 };
const rec = recentMeals([older, other, newer], "m1");
ok("недавнее: повторы схлопнуты, свежие первыми", rec.length === 2 && rec[0].id === "b" && rec[1].id === "c", rec.map((x) => x.id));
ok("недавнее: лимит", recentMeals(Array.from({ length: 20 }, (_, i) => ({ ...own, id: "x" + i, name: "Блюдо " + i, t: i })), undefined, 5).length === 5);

// Поиск по справочнику
ok("поиск: «ябл» находит яблоки", searchFoods("ябл").some((n) => /Яблок/i.test(n)));
ok("поиск: сначала начинающиеся с запроса", /^ябл/i.test(searchFoods("ябл")[0]));
ok("поиск: пустой запрос — список, а не пусто", searchFoods("").length > 5);
ok("поиск: мусор — пусто", searchFoods("щщщщщ").length === 0);

console.log(`diary: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
