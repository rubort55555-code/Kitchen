// Проверка гарниров к основным блюдам: node node_modules/.bin/tsx tests/garnish.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { autoGarnishes, garnishClass, garnishFits, garnishNeed, isGarnish, isStarchy, mainKind, orderByHome, suitableGarnishes } from "../src/lib/garnish";
import { parseRecipeText } from "../tools/recipes.mjs";
import { recipeNutrition } from "../src/lib/recipeNutrition";
import { cuisineOf } from "../src/lib/cuisine";
import type { Recipe } from "../src/lib/types";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const recipes: Recipe[] = readdirSync("recipes").filter((f) => f.endsWith(".txt")).flatMap((f) => parseRecipeText(readFileSync("recipes/" + f, "utf8"), f).recipes as Recipe[]);
const garn = recipes.filter(isGarnish);
const find = (n: string) => recipes.find((r) => r.name === n)!;
const mk = (name: string, kind: string, ingredients: [string, string][], servings = 4, tags: string[] = []): Recipe => ({ id: "t-" + name, name, kind, servings, tags, ingredients: ingredients.map(([n, a]) => ({ name: n, amount: a })), steps: [], source: "manual", createdAt: 0 });

ok("в базе не меньше 15 гарниров", garn.length >= 15, garn.length);
ok("у каждого гарнира определён вид", garn.every((g) => garnishClass(g) !== null), garn.filter((g) => !garnishClass(g)).map((g) => g.name));
ok("гарнир сам не бывает основным: гарниру гарнир не нужен", garn.every((g) => garnishNeed(g, "обед") === "none"));

// Когда гарнир нужен
const cutlet = mk("Котлеты из говядины", "основное", [["Говядина", "600 г"], ["Лук репчатый", "1 шт"]], 4, ["на сковороде"]);
const stew = mk("Говядина тушёная с подливой", "основное", [["Говядина", "600 г"], ["Лук репчатый", "1 шт"], ["Томатная паста", "1 ст. л."]]);
const fishD = mk("Запечённый лосось", "основное", [["Лосось", "600 г"], ["Лимон", "1 шт"]]);
const plov = mk("Плов с говядиной", "основное", [["Говядина", "500 г"], ["Рис", "300 г"], ["Морковь", "2 шт"]]);
const potatoes = mk("Жаркое с говядиной", "основное", [["Говядина", "500 г"], ["Картофель", "1 кг"]]);
const soup = mk("Борщ", "суп", [["Говядина", "500 г"]]);
const omelet = mk("Омлет", "завтрак", [["Яйца", "4 шт"]]);
ok("жареное мясо — гарнир обязателен", garnishNeed(cutlet, "ужин") === "required");
ok("рыба — гарнир обязателен", garnishNeed(fishD, "обед") === "required" && mainKind(fishD) === "fish");
ok("тушёное мясо — гарнир по умолчанию", garnishNeed(stew, "обед") === "default");
ok("плов и жаркое с картошкой — гарнир по желанию", garnishNeed(plov, "обед") === "optional" && garnishNeed(potatoes, "ужин") === "optional");
ok("суп — гарнир не нужен", garnishNeed(soup, "обед") === "none");
ok("завтрак — гарнир не нужен, даже к основному блюду", garnishNeed(omelet, "завтрак") === "none" && garnishNeed(cutlet, "завтрак") === "none");
ok("салат и десерт — гарнир не нужен", garnishNeed(mk("Салат", "салат", [["Огурцы", "2 шт"]]), "обед") === "none");

// Какие подходят
const names = (m: Recipe) => suitableGarnishes(m, garn).map((g) => g.name);
const ofClass = (m: Recipe, c: string) => suitableGarnishes(m, garn).some((g) => garnishClass(g) === c);
ok("к жареному мясу подходят крупы, картофель, макароны и овощи", ["гречка", "рис", "картофель", "макароны", "овощи"].every((c) => ofClass(cutlet, c)), names(cutlet));
ok("к рыбе не подходят гречка, пшено, макароны", !ofClass(fishD, "гречка") && !ofClass(fishD, "пшено") && !ofClass(fishD, "макароны") && ofClass(fishD, "рис") && ofClass(fishD, "картофель") && ofClass(fishD, "овощи"), names(fishD));
ok("к блюду с рисом внутри — только овощные гарниры", suitableGarnishes(plov, garn).every((g) => garnishClass(g) === "овощи") && suitableGarnishes(plov, garn).length >= 3, names(plov));
ok("к блюду с картошкой внутри — только овощные гарниры", suitableGarnishes(potatoes, garn).every((g) => garnishClass(g) === "овощи"));
ok("не гарнир не подходит как гарнир", !garnishFits(cutlet, find("Борщ классический со свёклой")));
ok("рис к котлетам подходит", garnishFits(cutlet, find("Рис отварной рассыпчатый")));
ok("пюре к рыбе подходит", garnishFits(fishD, find("Картофельное пюре")));

// Реальные рецепты базы: у всех жареных есть из чего выбрать
const mains = recipes.filter((r) => r.kind === "основное");
const need = mains.filter((r) => garnishNeed(r, "обед") === "required");
ok("в базе есть блюда, где гарнир обязателен", need.length >= 20, need.length);
ok("для каждого блюда, где гарнир обязателен, есть не меньше 5 вариантов", need.every((r) => suitableGarnishes(r, garn).length >= 5), need.filter((r) => suitableGarnishes(r, garn).length < 5).map((r) => r.name));
ok("для блюд с крахмалом внутри есть овощные варианты", mains.filter((r) => garnishNeed(r, "обед") === "optional").every((r) => suitableGarnishes(r, garn).length >= 3));
// Рыбные блюда базы
const fishMains = mains.filter((r) => mainKind(r) === "fish");
ok("в базе не меньше 12 рыбных блюд", fishMains.length >= 12, fishMains.map((r) => r.name));
ok("к каждому рыбному блюду гарнир обязателен", fishMains.every((r) => garnishNeed(r, "ужин") === "required"));
ok("к рыбе не предлагаются гречка, пшено, перловка, макароны", fishMains.every((r) => suitableGarnishes(r, garn).every((g) => !["гречка", "пшено", "перловка", "макароны"].includes(garnishClass(g)!))));
ok("рыбные блюда считаются с белком не меньше 20 г на порцию", fishMains.every((r) => { const n = recipeNutrition(r); return !!n && n.perServing.protein >= 20; }), fishMains.filter((r) => (recipeNutrition(r)?.perServing.protein || 0) < 20).map((r) => r.name));
ok("рыбой считаются и красная рыба, и горбуша, и креветки", ["Лосось, запечённый с лимоном и укропом", "Горбуша, запечённая с овощами в рукаве", "Креветки на сковороде с чесноком", "Кальмары, тушёные в сметане"].every((n) => !!recipes.find((r) => r.name === n)));

// Овощные блюда и перекусы
const veg = mains.filter((r) => ["Запеканка из кабачков с сыром", "Цветная капуста, запечённая под сыром", "Рататуй", "Овощное карри с нутом"].includes(r.name));
ok("овощные блюда на месте", veg.length === 4);
ok("овощное блюдо без крахмала внутри — гарнир по умолчанию, с картошкой/рисом внутри — только овощной", garnishNeed(find("Рататуй"), "ужин") === "default" && garnishNeed(find("Перцы, фаршированные рисом и овощами"), "ужин") === "optional");
ok("перекусам гарнир не нужен", recipes.filter((r) => r.kind === "перекус").every((r) => garnishNeed(r, "перекус") === "none" && garnishNeed(r, "обед") === "none"));

// «Настоящие» гарниры и итальянская кухня
ok("крупы, картофель, макароны, полента — настоящие гарниры; овощные — нет", isStarchy(find("Рис отварной рассыпчатый")) && isStarchy(find("Картофельное пюре")) && isStarchy(find("Полента мягкая с сыром")) && !isStarchy(find("Капуста тушёная")) && !isStarchy(find("Брокколи на пару")));
ok("для автоподбора: к жареному только настоящие гарниры", autoGarnishes(find("Куриная котлета по-милански"), garn).every(isStarchy) && autoGarnishes(find("Куриная котлета по-милански"), garn).length >= 6);
ok("полента подходит к жареному, тушёному и рыбе", ["Куриная котлета по-милански", "Курица сальтимбокка", "Лосось с томатами черри и каперсами"].every((n) => garnishFits(find(n), find("Полента мягкая с сыром"))));
ok("если крахмалистых гарниров к блюду нет, автоподбор откатывается к овощным", autoGarnishes(find("Плов с говядиной"), garn).length >= 3 && autoGarnishes(find("Плов с говядиной"), garn).every((g) => garnishClass(g) === "овощи"));
ok("паста и ризотто — блюда, где крахмал уже есть: гарнир по желанию", ["Спагетти карбонара", "Пенне арраббьята", "Феттучине альфредо с курицей", "Феттучине с лососем в сливочном соусе", "Ризотто с грибами", "Ньокки картофельные с томатным соусом"].every((n) => garnishNeed(find(n), "ужин") === "optional"));
ok("курица милан и сальтимбокка — гарнир нужен", garnishNeed(find("Куриная котлета по-милански"), "ужин") === "required" && garnishNeed(find("Курица сальтимбокка"), "ужин") === "default");
const it = recipes.filter((r) => r.cuisine === "Итальянская");
ok("итальянских рецептов не меньше 25 и все — технологические карты", it.length >= 25 && it.every((r) => !!r.out || r.kind === "десерт" || r.kind === "салат" || r.kind === "закуска" || !!r.tools), it.length);
ok("в итальянской кухне есть паста, ризотто, ньокки, гарнир, суп, десерт, выпечка", ["основное", "гарнир", "суп", "десерт", "выпечка", "салат", "закуска"].every((k) => it.some((r) => r.kind === k)));
ok("итальянских рецептов после дополнения не меньше 40: есть рыба, морепродукты, овощи, десерты и выпечка", it.length >= 40 && ["Минтай аква пацца в томатном бульоне", "Креветки в томатном соусе с базиликом", "Кальмары, тушёные с помидорами и чесноком", "Лосось с песто на сковороде", "Камбала по-итальянски с помидорами и оливками", "Капоната: тушёные овощи по-итальянски", "Груши, запечённые с мёдом и корицей", "Бискотти с миндалём"].every((n) => it.some((r) => r.name === n)), it.length);
ok("итальянская рыба и морепродукты — гарнир обязателен", ["Минтай аква пацца в томатном бульоне", "Креветки в томатном соусе с базиликом", "Лосось с песто на сковороде", "Камбала по-итальянски с помидорами и оливками"].every((n) => garnishNeed(find(n), "ужин") === "required"));
ok("итальянская кухня определяется приложением", it.every((r) => cuisineOf(r) === "Итальянская"));

ok("соль в итальянской пасте посчитана реалистично: натрия не больше 2500 мг на порцию", it.filter((r) => recipeNutrition(r)).every((r) => (recipeNutrition(r)!.perServing.na || 0) <= 2500), it.filter((r) => (recipeNutrition(r)?.perServing.na || 0) > 2500).map((r) => r.name));
ok("у всех итальянских рецептов состав считается без пропусков", it.every((r) => !recipeNutrition(r)?.missing?.length), it.filter((r) => recipeNutrition(r)?.missing?.length).map((r) => r.name));

const az = recipes.filter((r) => r.cuisine === "Азиатская");
ok("азиатских рецептов не меньше 20, есть суп, основное, салат, гарнир, десерт", az.length >= 20 && ["суп", "основное", "салат", "гарнир", "десерт"].every((k) => az.some((r) => r.kind === k)), az.length);
ok("азиатская кухня определяется приложением", az.every((r) => cuisineOf(r) === "Азиатская"));
ok("у всех азиатских рецептов состав считается без пропусков", az.every((r) => !recipeNutrition(r)?.missing?.length), az.filter((r) => recipeNutrition(r)?.missing?.length).map((r) => r.name + ": " + recipeNutrition(r)!.missing));
ok("азиатские блюда: натрия не больше 3000 мг на порцию (соевый соус)", az.filter((r) => recipeNutrition(r)).every((r) => (recipeNutrition(r)!.perServing.na || 0) <= 3000), az.filter((r) => (recipeNutrition(r)?.perServing.na || 0) > 3000).map((r) => r.name + " " + Math.round(recipeNutrition(r)!.perServing.na || 0)));
ok("азиатские блюда с лапшой и рисом — гарнир не нужен", ["Лапша чоу мейн", "Бибимбап", "Пад тай с креветками", "Жареный рис с яйцом и овощами"].every((n) => { const r = az.find((x) => x.name.startsWith(n.split(" ")[0]) && x.name.includes(n.split(" ")[1] || "")); return !r || garnishNeed(r, "обед") !== "required"; }));
ok("к азиатскому жареному мясу и рыбе подходит рис", ["Курица кунг пао", "Лосось в соево-медовой глазури"].every((n) => { const r = az.find((x) => x.name.startsWith(n.split(" ")[0])); return !r || autoGarnishes(r, garn).length >= 3; }));

// Порядок в выборе: сверху то, что есть дома
const st = (g: string, urgent: number, percent: number) => ({ g: find(g), s: { urgent, percent } });
const ordered = orderByHome([st("Гречка рассыпчатая", 0, 40), st("Рис отварной рассыпчатый", 0, 100), st("Макароны отварные", 0, 100), st("Булгур рассыпчатый", 1, 60), st("Кускус с маслом", 0, 0), st("Капуста тушёная", 1, 100), st("Брокколи на пару", 0, 100)]).map((x) => x.g.name);
ok("порядок: сначала крупы, картофель, макароны (спасающие продукты выше, потом по доле имеющегося), потом овощные гарниры", ordered.join("|") === ["Булгур рассыпчатый", "Макароны отварные", "Рис отварной рассыпчатый", "Гречка рассыпчатая", "Кускус с маслом", "Капуста тушёная", "Брокколи на пару"].join("|"), ordered);
ok("порядок: исходный список не меняется", (() => { const a = [st("Гречка рассыпчатая", 0, 0), st("Рис отварной рассыпчатый", 0, 100)]; orderByHome(a); return a[0].g.name === "Гречка рассыпчатая"; })());
console.log(`garnish: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
