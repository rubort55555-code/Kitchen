// Проверка оценки жирорастворимых витаминов: node node_modules/.bin/tsx tests/fatsoluble.test.ts
import { FAT_CAROTENE_G, FAT_MIN_G, RICH, analyzeFatSoluble, carotenoidOf, fatSolubleDay, fatSolubleHints } from "../src/lib/fatsoluble";
import { SOURCES } from "../src/lib/interactions";
import { mealCustom } from "../src/lib/diary";
import type { Meal, Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const D = "2026-11-09";
const ctx = { recipes: [] as Recipe[] };
const meal = (name: string, qty: string, n: Meal["n"], slot: Meal["slot"] = "обед"): Meal => ({ ...mealCustom(name, { kcal: 200 }, D, slot, "m1")!, qty, n: { kcal: 200, ...n } });
const ids = (h: { id: string }[]) => h.map((x) => x.id.split(":")[0]);

// Каротиноидные продукты
ok("лycopen: томаты, кетчуп, арбуз", ["Помидоры", "Томаты черри", "Кетчуп", "Арбуз"].every((n) => carotenoidOf(n) === "lycopene"));
ok("β-каротин: морковь, тыква, батат, абрикосы, красный перец", ["Морковь", "Тыква", "Батат", "Абрикосы", "Перец красный", "Курага"].every((n) => carotenoidOf(n) === "beta"));
ok("лютеин: шпинат, брокколи, кале, зелёный горошек", ["Шпинат", "Брокколи", "Капуста кале", "Зелёный горошек"].every((n) => carotenoidOf(n) === "lutein"));
ok("не каротиноидные и слова внутри слов", carotenoidOf("Картофель") === null && carotenoidOf("Хлеб") === null && carotenoidOf("Говядина") === null && carotenoidOf("Пастернак") === null);

// Анализ приёма пищи
ok("витаминов и каротиноидов мало — не оцениваем", analyzeFatSoluble("обед", [meal("Рис", "200 г", { vitA: 10, vitE: 0.5, fat: 0.5 })], ctx) === null);
const lowFat = analyzeFatSoluble("обед", [meal("Салат из моркови", "150 г", { vitA: 800, fat: 1 })], ctx)!;
ok("витамин A 800 мкг и жира 1 г: жира мало", lowFat.level === "low" && lowFat.vitamins.includes("A") && lowFat.carotenoids.includes("beta"), lowFat);
const mid = analyzeFatSoluble("обед", [meal("Морковь с ложкой масла", "150 г", { vitA: 800, fat: 5 })], ctx)!;
ok("жира 5 г: достаточно для E, мало для β-каротина", mid.level === "enough", mid);
const full = analyzeFatSoluble("обед", [meal("Морковь с маслом", "150 г", { vitA: 800, fat: 12 })], ctx)!;
ok("жира 12 г: хорошо", full.level === "good");
ok("пороги жира — 3 и 8 г", FAT_MIN_G === 3 && FAT_CAROTENE_G === 8);
ok("витамины E, K, D определяются по порогам", (() => { const r = analyzeFatSoluble("обед", [meal("Орехи", "20 г", { vitE: RICH.vitE + 1, vitK: RICH.vitK + 1, vitD: RICH.vitD + 1, fat: 12 })], ctx)!; return ["E", "K", "D"].every((x) => r.vitamins.includes(x as never)); })());
ok("каротиноидный продукт меньше 30 г не отмечается", analyzeFatSoluble("обед", [meal("Морковь", "20 г", { vitA: 10, fat: 0 })], ctx) === null);
ok("степень: с каротиноидами по названию — C, по данным о витаминах — B", lowFat.grade === "C" && analyzeFatSoluble("обед", [meal("Печень", "100 г", { vitA: 6000, fat: 1 })], ctx)!.grade === "B");

// Подсказки
const h1 = fatSolubleHints([meal("Салат из моркови", "150 г", { vitA: 800, fat: 1 })], ctx);
ok("мало жира — подсказка про жир с границами 3 и 8 г", ids(h1).includes("fat-sol") && /3 г/.test(h1[0].text) && /8 г/.test(h1[0].text) && h1[0].text.includes("обед"), h1);
ok("мало жира у моркови — также подсказка про нагревание и протирание", ids(h1).includes("caro-heat") && h1.find((x) => x.id.startsWith("caro-heat"))!.text.includes("1,5%"), ids(h1));
const h2 = fatSolubleHints([meal("Морковь с ложкой масла", "150 г", { vitA: 800, fat: 5 })], ctx);
ok("жира 5 г и β-каротин — подсказка довести жир до 8 г", ids(h2).includes("fat-caro"), ids(h2));
ok("жира достаточно (12 г) — подсказок нет", fatSolubleHints([meal("Морковь с маслом", "150 г", { vitA: 800, fat: 12 })], ctx).length === 0);
ok("только витамин K без каротиноидов и мало жира — подсказка про жир, без подсказки про нагревание", (() => { const h = fatSolubleHints([meal("Йогурт с добавкой", "100 г", { vitK: 100, fat: 0.5 })], ctx); return ids(h).includes("fat-sol") && !ids(h).includes("caro-heat"); })());
ok("томаты (ликопин) без жира: подсказка про нагрев и масло", ids(fatSolubleHints([meal("Салат из помидоров", "200 г", { fat: 0.5 })], ctx)).includes("caro-heat"));
ok("все подсказки со ссылками на источники из списка", [...h1, ...h2].every((x) => x.src.length > 0 && x.src.every((s) => SOURCES[s])));
ok("fatSolubleDay по приёмам", fatSolubleDay([meal("Морковь", "150 г", { vitA: 800, fat: 1 }, "завтрак"), meal("Печень", "100 г", { vitA: 6000, fat: 8 }, "ужин")], ctx).map((x) => x.slot).join() === "завтрак,ужин");

console.log(`fatsoluble: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
