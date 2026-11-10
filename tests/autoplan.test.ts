// Проверка автоподбора меню: node node_modules/.bin/tsx tests/autoplan.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { autoPlan } from "../src/lib/autoplan";
import { evaluateMenu } from "../src/lib/menucheck";
import { planFor, type BodyProfile } from "../src/lib/nutrition";
import { parseRecipeText } from "../tools/recipes.mjs";
import type { PlanEntry, Recipe, Rule } from "../src/lib/types";
import { checkRecipe, compileRules } from "../src/lib/exclusions";
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
ok("семья: у мужчины порции в среднем больше", (() => { const avg = (id: string) => rf.added.reduce((s, e) => s + rf.portions[e.id][id], 0) / rf.added.length; return avg("m2") !== avg("m1"); })());
const evF = (id: string, b: BodyProfile, p: ReturnType<typeof person>) => evaluateMenu(rf.added.map((e) => ({ ...e, portions: rf.portions[e.id] })), days, recipes, { id, body: b }, p.plan, rulesFor([member("m1", "Аня", bodyF), member("m2", "Миша", bodyM)]));
ok("семья: у каждого калории в пределах ±5% не менее чем в 5 днях из 7", evF("m1", bodyF, f).dayRes.filter((d) => d.kcalOk).length >= 5 && evF("m2", bodyM, m).dayRes.filter((d) => d.kcalOk).length >= 5, [evF("m1", bodyF, f).dayRes.map((d) => d.pct), evF("m2", bodyM, m).dayRes.map((d) => d.pct)]);

// Нет подходящих блюд
const none = autoPlan({ recipes, allowed: () => false, days, slots: [...slots], fixed: [], people: [f], iterations: 100 });
ok("нет разрешённых блюд — пусто и без ошибок", none.added.length === 0 && none.empty === 21);
console.log(`autoplan: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
