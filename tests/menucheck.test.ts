// Проверка порций и оценки меню: node node_modules/.bin/tsx tests/menucheck.test.ts
import { readFileSync, readdirSync } from "node:fs";
import { evaluateMenu, fitDay, fitWeek, menuMeals, portionOf, snapPortion, PORTION_MAX, PORTION_MIN } from "../src/lib/menucheck";
import { planFor, type BodyProfile } from "../src/lib/nutrition";
import { parseRecipeText } from "../tools/recipes.mjs";
import type { PlanEntry, Recipe, Rule } from "../src/lib/types";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const recipes: Recipe[] = readdirSync("recipes").filter((f) => f.endsWith(".txt")).flatMap((f) => parseRecipeText(readFileSync("recipes/" + f, "utf8"), f).recipes as Recipe[]);
const find = (n: string) => recipes.find((r) => r.name === n)!;
const body: BodyProfile = { sex: "f", born: 1991, height: 165, weight: 62, goal: "keep" };
const NOW = new Date("2026-11-10T12:00:00Z");
const plan = planFor(body, NOW)!;
const me = { id: "m1", body };
const E = (id: string, date: string, slot: PlanEntry["slot"], name: string, extra: Partial<PlanEntry> = {}): PlanEntry => ({ id, date, slot, name, recipeId: find(name).id, ...extra });

// Округление порций
ok("порция: шаг 0,25", snapPortion(1.1) === 1 && snapPortion(1.2) === 1.25 && snapPortion(1.4) === 1.5);
ok("порция: границы 0,5 и 2", snapPortion(0.1) === PORTION_MIN && snapPortion(5) === PORTION_MAX);
ok("порция по умолчанию — одна", portionOf(E("a", "2026-11-11", "обед", "Борщ классический со свёклой"), "m1") === 1);
ok("порция человека берётся по его id", portionOf(E("a", "2026-11-11", "обед", "Борщ классический со свёклой", { portions: { m1: 1.5 } }), "m1") === 1.5 && portionOf(E("a", "2026-11-11", "обед", "Борщ классический со свёклой", { portions: { m1: 1.5 } }), "m2") === 1);

// Пересчёт порций
const day: PlanEntry[] = [
  E("b", "2026-11-11", "завтрак", "Омлет классический"),
  E("l", "2026-11-11", "обед", "Борщ классический со свёклой"),
  E("d", "2026-11-11", "ужин", "Курица с картошкой в духовке"),
].filter((e) => e.recipeId) as PlanEntry[];
ok("в базе есть блюда для примера", day.length === 3, day.map((d) => d.name));
const kcal1 = menuMeals(day, recipes, "m1").meals.reduce((s, m) => s + (m.n.kcal || 0), 0);
const fit = fitDay(day, recipes, "m1", plan)!;
ok("порции в границах 0,5–2 и кратны 0,25", Object.values(fit.portions).every((p) => p >= 0.5 && p <= 2 && Math.abs(p * 4 - Math.round(p * 4)) < 1e-9), fit.portions);
ok("подбор приближает калории к цели лучше, чем по одной порции", Math.abs(fit.kcal - plan.kcal) <= Math.abs(kcal1 - plan.kcal), [fit.kcal, kcal1, plan.kcal]);
ok("итог дня после подбора совпадает с расчётом по порциям", (() => { const e2 = day.map((e) => ({ ...e, portions: { m1: fit.portions[e.id] } })); const k = menuMeals(e2, recipes, "m1").meals.reduce((s, m) => s + (m.n.kcal || 0), 0); return Math.abs(k - fit.kcal) < 2; })());
ok("пустой день — нет подбора", fitDay([], recipes, "m1", plan) === null);
const wk = fitWeek([...day, ...day.map((e) => ({ ...e, id: e.id + "2", date: "2026-11-12" }))], recipes, "m1", plan);
ok("неделя: порции на каждое блюдо и два дня", Object.keys(wk.portions).length === 6 && wk.days.length === 2);

// Оценка
const rules: Parameters<typeof evaluateMenu>[5] = [[] as Rule[], [], [{ id: "m1", name: "Аня", allergies: [], dislikes: [] }]];
const rec = (n: string) => recipes.find((r) => r.name === n);
const bad = evaluateMenu(day, ["2026-11-11"], recipes, me, plan, rules);
ok("оценка: пять уровней", bad.levels.length === 5 && bad.levels.map((l) => l.n).join("") === "12345");
ok("оценка: один день из трёх блюд — калории не по цели, второй уровень не пройден или пройден по фактам", bad.dayRes.length === 1 && bad.levels[1].ok === bad.dayRes[0].ok);
const fitted = evaluateMenu(day.map((e) => ({ ...e, portions: { m1: fit.portions[e.id] } })), ["2026-11-11"], recipes, me, plan, rules);
ok("после подбора отклонение калорий не хуже, чем было", Math.abs(fitted.dayRes[0].pct - 100) <= Math.abs(bad.dayRes[0].pct - 100), [bad.dayRes[0].pct, fitted.dayRes[0].pct]);
ok("оценка: пределы и витамины считаются", fitted.limits.length >= 1 && fitted.micro.length > 5);
ok("оценка: клетчатка и витамины ниже 90% попадают в «не хватает»", fitted.lacking.every((r) => r.pct < 90));
ok("оценка: ok = все уровни 1–4", fitted.ok === fitted.levels.slice(0, 4).every((l) => l.ok));

// Запрет
const fish = recipes.find((r) => /лосос|рыб/i.test(r.name + r.ingredients.map((i) => i.name).join(" ")));
if (fish) {
  const rule: Rule = { id: "r1", title: "Рыба", level: "never", words: ["рыб", "лосос"], who: "all" };
  const withRule: Parameters<typeof evaluateMenu>[5] = [[rule], [], [{ id: "m1", name: "Аня", allergies: [], dislikes: [] }]];
  const ev = evaluateMenu([{ id: "f", date: "2026-11-11", slot: "обед", name: fish.name, recipeId: fish.id }], ["2026-11-11"], recipes, me, plan, withRule);
  ok("запрет: блюдо с рыбой при правиле «никогда» ловится на первом уровне", ev.levels[0].ok === false && ev.levels[0].items.length === 1, ev.levels[0]);
  const okEv = evaluateMenu([{ id: "f", date: "2026-11-11", slot: "обед", name: "Борщ", recipeId: find("Борщ классический со свёклой").id }], ["2026-11-11"], recipes, me, plan, withRule);
  ok("запрет: блюдо без рыбы первый уровень проходит", okEv.levels[0].ok);
}
// Гарнир идёт в расчёт вместе с блюдом
const rice = find("Рис отварной рассыпчатый");
const cutE = E("c1", "2026-11-11", "ужин", "Курица с картошкой в духовке");
const withG = { ...cutE, garnish: { id: rice.id, name: rice.name } };
const kc = (es: PlanEntry[]) => menuMeals(es, recipes, "m1").meals.reduce((s, m) => s + (m.n.kcal || 0), 0);
ok("гарнир добавляет калории блюда", kc([withG]) > kc([cutE]) + 200, [kc([withG]), kc([cutE])]);
ok("порция блюда меняет и гарнир", Math.abs(kc([{ ...withG, portions: { m1: 2 } }]) - 2 * kc([withG])) < 3);
// на один ужин приходится 30% суточной нормы
const fitG = fitDay([withG], recipes, "m1", plan)!;
ok("подбор порций учитывает гарнир", fitG.kcal > 0 && Math.abs(fitG.kcal - plan.kcal * 0.3) <= Math.abs(kc([withG]) - plan.kcal * 0.3) + 1, [fitG.kcal, plan.kcal]);
const frying = recipes.find((r) => r.kind === "основное" && /котлет|отбивн|жарен/i.test(r.name))!;
const noG = evaluateMenu([{ id: "n1", date: "2026-11-11", slot: "ужин", name: frying.name, recipeId: frying.id }], ["2026-11-11"], recipes, me, plan, rules);
ok("к жареному без гарнира — замечание «нужен гарнир»", noG.levels[4].items.some((x) => x.includes("нужен гарнир")), noG.levels[4]);
const yesG = evaluateMenu([{ id: "n1", date: "2026-11-11", slot: "ужин", name: frying.name, recipeId: frying.id, garnish: { id: rice.id, name: rice.name } }], ["2026-11-11"], recipes, me, plan, rules);
ok("с гарниром замечания нет", !yesG.levels[4].items.some((x) => x.includes("нужен гарнир")));

// Разнообразие
const same = [0, 1, 2].map((i) => E("x" + i, `2026-11-1${i}`, "обед", "Борщ классический со свёклой"));
const rep = evaluateMenu(same, same.map((e) => e.date), recipes, me, plan, rules);
ok("разнообразие: одно блюдо трижды за неделю", rep.levels[4].ok === false && rep.levels[4].items.some((x) => x.includes("не больше двух")), rep.levels[4]);
console.log(`menucheck: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
