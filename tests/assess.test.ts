// Проверка оценки рациона по МР: node node_modules/.bin/tsx tests/assess.test.ts
import { assess, drinksMl } from "../src/lib/assess";
import { planFor, type BodyProfile } from "../src/lib/nutrition";
import { mealCustom, mealDrink } from "../src/lib/diary";
import { DRINKS } from "../src/lib/interactions";
import type { Meal } from "../src/lib/types";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const body: BodyProfile = { sex: "f", born: 1991, height: 165, weight: 62, goal: "keep" };
const plan = planFor(body, new Date("2026-11-10T12:00:00Z"))!;
const meal = (date: string, n: Meal["n"], name = "Блюдо"): Meal => ({ ...mealCustom(name, { kcal: 100 }, date, "обед", "m1")!, n: { kcal: 100, ...n } });

ok("без записей — нет оценки", assess([], plan, body, 0) === null);
// День точно по норме
const full = meal("2026-11-09", { kcal: plan.kcal, protein: plan.protein, fat: plan.fat, carbs: plan.carbs, fiber: plan.fiber, na: 1500, vitC: 120 });
const a = assess([full], plan, body, plan.water * 1000)!;
ok("день по норме: макро в норме", a.macro.every((r) => r.status === "ok"), a.macro);
ok("день по норме: вода в норме", a.water!.status === "ok");
ok("день по норме: нет замечаний", a.issues.length === 0, a.issues);
ok("витамин C 120 мг — в норме", a.micro.find((r) => r.key === "vitC")!.status === "ok");
ok("кальций без данных — мало", a.micro.find((r) => r.key === "ca")!.status === "low");
// Мало белка и клетчатки, много натрия
const bad = assess([meal("2026-11-09", { kcal: plan.kcal, protein: plan.protein * 0.5, fat: plan.fat, carbs: plan.carbs, fiber: 5, na: 3500 })], plan, body, 500)!;
ok("белка 50% — мало", bad.macro.find((r) => r.key === "protein")!.status === "low");
ok("клетчатка 5 г — мало", bad.macro.find((r) => r.key === "fiber")!.status === "low");
ok("натрий 3500 — выше предела", bad.limits.find((r) => r.key === "na")!.status === "over" && bad.issues.some((x) => x.startsWith("Натрий")));
ok("вода 500 мл — мало", bad.water!.status === "low");
ok("замечания перечислены", bad.issues.length >= 4, bad.issues);
// Неделя: среднее за дни с записями
const wk = assess([meal("2026-11-03", { kcal: 2000 }), meal("2026-11-05", { kcal: 1000 })], plan, body, 0)!;
ok("неделя: 2 дня с записями, среднее 1500", wk.days === 2 && wk.macro[0].v === 1500, [wk.days, wk.macro[0].v]);
ok("несколько записей за один день — один день", assess([meal("2026-11-03", { kcal: 700 }), meal("2026-11-03", { kcal: 800 })], plan, body, 0)!.days === 1);
// Напитки идут в воду
const tea = mealDrink(DRINKS.find((d) => d.key === "blackTea")!, 2, "2026-11-09", "завтрак", "m1")!;
ok("напитки: 2 чая × 200 мл = 400 мл", drinksMl([tea]) === 400, drinksMl([tea]));
ok("напитки входят в «Вода и напитки»", assess([tea], plan, body, 0)!.water!.v === 400);
ok("обычная запись с «мл» в названии порции не считается напитком", drinksMl([{ ...meal("2026-11-09", {}), qty: "200 мл" }]) === 0);
// Записи без данных о витаминах
ok("записи без данных о микроэлементах посчитаны", a.noMicro === 0 && bad.noMicro === 1, [a.noMicro, bad.noMicro]);
ok("итог: good ≤ total", a.good <= a.total && a.total >= 7);
console.log(`assess: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
