// Проверка автоподбора меню: node node_modules/.bin/tsx tests/autoplan.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { autoPlan } from "../src/lib/autoplan";
import { recipeNutrition } from "../src/lib/recipeNutrition";
import { assess } from "../src/lib/assess";
import { evaluateMenu, menuMeals } from "../src/lib/menucheck";
import { planFor, type BodyProfile } from "../src/lib/nutrition";
import { parseRecipeText } from "../tools/recipes.mjs";
import type { PlanEntry, Recipe, Rule } from "../src/lib/types";
import { checkRecipe, compileRules } from "../src/lib/exclusions";
import { fitsSlot } from "../src/lib/plan";
import { isStarchy, garnishFits, garnishNeed, isGarnish } from "../src/lib/garnish";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const recipes: Recipe[] = readdirSync("recipes").filter((f) => f.endsWith(".txt")).flatMap((f) => parseRecipeText(readFileSync("recipes/" + f, "utf8"), f).recipes as Recipe[]);
const NOW = new Date("2026-11-10T12:00:00Z");
const days = Array.from({ length: 7 }, (_, i) => `2026-11-${11 + i}`);
const slots = ["завтрак", "обед", "ужин"] as const;
const member = (id: string, name: string, body: BodyProfile) => ({ id, name, allergies: [], dislikes: [], body });
const bodyF: BodyProfile = { sex: "f", born: 1991, height: 165, weight: 62, goal: "keep" };
const bodyM: BodyProfile = { sex: "m", born: 1985, height: 182, weight: 88, goal: "lose" };
const person = (id: string, b: BodyProfile) => ({ id, body: b, plan: planFor(b, NOW)! });
const rulesFor = (mem: ReturnType<typeof member>[], rules: Rule[] = []) => [rules, [], mem] as Parameters<typeof evaluateMenu>[5];

// Один человек
const f = person("m1", bodyF);
const r1 = autoPlan({ recipes, allowed: () => true, days, slots: [...slots], fixed: [], people: [f], iterations: 8000 });
ok("заполнены все 21 место", r1.added.length === 21 && r1.empty === 0, [r1.added.length, r1.empty]);
ok("на каждое блюдо есть порция человека", r1.added.every((e) => typeof r1.portions[e.id]?.m1 === "number"));
ok("порции в границах и кратны 0,25", Object.values(r1.portions).every((p) => Object.values(p).every((x) => x >= 0.5 && x <= 2 && Math.abs(x * 4 - Math.round(x * 4)) < 1e-9)));
ok("блюдо не больше двух раз за неделю", (() => { const c = new Map<string, number>(); r1.added.forEach((e) => c.set(e.recipeId!, (c.get(e.recipeId!) || 0) + 1)); return Math.max(...c.values()) <= 2; })());
ok("завтрак — из завтраков, ужин не суп", r1.added.filter((e) => e.slot === "завтрак").every((e) => /завтрак|каша|омлет|йогурт|гренк|сырник|блин|оладь|яичн|запеканк|овсян|творог|тост|ленив|панкейк|шакшук|скрэмбл/i.test(e.name + (recipes.find((r) => r.id === e.recipeId)?.kind || ""))));
const entries1: PlanEntry[] = r1.added.map((e) => ({ ...e, portions: r1.portions[e.id] }));
const ev1 = evaluateMenu(entries1, days, recipes, { id: "m1", body: bodyF }, f.plan, rulesFor([member("m1", "Аня", bodyF)]));
const okDays = ev1.dayRes.filter((d) => d.ok).length;
ok("калории каждого дня в пределах ±5%", ev1.dayRes.every((d) => d.kcalOk), ev1.dayRes.map((d) => d.pct));
ok("белок каждого дня не ниже нормы", ev1.dayRes.every((d) => d.proteinOk));
ok("жиры и углеводы в норме не менее чем в 5 днях из 7", okDays >= 5, okDays);
ok("запретов нет", ev1.levels[0].ok);
ok("рыба в меню не реже двух раз за неделю", !ev1.levels[4].items.some((x) => x.includes("Рыбы меньше двух")), ev1.levels[4].items);

// Гарниры: к блюдам, где он обязателен или по умолчанию, — всегда; только подходящие; к остальным не ставим
const byId = (id: string) => recipes.find((r) => r.id === id)!;
const needy = r1.added.filter((e) => ["required", "default"].includes(garnishNeed(byId(e.recipeId!), e.slot)));
ok("в меню есть блюда, которым нужен гарнир", needy.length >= 3, needy.length);
ok("к каждому такому блюду подобран гарнир", needy.every((e) => !!e.garnish), needy.filter((e) => !e.garnish).map((e) => e.name));
ok("гарниры только из подходящих к блюду", r1.added.filter((e) => e.garnish).every((e) => isGarnish(byId(e.garnish!.id)) && garnishFits(byId(e.recipeId!), byId(e.garnish!.id))));
ok("к супам и завтракам гарнир не ставится", r1.added.filter((e) => garnishNeed(byId(e.recipeId!), e.slot) === "none").every((e) => !e.garnish));
ok("к блюдам с крахмалом внутри (плов, паста, жаркое с картошкой) гарнир сам не ставится", r1.added.filter((e) => garnishNeed(byId(e.recipeId!), e.slot) === "optional").every((e) => !e.garnish));
ok("автоподбор ставит «настоящие» гарниры: крупы, картофель, макароны, полента, а не отварную капусту", r1.added.filter((e) => e.garnish).every((e) => isStarchy(byId(e.garnish!.id))), r1.added.filter((e) => e.garnish).map((e) => e.garnish!.name));
ok("один гарнир не больше трёх раз за неделю", (() => { const c = new Map<string, number>(); r1.added.forEach((e) => e.garnish && c.set(e.garnish.id, (c.get(e.garnish.id) || 0) + 1)); return !c.size || Math.max(...c.values()) <= 3; })());
ok("гарнир не ставится отдельным блюдом меню", r1.added.every((e) => !isGarnish(byId(e.recipeId!))));

// Результат лучше случайного меню (те же рецепты, без оптимизации)
const rand = autoPlan({ recipes, allowed: () => true, days, slots: [...slots], fixed: [], people: [f], iterations: 0, seed: 3 });
const evR = evaluateMenu(rand.added.map((e) => ({ ...e, portions: rand.portions[e.id] })), days, recipes, { id: "m1", body: bodyF }, f.plan, rulesFor([member("m1", "Аня", bodyF)]));
const score = (e: typeof ev1) => e.dayRes.filter((d) => !d.ok).length * 1000 + e.lacking.length * 10 + e.limits.filter((l) => l.status !== "ok").length * 100;
ok("оптимизация лучше случайного заполнения", score(ev1) < score(evR), [score(ev1), score(evR)]);

// Повторяемость
const r1b = autoPlan({ recipes, allowed: () => true, days, slots: [...slots], fixed: [], people: [f], iterations: 8000 });
ok("тот же результат при тех же данных (кроме id)", JSON.stringify(r1.added.map((e) => [e.date, e.slot, e.recipeId, e.side?.id])) === JSON.stringify(r1b.added.map((e) => [e.date, e.slot, e.recipeId, e.side?.id])));

// Запреты: только разрешённые блюда
const rule: Rule = { id: "r1", title: "Рыба", level: "never", words: ["картофел"], who: "all" };
const compiled = compileRules([rule], [], [member("m1", "Аня", bodyF)]);
const allowed = (r: Recipe) => checkRecipe(r, compiled, ["m1"]).verdict === "ok";
const r2 = autoPlan({ recipes, allowed, days, slots: [...slots], fixed: [], people: [f], iterations: 4000 });
ok("запрет: ни одного блюда с запрещённым продуктом", r2.added.every((e) => allowed(recipes.find((r) => r.id === e.recipeId)!) && (!e.side || allowed(recipes.find((r) => r.id === e.side!.id)!))));
const ev2 = evaluateMenu(r2.added.map((e) => ({ ...e, portions: r2.portions[e.id] })), days, recipes, { id: "m1", body: bodyF }, f.plan, rulesFor([member("m1", "Аня", bodyF)], [rule]));
ok("запрет: первый уровень оценки в норме", ev2.levels[0].ok, ev2.levels[0]);

// Уже стоящие блюда сохраняются, порции подбираются
const keep: PlanEntry = { id: "keep1", date: days[0], slot: "обед", name: "Борщ классический со свёклой", recipeId: recipes.find((r) => r.name === "Борщ классический со свёклой")!.id };
const r3 = autoPlan({ recipes, allowed: () => true, days, slots: [...slots], fixed: [keep], people: [f], iterations: 4000 });
ok("стоящее блюдо не заменяется и не дублируется", r3.added.length === 20 && !r3.added.some((e) => e.date === days[0] && e.slot === "обед"));
ok("для стоящего блюда подобрана порция", typeof r3.portions["keep1"]?.m1 === "number");

// Семья: две разные нормы, общие блюда, порции свои
const m = person("m2", bodyM);
const rf = autoPlan({ recipes, allowed: () => true, days, slots: [...slots], fixed: [], people: [f, m], iterations: 8000 });
ok("семья: порции у обоих", rf.added.every((e) => rf.portions[e.id]?.m1 && rf.portions[e.id]?.m2));
ok("семья: порции стандартные — по одной на человека, число порций выбирает человек", rf.added.every((e) => rf.portions[e.id].m1 === 1 && rf.portions[e.id].m2 === 1));
const evF = (id: string, b: BodyProfile, p: ReturnType<typeof person>) => evaluateMenu(rf.added.map((e) => ({ ...e, portions: rf.portions[e.id] })), days, recipes, { id, body: b }, p.plan, rulesFor([member("m1", "Аня", bodyF), member("m2", "Миша", bodyM)]));
// при стандартных порциях калории каждого человека зависят от выбора блюд; подгонка порций под норму убрана — число порций выбирает человек

// Стоящее блюдо без гарнира получает гарнир; гарнир, выбранный пользователем, не меняется
const cut = recipes.find((r) => garnishNeed(r, "ужин") === "required")!;
const mine = recipes.find((r) => isGarnish(r) && garnishFits(cut, r))!;
const fx: PlanEntry[] = [{ id: "u1", date: days[1], slot: "ужин", name: cut.name, recipeId: cut.id }, { id: "u2", date: days[2], slot: "ужин", name: cut.name, recipeId: cut.id, garnish: { id: mine.id, name: mine.name } }];
const r4 = autoPlan({ recipes, allowed: () => true, days, slots: [...slots], fixed: fx, people: [f], iterations: 3000 });
ok("стоящему блюду без гарнира подобран гарнир", !!r4.garnishes["u1"] && garnishFits(cut, byId(r4.garnishes["u1"].id)), r4.garnishes);
ok("выбранный пользователем гарнир не трогаем", !r4.garnishes["u2"]);

// Перекус: отдельный приём пищи, блюда только вида «перекус», без гарнира
const snack = recipes.find((r) => r.kind === "перекус")!;
ok("в базе не меньше 10 перекусов и 10 овощных блюд", recipes.filter((r) => r.kind === "перекус").length >= 10 && recipes.filter((r) => r.kind === "основное" && !/мяс|говяд|свинин|курин|куриц|индейк|рыб|минтай|лосос|креветк|кальмар/i.test(r.name + r.ingredients.map((i) => i.name).join(" "))).length >= 10);
ok("перекус подходит только к перекусу", fitsSlot(snack, "перекус") && !fitsSlot(snack, "ужин") && !fitsSlot(snack, "обед") && !fitsSlot(snack, "завтрак") && !fitsSlot(recipes.find((r) => r.kind === "основное")!, "перекус"));
const r5 = autoPlan({ recipes, allowed: () => true, days, slots: [...slots, "перекус"], fixed: [], people: [f], iterations: 8000 });
ok("с перекусом заполнено 28 мест", r5.added.length === 28 && r5.empty === 0, r5.added.length);
ok("на перекус стоят только перекусы, без гарнира", r5.added.filter((e) => e.slot === "перекус").length === 7 && r5.added.filter((e) => e.slot === "перекус").every((e) => byId(e.recipeId!).kind === "перекус" && !e.garnish));
const ev5 = evaluateMenu(r5.added.map((e) => ({ ...e, portions: r5.portions[e.id] })), days, recipes, { id: "m1", body: bodyF }, f.plan, rulesFor([member("m1", "Аня", bodyF)]));
ok("с перекусами калории каждого дня в пределах ±5%", ev5.dayRes.every((d) => d.kcalOk), ev5.dayRes.map((d) => d.pct));
ok("перекусы помогают кальцию: в среднем за неделю не хуже, чем без них", (ev5.micro.find((m) => m.key === "ca")?.pct || 0) >= (ev1.micro.find((m) => m.key === "ca")?.pct || 0) - 2, [ev5.micro.find((m) => m.key === "ca")?.pct, ev1.micro.find((m) => m.key === "ca")?.pct]);

// Блюда «из того, что есть дома»: на ужин берутся только готовые к приготовлению, если их хватает
const homeSet = new Set(recipes.filter((r) => fitsSlot(r, "ужин") && !isGarnish(r)).slice(0, 12).map((r) => r.id));
const rh = autoPlan({ recipes, allowed: () => true, ready: (r) => homeSet.has(r.id), days: days.slice(0, 1), slots: ["ужин"], fixed: [], people: [f], iterations: 2000 });
ok("ужин выбирается из блюд, которые можно приготовить из имеющегося", rh.added.length === 1 && homeSet.has(rh.added[0].recipeId!));

// Только один приём пищи: нормы дня на него не накладываются целиком
const ro = autoPlan({ recipes, allowed: () => true, days: days.slice(0, 1), slots: ["обед"], fixed: [], people: [f], iterations: 3000 });
const evo = evaluateMenu(ro.added.map((e) => ({ ...e, portions: ro.portions[e.id] })), days.slice(0, 1), recipes, { id: "m1", body: bodyF }, f.plan, rulesFor([member("m1", "Аня", bodyF)]));
ok("только обед: калории обеда ≈ 40% нормы дня", !!evo.dayRes[0] && evo.dayRes[0].kcal < f.plan.kcal * 0.6 && evo.dayRes[0].kcalOk, [evo.dayRes[0]?.kcal, f.plan.kcal]);

const fullLack = assess(menuMeals(ro.added.map((e) => ({ ...e, portions: ro.portions[e.id] })), recipes, "m1").meals, f.plan, bodyF, 0, recipes)!.micro.filter((r) => r.v > 0 && r.pct < 90).length;
ok("только обед: недельная проверка требует меньше витаминов, чем при сравнении с нормой всего дня", evo.lacking.length < fullLack, [evo.lacking.length, fullLack]);

// Завтрак уже стоит в меню, подбираем только ужин: цель ужина — его доля дня, а не 60% нормы
const fixedB: PlanEntry = { id: "fb", date: days[0], slot: "завтрак", name: "Завтрак", recipeId: recipes.find((r) => r.kind === "завтрак")!.id };
const rfb = autoPlan({ recipes, allowed: () => true, days: [days[0]], slots: ["ужин"], fixed: [fixedB], people: [f], iterations: 2000 });
const dinKcal = (() => { const e = rfb.added[0]; const k = (id?: string) => (id ? recipeNutrition(recipes.find((r) => r.id === id)!)?.perServing.kcal || 0 : 0); return k(e.recipeId) + k(e.garnish?.id) + k(e.side?.id); })();
ok("ужин при уже стоящем завтраке не раздувается (≈30% нормы, не 60%)", dinKcal < f.plan.kcal * 0.45, [Math.round(dinKcal), f.plan.kcal]);

// Нет подходящих блюд
const none = autoPlan({ recipes, allowed: () => false, days, slots: [...slots], fixed: [], people: [f], iterations: 100 });
ok("нет разрешённых блюд — пусто и без ошибок", none.added.length === 0 && none.empty === 21);
console.log(`autoplan: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
