// Проверка оценки кальция и цинка: node node_modules/.bin/tsx tests/minerals.test.ts
import { CALCIUM_CAP_MG, OXALATE_G, PHYTATE_G, analyzeCalcium, analyzeZinc, calciumDay, mineralHints, oxalateOf } from "../src/lib/minerals";
import { SOURCES } from "../src/lib/interactions";
import { mealCustom } from "../src/lib/diary";
import type { Meal, Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const D = "2026-11-09";
const ctx = { recipes: [] as Recipe[] };
const meal = (name: string, qty: string, n: Meal["n"], slot: Meal["slot"] = "обед"): Meal => ({ ...mealCustom(name, { kcal: 300 }, D, slot, "m1")!, qty, n: { kcal: 300, ...n } });
const ids = (h: { id: string }[]) => h.map((x) => x.id.split(":")[0]);

// Оксалаты
ok("шпинат и ревень — степень B, щавель и мангольд — C, прочее — D", oxalateOf("Шпинат") === "B" && oxalateOf("Ревень") === "B" && oxalateOf("Щавель") === "C" && oxalateOf("Мангольд") === "C" && oxalateOf("Капуста") === "D" && oxalateOf("Яблоки") === "D");
ok("слово не должно находиться внутри другого слова", oxalateOf("Пастернак") === "D" && oxalateOf("Ревенье") !== "x");

// Кальций
ok("мало кальция — не оцениваем", analyzeCalcium("обед", [meal("Хлеб", "50 г", { ca: 20 })], ctx) === null);
const milk = analyzeCalcium("завтрак", [meal("Молоко", "250 мл", { ca: 300 }, "завтрак")], ctx)!;
ok("молоко: кальций усваивается хорошо", milk.quality === "good" && milk.dairy && !milk.oxalate && !milk.phytate, milk);
const spin = analyzeCalcium("обед", [meal("Шпинат", `${OXALATE_G + 50} г`, { ca: 150 })], ctx)!;
ok("шпинат ≥ 50 г: кальций усваивается плохо", spin.quality === "poor" && spin.oxalate, spin);
const spinMilk = analyzeCalcium("обед", [meal("Шпинат", "150 г", { ca: 150 }), meal("Йогурт", "150 г", { ca: 200 })], ctx)!;
ok("шпинат с молочным — «хуже», не «плохо» (есть хороший источник)", spinMilk.quality === "mixed", spinMilk);
const beans = analyzeCalcium("обед", [meal("Фасоль", `${PHYTATE_G + 50} г`, { ca: 120 })], ctx)!;
ok("фасоль: фитаты — кальций усваивается плохо", beans.quality === "poor" && beans.phytate, beans);
const small = analyzeCalcium("обед", [meal("Шпинат", "20 г", { ca: 110 })], ctx)!;
ok("20 г шпината — оксалаты не отмечаем", !small.oxalate && small.quality === "good", small);
const big = analyzeCalcium("завтрак", [meal("Творог и йогурт", "400 г", { ca: CALCIUM_CAP_MG + 100 }, "завтрак")], ctx)!;
ok("кальций ≥ 500 мг сразу — отметка «слишком много за раз»", big.tooMuch);
ok("calciumDay: по приёмам", calciumDay([meal("Молоко", "250 мл", { ca: 300 }, "завтрак"), meal("Сыр", "50 г", { ca: 250 }, "ужин")], ctx).map((x) => x.slot).join() === "завтрак,ужин");

// Цинк
ok("мало цинка — не оцениваем", analyzeZinc("обед", [meal("Хлеб", "50 г", { zn: 0.5 })], ctx) === null);
const znBeef = analyzeZinc("обед", [meal("Говядина", "150 г", { zn: 6 })], ctx)!;
ok("говядина: цинк, помех нет", znBeef.level === "usual" && znBeef.inhibitors.length === 0, znBeef);
const znBeans = analyzeZinc("обед", [meal("Чечевица", "100 г", { zn: 3 })], ctx)!;
ok("чечевица: фитаты — «хуже», степень C", znBeans.level === "worse" && znBeans.inhibitors[0].startsWith("фитаты") && znBeans.grade === "C", znBeans);
const znCa = analyzeZinc("обед", [meal("Чечевица", "100 г", { zn: 3, ca: 400 })], ctx)!;
ok("фитаты и кальций ≥ 300 мг: добавляется «кальций вместе с фитатами»", znCa.inhibitors.some((x) => x.startsWith("кальций")), znCa);
const znCaOnly = analyzeZinc("обед", [meal("Говядина с сыром", "200 г", { zn: 5, ca: 500 })], ctx)!;
ok("кальций без фитатов цинку не мешает (по данным обзора)", znCaOnly.level === "usual" && znCaOnly.inhibitors.length === 0, znCaOnly);

// Подсказки
const h1 = mineralHints([meal("Шпинат", "150 г", { ca: 150 })], ctx);
ok("подсказка про шпинат называет приём и цифры источника", ids(h1).includes("ca-oxalate") && /5–9%/.test(h1[0].text) && h1[0].text.includes("обед"), h1);
const h2 = mineralHints([meal("Творог", "400 г", { ca: 650 }, "завтрак")], ctx);
ok("подсказка про распределение кальция", ids(h2).includes("ca-split") && /200 мг/.test(h2[0].text));
const h3 = mineralHints([meal("Чечевица с сыром", "200 г", { zn: 3, ca: 400, fe: 1 })], ctx);
ok("подсказка: фитаты и кальций вместе мешают цинку", ids(h3).includes("zn-ca-phytate"), ids(h3));
const h4 = mineralHints([meal("Чечевица", "100 г", { zn: 3, fe: 0.5 })], ctx);
ok("подсказка про фитаты и цинк, когда железа мало (иначе её даёт блок про железо)", ids(h4).includes("zn-phytate"), ids(h4));
ok("при железе ≥ 1,5 мг подсказку про фитаты даёт блок про железо — здесь без дубля", !ids(mineralHints([meal("Чечевица", "100 г", { zn: 3, fe: 3 })], ctx)).includes("zn-phytate"));
ok("обычный приём — подсказок нет", mineralHints([meal("Рис с курицей", "300 г", { zn: 2, ca: 40, fe: 1 })], ctx).length === 0);
ok("все подсказки со ссылками на источники из списка", [...h1, ...h2, ...h3, ...h4].every((h) => h.src.length > 0 && h.src.every((s) => SOURCES[s])));

console.log(`minerals: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
