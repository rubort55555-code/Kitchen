// Проверка оценки железа: node node_modules/.bin/tsx tests/iron.test.ts
import { CATALOG } from "../src/lib/catalog";
import { CALCIUM_INHIBITOR_MG, IRON_MIN_MG, MEAT_ENHANCER_G, analyzeIron, foodIron, foodIronFromTags, foodIronFromUsdaGroup, foodIronOfProduct, ironDay, ironUnknownWhy, ironHints, mealParts } from "../src/lib/iron";
import { DRINKS, SOURCES } from "../src/lib/interactions";
import { mealCustom, mealDrink, mealFromComposition, mealFromOff, mealFromRecipe } from "../src/lib/diary";
import { fromOff } from "../src/lib/off";
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
ok("доля «данных нет» не больше 3%", cnt.D / CATALOG.length <= 0.03, cnt);
ok("мясо, птица, рыба, молочное, яйца — все со степенью B", CATALOG.filter((x) => ["Мясо", "Птица", "Рыба", "Яйца"].includes(x.c)).every((x) => foodIron(x.n, x).grade === "B"));

// Разметка бывших «D»: блюда, выпечка, лапша, напитки, сладости, экзотика
const fl = (n: string) => foodIron(n).flags;
ok("блюда типичного состава — степень C", ["Кордон блю", "Гирос", "Салат мимоза", "Пицца кусочек", "Лазанья готовая", "Паста карбонара готовая", "Суши наборы", "Борщ"].every((n) => foodIron(n).grade === "C" && foodIron(n).flags.length > 0));
ok("кордон блю: мясо и молочное; лазанья: мясо, молочное, мука", fl("Кордон блю").includes("meat") && fl("Кордон блю").includes("dairy") && ["meat", "dairy", "bakery"].every((f) => fl("Лазанья готовая").includes(f as never)));
ok("карбонара: мясо, яйцо, молочное", ["meat", "egg", "dairy"].every((f) => fl("Паста карбонара готовая").includes(f as never)));
ok("название называет ингредиент — степень B: форшмак, селёдка, уха, мисо, натто, лобио", ["Форшмак", "Салат селёдка под шубой", "Уха консервированная", "Мисо-паста белая", "Натто", "Лобио"].every((n) => foodIron(n).grade === "B"));
ok("икра масаго и тобико — рыба, а кабачковая икра — нет", fl("Икра масаго").includes("fish") && !fl("Икра кабачковая").includes("fish") && fl("Красная икра").includes("fish"));
ok("лапша, тесто, выпечка — изделия из очищенной муки (не «цельные крупы»)", ["Лапша удон сухая", "Тесто слоёное", "Брауни", "Круассаны замороженные", "Пряники тульские", "Вареники с вишней"].every((n) => fl(n).includes("bakery") && !fl(n).includes("grain")));
ok("каши и крупы — цельные зерновые", ["Каша пшённая", "Каша перловая", "Мамалыга замороженная", "Чумиза", "Рис бурый", "Дикий рис"].every((n) => fl(n).includes("grain")));
ok("белый рис, манка, рисовая каша — очищенные продукты, не «цельные крупы»", ["Рис парбоилд", "Рис отварной", "Каша рисовая", "Каша манная", "Рис пудинговый"].every((n) => fl(n).includes("bakery") && !fl(n).includes("grain")));
ok("молочное в сладком: мороженое, джелато, дульсе де лече; ватрушка и чизкейк — типично", ["Мороженое", "Джелато"].every((n) => fl(n).includes("dairy") && foodIron(n).grade === "B") && fl("Чизкейк готовый").includes("dairy") && foodIron("Чизкейк готовый").grade === "C");
ok("сыры мира: тильзит, курт, данаблю; раита, айран", ["Тильзит", "Курт", "Данаблю", "Раита", "Айран кислый"].every((n) => fl(n).includes("dairy")));
ok("алкоголь по названию: сидр, кагор, глинтвейн, брага, эль, гиннесс", ["Сидр", "Кагор", "Глинтвейн", "Брага", "Эль", "Гиннесс"].every((n) => fl(n).includes("alcohol")));
ok("бальзамический крем — не алкоголь", !fl("Бальзамический крем").includes("alcohol"));
ok("кэроб и ройбос — полифенолы", fl("Кэроб").includes("polyphenol") && fl("Ройбос").includes("polyphenol"));
ok("бобовые мира: дал, лобиани, фалафель, папад, анко", ["Дал", "Лобиани", "Фалафель", "Папад", "Анко"].every((n) => fl(n).includes("legume")));
ok("орехи и семена в сладком: нуга, пахлава, козинаки, халва, булочка с маком", ["Нуга", "Пахлава", "Козинаки", "Халва", "Булочка с маком", "Баба гануш"].every((n) => fl(n).includes("nuts")));
ok("овощи, фрукты, соусы на овощах, сахарозаменители — нейтральны (C)", ["Икра кабачковая", "Аджика", "Лечо готовое", "Дуриан замороженный", "Кизил", "Эритрит", "Стевия", "Агар", "Мёд", "Спрайт", "Драники", "Черри маринованные"].every((n) => foodIron(n).flags.length === 0 && foodIron(n).grade === "C"));
ok("грибы сушёные и чёрные грибы учтены", foodIron("Грибы сушёные белые").grade === "C" && foodIron("Чёрные грибы").grade === "C");
ok("ложные срабатывания новых правил: «Бальзам» ≠ «Бальзамический», «рис» ≠ «Приправа к рису», «мак» ≠ «макароны»", !fl("Приправа к рису").includes("grain") && !fl("Макароны").includes("nuts") && !fl("Рисовая лапша").includes("nuts"));
// Остаток без оценки — с причиной
const rest = CATALOG.filter((x) => foodIron(x.n, x).grade === "D");
ok("остаток без оценки: у каждого продукта есть причина", rest.length > 0 && rest.every((x) => ["supplement", "composite", "seaweed", "drink", "other"].includes(ironUnknownWhy(x.n))));
ok("причины: БАД, водоросли, составное блюдо, напиток", ironUnknownWhy("Протеин") === "supplement" && ironUnknownWhy("Нори") === "seaweed" && ironUnknownWhy("Салат оливье") === "composite" && ironUnknownWhy("Кола") === "drink");
ok("в остатке нет продуктов с однозначным названием (мясо, рыба, молочное, бобовые)", rest.every((x) => !["Мясо", "Птица", "Рыба", "Яйца", "Молочное", "Овощи", "Фрукты", "Крупы", "Хлеб"].includes(x.c)));

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

// Масштабирование: теги категорий Open Food Facts, группы USDA, состав с упаковки
const tags = (...t: string[]) => foodIronFromTags(t);
ok("теги OFF: мясо", tags("en:meats", "en:beef").flags.includes("meat") && tags("en:meats").grade === "B");
ok("теги OFF: рыба и морепродукты", tags("en:seafood", "en:fishes").flags.includes("fish"));
ok("теги OFF: молочное и сыры", tags("en:dairies", "en:cheeses").flags.includes("dairy"));
ok("теги OFF: сливочное масло — не источник кальция", !tags("en:dairies", "en:butters").flags.includes("dairy"));
ok("теги OFF: чай, кофе, шоколад — полифенолы", tags("en:teas").flags.includes("polyphenol") && tags("en:coffees").flags.includes("polyphenol") && tags("en:chocolates").flags.includes("polyphenol"));
ok("теги OFF: бобовые, соя, орехи, хлеб", tags("en:legumes-and-their-products").flags.includes("legume") && tags("en:soy-based-foods").flags.includes("soy") && tags("en:peanut-butters").flags.includes("nuts") && tags("en:breads").flags.includes("grain"));
ok("теги OFF: вино — алкоголь", tags("en:wines").flags.includes("alcohol"));
ok("теги OFF: неизвестное — D, масла и сахар — нейтральны (C)", tags("en:plant-based-foods").grade === "D" && tags("en:sugars").grade === "C" && tags("en:olive-oils").grade === "C");
ok("теги OFF: слова внутри слов не находятся (peach, pea)", !tags("en:peaches").flags.includes("legume") && !tags("en:nutmeg").flags.includes("nuts"));
ok("теги на других языках: viande, poissons", tags("fr:viandes").flags.includes("meat") && tags("fr:poissons").flags.includes("fish"));
ok("USDA: говядина и птица — мясо (B), молочное и яйца (C)", foodIronFromUsdaGroup("Beef Products").grade === "B" && foodIronFromUsdaGroup("Poultry Products").flags.includes("meat") && foodIronFromUsdaGroup("Dairy and Egg Products").grade === "C");
ok("группы канадской базы CNF (без запятых и в другом регистре)", ["Lamb, Veal and Game", "Sausages and Luncheon meats", "Nuts and Seeds", "Cereals, Grains and Pasta", "Fruits and fruit juices", "Breakfast cereals"].map((g) => foodIronFromUsdaGroup(g).grade).every((g) => g !== "D") && foodIronFromUsdaGroup("Lamb, Veal and Game").flags.includes("meat") && foodIronFromUsdaGroup("Nuts and Seeds").flags.includes("nuts"));
ok("USDA: смешанные группы — без оценки (D)", ["Fast Foods", "Baby Foods", "Snacks", "Soups, Sauces, and Gravies", "Meals, Entrees, and Side Dishes"].every((g) => foodIronFromUsdaGroup(g).grade === "D"));
const prod = foodIronOfProduct("Шоколад молочный", ["en:chocolates"]);
ok("товар: название и категория складываются", prod.flags.includes("polyphenol") && prod.grade === "B");
ok("товар: по составу — первые три компонента (мясо в начале)", foodIronOfProduct("Консерва", undefined, "говядина, вода, соль, специи").flags.includes("meat"));
ok("товар: молоко в конце состава не считается", !foodIronOfProduct("Печенье", undefined, "мука, сахар, масло, молоко сухое").flags.includes("dairy"));

// Open Food Facts: железо, кальций, витамин C (в OFF — граммы на 100 г)
const offJson = { status: 1, product: { product_name: "Говяжья тушёнка", quantity: "325 г", nutriments: { "energy-kcal_100g": 220, proteins_100g: 16, fat_100g: 17, carbohydrates_100g: 0, iron_100g: 0.0035, calcium_100g: 0.012, "vitamin-c_100g": 0.0005 }, categories_tags: ["en:meats", "en:canned-meats"], ingredients_text_ru: "Говядина, жир, соль, лавровый лист" } };
const op = fromOff("4600000000001", offJson)!;
ok("OFF: железо 0,0035 г → 3,5 мг, кальций 12 мг, витамин C 0,5 мг", op.per100!.fe === 3.5 && op.per100!.ca === 12 && op.per100!.vitC === 0.5, op.per100);
ok("OFF: категории и состав сохранены", op.cats?.[0] === "en:meats" && op.ingredients!.startsWith("Говядина"));
const om = mealFromOff(op, op.title, 150, D, "обед", "m1")!;
ok("запись по штрихкоду: железо на 150 г = 5,25 мг", om.n.fe === 5.3 || Math.abs(om.n.fe! - 5.25) < 0.06, om.n.fe);
ok("запись по штрихкоду хранит категории и состав", om.cats?.includes("en:meats") === true && !!om.ingredients);
const oa = analyzeIron("обед", [om], ctx)!;
ok("железо по штрихкоду: мясо по категории — усилитель", oa.enhancers.includes("мясо или рыба") && oa.level === "better", oa);
const noFe = mealFromOff({ code: "1", title: "Йогурт", per100: { kcal: 60 } }, "Йогурт", 100, D, "обед", "m1")!;
ok("без железа на упаковке — оценки нет", noFe.n.fe === undefined && analyzeIron("обед", [noFe], ctx) === null);

console.log(`iron: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
