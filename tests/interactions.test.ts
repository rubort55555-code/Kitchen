// Проверка подсказок по сочетаниям и кофеина: node node_modules/.bin/tsx tests/interactions.test.ts
import { DRINKS, SOURCES, caffeineLimit, caffeineOf, interactionHints } from "../src/lib/interactions";
import { mealCustom, mealDrink } from "../src/lib/diary";
import type { Meal } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const D = "2026-11-09";
const food = (name: string, slot: Meal["slot"], n: Meal["n"]): Meal => ({ ...mealCustom(name, { kcal: n.kcal || 300 }, D, slot, "m1")!, n: { kcal: 300, ...n } });
const drink = (key: string, k = 1, slot: Meal["slot"] = "обед") => mealDrink(DRINKS.find((x) => x.key === key)!, k, D, slot, "m1")!;
const ids = (h: { id: string }[]) => h.map((x) => x.id.split(":")[0]);

// Напитки и кофеин
ok("кофе американо: 95 мг, 200 мл", drink("coffee").caffeine === 95 && drink("coffee").qty === "200 мл");
ok("2 порции — в два раза больше", drink("coffee", 2).caffeine === 190 && drink("coffee", 2).n.kcal === 4);
ok("0 порций — нет записи", mealDrink(DRINKS[0], 0, D, "обед") === null);
ok("сумма кофеина за день", caffeineOf([drink("coffee"), drink("blackTea"), food("Суп", "обед", {})]) === 95 + 47);
ok("предел кофеина: 400, при беременности и кормлении 200", caffeineLimit(false) === 400 && caffeineLimit(true) === 200);
ok("у каждого напитка есть кофеин, объём и калории", DRINKS.every((d) => d.caffeine > 0 && d.ml > 0 && d.kcal >= 0));

// Нет напитков и сочетаний — нет подсказок
ok("пустой день — без подсказок", interactionHints([]).length === 0);
ok("обычная еда без особенностей — без подсказок", interactionHints([food("Суп", "обед", { vitC: 30, fat: 10 })]).length === 0);

// Кофеин
const many = [drink("coffee", 2, "завтрак"), drink("coffee", 2, "обед")];
const h = interactionHints(many);
ok("380 мг кофеина — подсказка про магний и кальций, предела нет", ids(h).includes("caf-mineral") && !ids(h).includes("caf-limit"), ids(h));
ok("500 мг — выше предела 400", ids(interactionHints([drink("coffee", 5)])).includes("caf-limit"));
ok("250 мг при беременности (предел 200) — выше предела", ids(interactionHints([drink("coffee", 2.5)], { caffeineLimit: 200 })).includes("caf-limit"));
ok("250 мг у взрослого — предела нет", !ids(interactionHints([drink("coffee", 2.5)], { caffeineLimit: 400 })).includes("caf-limit"));
ok("больше 200 мг за раз — предупреждение", ids(interactionHints([drink("coffee", 3)])).includes("caf-single"));
ok("немного кофе — без подсказок про минералы", !ids(interactionHints([drink("coffee")])).includes("caf-mineral"));

// Источники: у каждой подсказки есть ссылки, и они описаны
const all = interactionHints([drink("coffee", 5, "обед")]);
ok("подсказки сработали всех видов", ["caf-limit", "caf-single", "caf-mineral"].every((x) => ids(all).includes(x)), ids(all));
ok("у каждой подсказки есть источники из списка", all.every((x) => x.src.length > 0 && x.src.every((s) => SOURCES[s] && SOURCES[s].cite.length > 20)));

console.log(`interactions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
