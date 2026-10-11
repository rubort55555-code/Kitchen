import { compileRules, checkRecipe, findHits, toTbsp, applyReplace, DEFAULT_RULES } from "../src/lib/exclusions";
import { findCatalog } from "../src/lib/catalog";
import { addQty, qtyText } from "../src/lib/units";
import { parseAnswer, buildPrompt } from "../src/lib/claude";
import { rub, num, scaleAmount } from "../src/lib/util";
import { findTimes, fmtTime } from "../src/lib/timers";
import { report, insights, priceTrends, amountText } from "../src/lib/stats";
import { parseReceipt } from "../src/lib/receipt";
import { parseRecipeText } from "../src/lib/recipeText";
import { productsCsv, pricesCsv } from "../src/lib/csv";
import { sumAmounts } from "../src/lib/shop";
import { substitutes } from "../src/lib/subs";
import { recipeStatus } from "../src/lib/match";
import type { Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const members = [{ id: "m1", name: "Аня", allergies: [], dislikes: ["грибы"] }, { id: "m2", name: "Петя", allergies: ["арахис"], dislikes: [] }];
const C = compileRules(DEFAULT_RULES, [], members);
const both = ["m1", "m2"];
const R = (name: string, ings: [string, string][], steps: string[] = []): Recipe => ({ id: "x", name, ingredients: ings.map(([n, a]) => ({ name: n, amount: a })), steps, source: "manual", createdAt: 0 });
const v = (r: Recipe, who = both) => checkRecipe(r, C, who).verdict;

ok("холодец скрыт", v(R("Холодец из курицы", [["Курица", "1 кг"]])) === "hidden");
ok("студень скрыт", v(R("Студень", [["Свиные ножки", "1 кг"]])) === "hidden");
ok("заливное из мяса скрыто", v(R("Заливное из мяса", [["Говядина", "500 г"]])) === "hidden");
ok("холодная вода не холодец", v(R("Омлет", [["Яйца", "3 шт"]], ["Залейте холодной водой", "Поставьте в холодильник"])) === "ok");
ok("треска → warn с заменой", (() => { const c = checkRecipe(R("Рыба в духовке", [["Филе трески", "500 г"]]), C, both); return c.verdict === "warn" && c.issues[0].replace === "минтай"; })());
ok("треска в названии", v(R("Треска в кляре", [["Мука", "100 г"]])) === "warn");
ok("морского окуня", v(R("Уха", [["Морского окуня", "1 шт"]])) === "warn");
ok("пикша/хек/палтус/дорадо/сибас", ["Пикша", "Хек", "Палтус", "Дорадо", "Сибас", "Сайда", "Путассу", "Навага"].every((f) => v(R("Блюдо", [[f, "300 г"]])) === "warn"));
ok("минтай можно", v(R("Минтай с овощами", [["Минтай", "500 г"]])) === "ok");
ok("камбала можно", v(R("Жареная камбала", [["Камбала", "2 шт"]])) === "ok");
ok("лосось можно", v(R("Лосось на пару", [["Лосось", "300 г"]])) === "ok");
ok("речной окунь можно", v(R("Окунь жареный", [["Окунь речной", "2 шт"]])) === "ok");
ok("семечки 1 ст.л. ок", v(R("Салат", [["Семечки подсолнечные", "1 ст. л."]])) === "ok");
ok("семечки 2 ст.л. ок", v(R("Салат", [["Семечки", "2 ст. л."]])) === "ok");
ok("семечки 100 г скрыт", v(R("Салат", [["Семечки", "100 г"]])) === "hidden");
ok("семечки стакан скрыт", v(R("Козинак", [["Семечки", "1 стакан"]])) === "hidden");
ok("салат с семечками 1 ст.л. ок", v(R("Салат с семечками", [["Семечки", "1 ст. л."]])) === "ok");
ok("семечки в названии скрыт", v(R("Козинаки из семечек", [["Мёд", "100 г"]])) === "hidden");
ok("подсолнечное масло ок", v(R("Салат", [["Масло подсолнечное", "2 ст. л."]])) === "ok");
ok("тыквенные семечки ок", v(R("Салат", [["Тыквенные семечки", "50 г"]])) === "ok");
ok("грибы: только когда ест Аня", v(R("Суп", [["Грибы", "200 г"]]), ["m2"]) === "ok" && v(R("Суп", [["Грибы", "200 г"]]), ["m1"]) === "hidden");
ok("арахис: Петя", v(R("Соус", [["Арахис", "50 г"]]), ["m2"]) === "hidden");
ok("toTbsp", toTbsp("2 ст. л.") === 2 && toTbsp("30 г") === 3 && toTbsp("по вкусу") === 1 && toTbsp("1 ч. л.")! < 1);
ok("applyReplace", (() => { const r = applyReplace(R("Треска в кляре", [["Треска", "500 г"]], ["Обжарьте треску"]), "треска", "минтай"); return r.name === "Минтай в кляре" && r.ingredients[0].name === "Минтай" && r.steps[0] === "Обжарьте минтай" && checkRecipe(r, C, both).verdict === "ok"; })(), applyReplace(R("Треска в кляре", [["Треска", "500 г"]], ["Обжарьте треску"]), "треска", "минтай"));
ok("findHits product", findHits("Филе хека", C, both).length === 1 && findHits("Минтай", C, both).length === 0);
// справочник
ok("каталог молоко", findCatalog("МОЛОКО")?.n === "Молоко");
ok("каталог грудка", findCatalog("куриная грудка")?.n === "Куриное филе");
ok("каталог помидоры черри", findCatalog("помидоры черри")?.n === "Помидоры");
ok("каталог подсолнечное масло", findCatalog("подсолнечное масло")?.n === "Масло подсолнечное");
ok("каталог филе трески", findCatalog("филе трески")?.n === "Треска", findCatalog("филе трески")?.n);
// единицы и формат
ok("500 г + 1 кг", (() => { const r = addQty(500, "г", 1, "кг")!; return qtyText(r.qty, r.unit) === "1,5 кг"; })());
ok("rub", rub(1250) === "1 250 ₽" && rub(45.5) === "45,5 ₽", rub(1250));
ok("num", num(0.5) === "0,5");
// ответ Claude
const ans = 'Вот идеи!\n1. Омлет...\n```json\n{"dishes":[{"name":"Омлет","minutes":15,"servings":2,"ingredients":[{"name":"Яйца","amount":"4 шт"}],"steps":["1. Взбить","Жарить"]},{"name":"Салат","ingredients":["Огурцы — 2 шт"],"steps":[]}]}\n```';
const p = parseAnswer(ans);
ok("parse 2 блюда", p.recipes.length === 2 && p.recipes[0].steps[0] === "Взбить" && p.recipes[1].ingredients[0].amount === "2 шт", p);
ok("parse без json", parseAnswer("просто текст").recipes.length === 0);
ok("parse без ограды", parseAnswer('Ответ: {"dishes":[{"name":"Каша","ingredients":[],"steps":["Варить"],}]}').recipes.length === 1);
const pr = buildPrompt({ who: both, minutes: 30, kind: "ужин", count: 3, wish: "", useFirst: [] }, [], members, DEFAULT_RULES, ["соль"], []);
ok("prompt содержит ограничения", /холодец/.test(pr) && /треска/.test(pr) && /камбала и минтай/.test(pr) && /арахис/.test(pr) && /```json/.test(pr), pr);
// «Приготовили»: расчёт списания и стоимости
import { parseNeed, planCook, conv } from "../src/lib/cook";
import { defaultSettings } from "../src/lib/store";
import type { Product } from "../src/lib/types";
const P = (id: string, name: string, qty: number, unit: Product["unit"], price: number, until: string | null = null, initialQty = qty): Product =>
  ({ id, name, qty, initialQty, unit, place: "Холодильник", bought: "2026-10-01", until, price, createdAt: 0 });
const S = defaultSettings();
ok("parseNeed г/мл/шт", JSON.stringify(parseNeed("200 г")) === '{"qty":200,"unit":"г"}' && JSON.stringify(parseNeed("1,5 кг")) === '{"qty":1.5,"unit":"кг"}' && JSON.stringify(parseNeed("3")) === '{"qty":3,"unit":"шт"}');
ok("parseNeed ложки и зубчики", JSON.stringify(parseNeed("2 ст. л.")) === '{"qty":30,"unit":"мл"}' && JSON.stringify(parseNeed("1 ч. л.")) === '{"qty":5,"unit":"мл"}' && JSON.stringify(parseNeed("3 зубчика")) === '{"qty":0.3,"unit":"шт"}');
ok("parseNeed щепотка/по вкусу", parseNeed("щепотка") === "free" && parseNeed("по вкусу") === "free" && parseNeed("") === null);
ok("parseNeed ложка не литр", JSON.stringify(parseNeed("1 ложка")) === '{"qty":15,"unit":"мл"}' && JSON.stringify(parseNeed("2 л")) === '{"qty":2,"unit":"л"}' && JSON.stringify(parseNeed("1 уп")) === '{"qty":1,"unit":"уп"}');
ok("conv штуки в кг", conv(2, "шт", "кг", "Помидоры") === 0.24 && conv(500, "г", "кг", "Мука") === 0.5 && conv(1, "шт", "г", "Хлеб") === null);
const omelet: Recipe = { id: "o", name: "Омлет", servings: 2, ingredients: [{ name: "Яйца", amount: "4 шт" }, { name: "Молоко", amount: "100 мл" }, { name: "Соль", amount: "щепотка" }, { name: "Масло сливочное", amount: "10 г" }, { name: "Сыр твёрдый", amount: "60 г" }], steps: ["a", "b"], source: "base", createdAt: 0 };
const stock = [P("e", "Яйца", 10, "шт", 100), P("m", "Молоко", 1, "л", 80), P("b", "Масло сливочное", 180, "г", 180)];
const pl = planCook(omelet, 2, stock, S);
ok("списание яиц и молока", pl.rows[0].takes[0].take === 4 && pl.rows[1].takes[0].take === 0.1 && pl.rows[1].takes[0].unit === "л", pl.rows[1]);
ok("соль не списываем", pl.skipped.includes("Соль") && pl.rows.length === 4);
ok("стоимость со склада", Math.abs(pl.rows[0].rub - 40) < 1e-9 && Math.abs(pl.rows[1].rub - 8) < 1e-9 && Math.abs(pl.rows[2].rub - 10) < 1e-9, pl.rows.map((x) => x.rub));
ok("нет сыра дома: списывать нечего, оценка", pl.rows[3].noStock && pl.rows[3].takes.length === 0 && pl.estimated);
const pl4 = planCook(omelet, 4, stock, S);
ok("порции ×2", pl4.rows[0].takes[0].take === 8 && Math.abs(pl4.rows[1].takes[0].take - 0.2) < 1e-9);
const two = [P("m1", "Молоко", 0.2, "л", 20, "2026-10-12", 1), P("m2", "Молоко", 1, "л", 80, "2026-10-20", 1)];
const pm = planCook({ ...omelet, ingredients: [{ name: "Молоко", amount: "500 мл" }, { name: "Яйца", amount: "1 шт" }] }, 2, two, S);
ok("молоко из двух пачек, сначала та, что раньше испортится", pm.rows[0].takes.length === 2 && pm.rows[0].takes[0].productId === "m1" && pm.rows[0].takes[0].take === 0.2 && Math.abs(pm.rows[0].takes[1].take - 0.3) < 1e-9, pm.rows[0].takes);
const ps = planCook({ ...omelet, ingredients: [{ name: "Молоко", amount: "500 мл" }, { name: "Яйца", amount: "1 шт" }] }, 2, [P("m1", "Молоко", 0.2, "л", 20, null, 1)], S);
ok("не хватило молока", ps.rows[0].unit === "л" && Math.abs(ps.rows[0].short - 0.3) < 1e-9 && ps.rows[0].takes[0].take === 0.2, ps.rows[0]);
const pt = planCook({ ...omelet, ingredients: [{ name: "Помидоры", amount: "2 шт" }, { name: "Яйца", amount: "1 шт" }] }, 2, [P("t", "Помидоры", 1, "кг", 150)], S);
ok("помидоры штуки → кг", Math.abs(pt.rows[0].takes[0].take - 0.24) < 1e-9 && pt.rows[0].unit === "кг", pt.rows[0]);
const pe = planCook(omelet, 2, stock, S, { "0": { on: false }, "1": { qty: 0.25 } });
ok("правки: снять галочку и поменять количество", !pe.rows[0].on && pe.rows[1].takes[0].take === 0.25 && pe.cost < pl.cost);
const pu = planCook({ ...omelet, ingredients: [{ name: "Хрен", amount: "1 кусок" }, { name: "Яйца", amount: "1 шт" }] }, 2, stock, S);
ok("непонятное количество — вписать самому", pu.rows[0].manual && !pu.rows[0].on);

ok("пересчёт: 200 г ×1,5", scaleAmount("200 г", 1.5) === "300 г");
ok("пересчёт: 1 шт ×2, 0,5 уп ×3", scaleAmount("1 шт", 2) === "2 шт" && scaleAmount("0,5 уп", 3) === "1,5 уп");
ok("пересчёт: диапазон и «по вкусу»", scaleAmount("1-2 шт", 2) === "2–4 шт" && scaleAmount("по вкусу", 2) === "по вкусу");
ok("время в шаге: 15 минут", findTimes("Варите 15 минут.")[0]?.seconds === 900);
ok("время в шаге: 20–25 минут берём большее, час, секунды", findTimes("Тушите 20–25 минут")[0].seconds === 1500 && findTimes("1 час")[0].seconds === 3600 && findTimes("30 секунд")[0].seconds === 30);
ok("время в шаге: нет времени", findTimes("Посолите по вкусу").length === 0);
ok("таймер: формат", fmtTime(65000) === "1:05" && fmtTime(3600000) === "1:00:00");

{
  const now = Date.now(), d = 86400000;
  const L = (name: string, reason: any, qty: number, unit: any, r: number, t = now - d) => ({ id: name + reason + t + r, t, name, reason, qty, unit, rub: r } as any);
  const log = [
    L("Молоко", "bought", 1, "л", 80, now - 40 * d), L("Молоко", "spoiled", 0.5, "л", 40, now - 30 * d),
    L("Молоко", "bought", 1, "л", 85, now - 25 * d), L("Молоко", "spoiled", 1, "л", 85, now - 15 * d),
    L("Молоко", "bought", 1, "л", 100, now - 5 * d), L("Молоко", "eaten", 1, "л", 100, now - 2 * d),
    L("Гречка", "bought", 900, "г", 120), L("Гречка", "eaten", 300, "г", 40),
  ];
  const rep = report(log, [], now - 60 * d);
  ok("отчёт: куплено/съедено/пропало в рублях", rep.bought.rub === 385 && rep.eaten.rub === 140 && rep.lost.rub === 125, rep);
  ok("отчёт: процент потерь", rep.lostPct === 47, rep.lostPct);
  ok("отчёт: количества отдельно по л, кг", amountText(rep.bought.amount) === "0,9 кг + 3 л" && amountText(rep.lost.amount) === "1,5 л", amountText(rep.bought.amount));
  ok("отчёт: топ потерь — молоко", rep.topLost[0].name === "Молоко" && rep.topLost[0].n === 2);
  const week = report(log, [], now - 6 * d);
  ok("отчёт за неделю не включает старое", week.lost.rub === 0 && week.bought.rub === 220, week);
  const pr = priceTrends(log);
  ok("цена: подорожание молока", pr[0].name === "Молоко" && pr[0].changePct > 10, pr[0]);
  const tips = insights(log, rep, 60);
  ok("находки: молоко пропадает и годовая сумма", tips.some((x) => x.includes("Молоко пропадает в 2 из 3")) && tips.some((x) => x.includes("в год")), tips);
}

{
  ok("замены: сметана → йогурт, сливки", substitutes("Сметана 20%")[0] === "Йогурт");
  ok("замены: грудка → индейка", substitutes("куриная грудка")[0] === "Индейка");
  ok("замены: у соли нет замен", substitutes("Соль").length === 0);
  const rec = { ...omelet, ingredients: [{ name: "Сметана", amount: "100 г" }, { name: "Яйца", amount: "2 шт" }] };
  const withY = [P("y", "Йогурт", 2, "шт", 60), P("e", "Яйца", 10, "шт", 100)];
  const st1 = recipeStatus(rec, withY, S.basics, []);
  ok("подбор: йогурт заменяет сметану", st1.percent === 100 && st1.list[0].via?.name === "Йогурт" && st1.missing.length === 0, st1);
  const st2 = recipeStatus(rec, [P("e", "Яйца", 10, "шт", 100)], S.basics, []);
  ok("подбор: нет сметаны и замены — подсказка, чем заменить", st2.percent === 50 && st2.list[0].alts?.[0] === "Йогурт", st2.list[0]);
  const pc = planCook(rec, 2, withY, S);
  ok("«Приготовили»: списывает йогурт вместо сметаны", pc.rows[0].takes[0]?.name === "Йогурт", pc.rows[0]);
}

{
  const it = parseReceipt(`ПЯТЁРОЧКА
МОЛ ПРОСТ 3,2% 930 МЛ    1 x 89,90
БАНАНЫ КГ    1,235 x 119,00   146,97
КУР ФИЛЕ ОХЛ ©, 850КГ    1х 389, 99
ЯЙЦО С1 10ШТ    2 x 99,90
СМЕТАНА 20% 300Г
1 x 79,00 = 79,00
2 Сахар песок 1 кг 1 × 79,99 79,99
ИТОГО 1040,17`);
  const by = (n: string) => it.find((x) => x.name === n);
  ok("чек: найдено 6 товаров, итог не товар", it.length === 6, it.map((x) => x.name));
  ok("чек: молоко 930 мл → 0,93 л за 89,90", by("Молоко")?.qty === 0.93 && by("Молоко")?.unit === "л" && by("Молоко")?.price === 89.9, by("Молоко"));
  ok("чек: бананы на вес", by("Бананы")?.qty === 1.235 && by("Бананы")?.unit === "кг" && by("Бананы")?.price === 146.97, by("Бананы"));
  ok("чек: курица 0,850 кг → 850 г (шум ©, пробел в цене)", by("Куриное филе")?.qty === 850 && by("Куриное филе")?.unit === "г" && by("Куриное филе")?.price === 389.99, by("Куриное филе"));
  ok("чек: 2 упаковки по 10 яиц = 20 шт, цена за обе", by("Яйца")?.qty === 20 && by("Яйца")?.price === 199.8, by("Яйца"));
  ok("чек: название и цена в разных строках", by("Сметана")?.qty === 300 && by("Сметана")?.price === 79, by("Сметана"));
  ok("чек: запомненное сокращение главнее", parseReceipt("ЭТО НЕПОНЯТНО 1 x 10,00", { "это непонятно": "Творог" })[0]?.name === "Творог");
  ok("чек: неизвестный продукт остаётся с очищенным названием", parseReceipt("ВОДОРОСЛИ НОРИ 5ШТ 1 x 100,00")[0]?.known === false);
}

{
  const d = parseRecipeText(`Сырники
Время приготовления: 30 минут
Порций: 4

Ингредиенты:
- Творог 500 г
- 2 яйца
- Мука 3 ст. л.
- Сахар по вкусу

Приготовление:
1. Смешайте творог с яйцами.
2. Добавьте муку и сахар, сформируйте сырники.
3. Обжарьте на масле по 3 минуты с каждой стороны.`);
  const n = (x: string) => d.ingredients.find((i) => i.name.toLowerCase().includes(x));
  ok("рецепт-текст: название", d.name === "Сырники", d.name);
  ok("рецепт-текст: время и порции", d.minutes === 30 && d.servings === 4, [d.minutes, d.servings]);
  ok("рецепт-текст: 4 ингредиента", d.ingredients.length === 4, d.ingredients);
  ok("рецепт-текст: творог 500 г", !!n("творог") && /500/.test(n("творог")!.amount), n("творог"));
  ok("рецепт-текст: число впереди (2 яйца)", !!n("яйц") && /2/.test(n("яйц")!.amount), n("яйц"));
  ok("рецепт-текст: 3 шага без нумерации", d.steps.length === 3 && d.steps[0].startsWith("Смешайте"), d.steps);
}

{
  const c = productsCsv([{ id: "1", name: 'Молоко "Дом"; 3,2%', qty: 0.5, initialQty: 1, unit: "л", place: "Холодильник", bought: "2026-10-01", until: null, price: 89.9, createdAt: 0 }]);
  ok("csv: BOM, кавычки и запятая в числах", c.startsWith("\ufeff") && c.includes('"Молоко ""Дом""; 3,2%";0,5;л') && c.includes("89,9"), c);
  const p = pricesCsv([{ id: "a", t: Date.UTC(2026, 9, 1), name: "Мука", reason: "bought", qty: 500, unit: "г", rub: 45 }]);
  ok("csv: цена за кг считается", p.includes("90"), p);
}

{
  ok("сумма: мука 320 г + 4 ст. л. = 420 г", sumAmounts(["320 г", "4 ст. л."], "Мука").replace(/\s/g, " ") === "420 г", sumAmounts(["320 г", "4 ст. л."], "Мука"));
  ok("сумма: масло 3 ст. л. + 2 ст. л. = 80 мл", sumAmounts(["3 ст. л.", "2 ст. л."], "Масло оливковое").replace(/\s/g, " ") === "80 мл", sumAmounts(["3 ст. л.", "2 ст. л."], "Масло оливковое"));
  ok("сумма: укроп 0,5 + 1 пучок = 2 уп (покупаем целыми)", sumAmounts(["0,5 пучка", "1 пучок"], "Укроп").replace(/\s/g, " ") === "2 уп", sumAmounts(["0,5 пучка", "1 пучок"], "Укроп"));
  ok("сумма: по вкусу остаётся текстом", sumAmounts(["200 г", "по вкусу"], "Сахар").includes("по вкусу"), sumAmounts(["200 г", "по вкусу"], "Сахар"));
}

console.log(`\nЛогика: ${pass} из ${pass + fail}`);
if (fail) process.exit(1);
