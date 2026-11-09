// Проверка оценки железа: node node_modules/.bin/tsx tests/iron.test.ts
import { CATALOG } from "../src/lib/catalog";
import { CALCIUM_INHIBITOR_MG, IRON_MIN_MG, MEAT_ENHANCER_G, analyzeIron, foodIron, ironDay, ironHints, mealParts } from "../src/lib/iron";
import { DRINKS, SOURCES } from "../src/lib/interactions";
import { mealCustom, mealDrink, mealFromComposition, mealFromRecipe } from "../src/lib/diary";
import { parseRecipeText } from "../tools/recipes.mjs";
import { readFileSync, readdirSync } from "node:fs";
import type { Meal, Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const has = (name: string, flag: string) => foodIron(name).flags.includes(flag as never);

// Разметка продуктов
ok("говядина — мясо, степень B", has("Говядина", "meat") && foodIron("Говядина").grade === "B");
ok("куриная печень — субпродукт и мясо", has("Куриная печень", "organ") && has("Куриная печень", "meat"));
ok("«Салат с курицей» — мясо (курицей)", has("Салат с курицей", "meat"));
ok("лосось — рыба", has("Лосось", "fish"));
ok("яйца", has("Яйца", "egg") && has("Омлет", "egg"));
ok("молоко, творог, сыр — молочное", has("Молоко", "dairy") && has("Творог", "dairy") && has("Сыр твёрдый", "dairy"));
ok("сливочное масло — не молочный источник кальция", !has("Масло сливочное", "dairy"), foodIron("Масло сливочное"));
ok("чай, кофе, какао, шоколад — полифенолы", ["Чай чёрный", "Кофе", "Какао", "Шоколад тёмный"].every((n) => has(n, "polyphenol")));
ok("фасоль, чечевица, нут — бобовые", ["Фасоль", "Чечевица", "Нут"].every((n) => has(n, "legume")));
ok("тофу и соевый соус — соя", has("Тофу", "soy") && has("Соевый соус", "soy"));
ok("миндаль и кунжут — орехи и семена (степень C)", has("Миндаль", "nuts") && foodIron("Миндаль").grade === "C");
ok("гречка и овсянка — крупы", has("Гречка", "grain") && has("Овсяные хлопья", "grain"));
ok("вино — алкоголь", has("Вино красное сухое", "alcohol"));
ok("ложные срабатывания: слова не должны находиться внутри других слов", !has("Пастернак", "dairy") && !has("Помидоры", "meat") && !has("Картофель", "egg") && !has("Мука", "meat") && !has("Минеральная вода", "fish"), ["Пастернак", "Помидоры"].map((n) => foodIron(n)));
ok("огурцы и яблоки — учтены, без влияния (C)", foodIron("Огурцы").flags.length === 0 && foodIron("Огурцы").grade !== "D" && foodIron("Яблоки").grade !== "D");
ok("соль, сахар, масло подсолнечное — нейтральны (C)", ["Соль", "Сахар", "Масло подсолнечное"].every((n) => foodIron(n).flags.length === 0 && foodIron(n).grade === "C"));
ok("неизвестное остаётся D", foodIron("Зюзюка").grade === "D" && foodIron("Зюзюка").flags.length === 0);

// Покрытие справочника: каждому продукту присвоена степень, доля «нет данных» небольшая и не растёт
const cnt = { B: 0, C: 0, D: 0 };
for (const it of CATALOG) { const g = foodIron(it.n, it).grade; cnt[g as "B" | "C" | "D"]++; }
ok("все 2000+ продуктов справочника размечены", cnt.B + cnt.C + cnt.D === CATALOG.length, cnt);
ok("доля «данных нет» не больше 20%", cnt.D / CATALOG.length <= 0.20, cnt);
ok("мясо, птица, рыба, молочное, яйца — все со степенью B", CATALOG.filter((x) => ["Мясо", "Птица", "Рыба", "Яйца"].includes(x.c)).every((x) => foodIron(x.n, x).grade === "B"));

// Приёмы пищи
const D = "2026-11-09";
const meal = (name: string, qty: string, n: Meal["n"], slot: Meal["slot"] = "обед"): Meal => ({ ...mealCustom(name, { kcal: 300 }, D, slot, "m1")!, qty, n: { kcal: 300, ...n } });
const ctx = { recipes: [] as Recipe[] };
ok("мало железа — не оцениваем", analyzeIron("обед", [meal("Говядина", "200 г", { fe: IRON_MIN_MG - 0.5 })], ctx) === null);
const beef = analyzeIron("обед", [meal("Говядина", "200 г", { fe: 4, vitC: 5 })], ctx)!;
ok("200 г говядины — усиление «мясо», уровень «лучше»", beef.enhancers.includes("мясо или рыба") && beef.level === "better" && beef.inhibitors.length === 0, beef);
ok("мало мяса (30 г) не считается усилителем", !analyzeIron("обед", [meal("Говядина", `${MEAT_ENHANCER_G - 20} г`, { fe: 3, vitC: 5 })], ctx)!.enhancers.includes("мясо или рыба"));
const c60 = analyzeIron("обед", [meal("Перец", "150 г", { fe: 2, vitC: 60 })], ctx)!;
ok("витамин C ≥ 50 мг — усилитель", c60.enhancers.includes("витамин C") && c60.level === "better");
const tea = mealDrink(DRINKS.find((x) => x.key === "blackTea")!, 1, D, "обед", "m1")!;
const withTea = analyzeIron("обед", [meal("Говядина", "200 г", { fe: 4, vitC: 5 }), tea], ctx)!;
ok("чай в одном приёме с мясом: и усилитель, и помеха — «обычное», без взаимозачёта в пользу «лучше»", withTea.enhancers.length === 1 && withTea.inhibitors[0].startsWith("чай") && withTea.level === "usual", withTea);
const teaOnly = analyzeIron("обед", [meal("Чечевица", "100 г", { fe: 3, vitC: 3 }), tea], ctx)!;
ok("чай и чечевица без витамина C — «хуже»", teaOnly.level === "worse", teaOnly);
const teaOther = ironDay([meal("Чечевица", "100 г", { fe: 3, vitC: 3 }), mealDrink(DRINKS[3], 1, D, "перекус", "m1")!], ctx).find((x) => x.slot === "обед")!;
ok("чай в другом приёме не мешает", !teaOther.inhibitors.some((x) => x.startsWith("чай")), teaOther);
const ca = analyzeIron("завтрак", [meal("Творог с гречкой", "250 г", { fe: 3, ca: CALCIUM_INHIBITOR_MG + 50, vitC: 5 }, "завтрак")], ctx)!;
ok("кальций ≥ 300 мг — помеха, степень C", ca.inhibitors.some((x) => x.startsWith("кальций")) && ca.grade === "C", ca);
const ph = analyzeIron("обед", [meal("Фасоль", "100 г", { fe: 4, vitC: 2 })], ctx)!;
ok("100 г фасоли — фитаты мешают", ph.inhibitors.some((x) => x.startsWith("фитаты")) && ph.level === "worse");
const nothing = analyzeIron("обед", [meal("Гречка", "20 г", { fe: 2, vitC: 5 })], ctx)!;
ok("20 г крупы — фитаты не отмечаем", !nothing.inhibitors.some((x) => x.startsWith("фитаты")));
ok("безвитаминный приём без усилителей — «обычное»", analyzeIron("обед", [meal("Булгур", "20 г", { fe: 2, vitC: 5 })], ctx)!.level === "usual");

// Подсказки
const hints = ironHints([meal("Говядина", "200 г", { fe: 4, vitC: 5 }), tea], ctx);
ok("подсказка про чай рядом с мясом", hints.some((h) => h.id.startsWith("iron-tea")), hints.map((h) => h.id));
ok("подсказка называет приём пищи и железо", hints.every((h) => h.text.includes("обед") && /железа \d/.test(h.text)));
ok("подсказки со ссылками на источники из списка", hints.every((h) => h.src.length > 0 && h.src.every((s) => SOURCES[s])));
ok("подсказка про молочное при железе", ironHints([meal("Творог с гречкой", "250 г", { fe: 3, ca: 400, vitC: 5 }, "завтрак")], ctx).some((h) => h.id.startsWith("iron-ca")));
ok("подсказка про фитаты ссылается на открытые работы по фитатам", ironHints([meal("Фасоль", "100 г", { fe: 4, vitC: 2 })], ctx).some((h) => h.id.startsWith("iron-phytate") && h.src.includes("dahdouh2019")));
ok("без витамина C и мяса — подсказка про витамин C", ironHints([meal("Булгур", "20 г", { fe: 2, vitC: 5 })], ctx).some((h) => h.id.startsWith("iron-c")));
ok("мясо с витамином C — подсказок нет", ironHints([meal("Говядина с перцем", "200 г", { fe: 4, vitC: 60 })], ctx).length === 0);
ok("ironDay по слотам", ironDay([meal("Говядина", "200 г", { fe: 4 }), meal("Хлеб", "50 г", { fe: 3 }, "ужин")], ctx).map((x) => x.slot).join() === "обед,ужин");

// Рецепты: состав по ингредиентам
const all: Recipe[] = [];
for (const f of readdirSync("recipes").filter((x) => x.endsWith(".txt"))) all.push(...(parseRecipeText(readFileSync("recipes/" + f, "utf8"), f).recipes as Recipe[]));
const beefR = all.find((r) => r.ingredients.some((i) => /говядин/i.test(i.name)) && (r.servings || 2) <= 4)!;
const rm = mealFromRecipe(beefR, 1, D, "обед", "m1")!;
const parts = mealParts(rm, { recipes: all });
ok("рецепт: ингредиенты разобраны, граммы посчитаны", parts.length === beefR.ingredients.length && parts.some((p) => p.food.flags.includes("meat") && p.grams > 0), parts.slice(0, 4));
ok("рецепт: сохранено число съеденных порций", rm.servings === 1 && mealFromRecipe(beefR, 1.5, D, "обед", "m1")!.servings === 1.5);
const half = mealParts(mealFromRecipe(beefR, 0.5, D, "обед", "m1")!, { recipes: all });
ok("рецепт: половина порции — вдвое меньше граммов", Math.abs(half.reduce((a, p) => a + p.grams, 0) * 2 - parts.reduce((a, p) => a + p.grams, 0)) < 0.5);
ok("продукт из справочника: состав из названия и граммов", mealParts(mealFromComposition("Говядина", 150, D, "обед", "m1")!, ctx)[0].grams === 150);
let ironRecipes = 0, withMeat = 0;
for (const r of all) { const m = mealFromRecipe(r, 1, D, "обед", "m1"); if (!m) continue; const a = analyzeIron("обед", [m], { recipes: all }); if (a) { ironRecipes++; if (a.enhancers.includes("мясо или рыба")) withMeat++; } }
ok("по рецептам оценка железа работает (много рецептов с железом ≥ 1,5 мг на порцию)", ironRecipes > 80, ironRecipes);
ok("в части рецептов мясо или рыба определены как усилитель", withMeat > 20, withMeat);

console.log(`iron: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
