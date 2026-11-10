// Проверка подсказки про витамин B12: node node_modules/.bin/tsx tests/vitamins.test.ts
import { b12Day, vitaminHints } from "../src/lib/vitamins";
import { SOURCES } from "../src/lib/interactions";
import { mealCustom } from "../src/lib/diary";
import type { Meal, Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };
const D = "2026-11-09";
const ctx = { recipes: [] as Recipe[] };
// запись с данными о микроэлементах (иначе подсказка не строится)
const meal = (name: string, slot: Meal["slot"], b12: number): Meal => ({ ...mealCustom(name, { kcal: 300 }, D, slot, "m1")!, qty: "200 г", n: { kcal: 300, vitC: 5, vitB12: b12 } });

const veg = [meal("Гречка с овощами", "обед", 0), meal("Салат из огурцов", "ужин", 0)];
ok("день без животных продуктов и без B12 — подсказка", vitaminHints(veg, ctx).some((h) => h.id === "b12-plant"));
ok("у подсказки есть источники", vitaminHints(veg, ctx)[0].src.every((id) => id in SOURCES));
ok("одна запись — мало данных", b12Day([veg[0]], ctx) === null);
ok("есть рыба — подсказки нет", b12Day([meal("Лосось с рисом", "обед", 0), veg[1]], ctx) === null);
ok("печенье — не печень", b12Day([meal("Печенье овсяное", "обед", 0), veg[1]], ctx) !== null);
ok("B12 набрано — подсказки нет", b12Day([meal("Гречка", "обед", 1.5), veg[1]], ctx) === null);
const nodata = { ...mealCustom("Моё блюдо", { kcal: 300 }, D, "обед", "m1")!, qty: "200 г" };
ok("запись без данных о витаминах — не судим", b12Day([nodata, veg[1]], ctx) === null);
// Натрий и калий
import { naKDay } from "../src/lib/vitamins";
const nk = (name: string, slot: Meal["slot"], na: number, k: number): Meal => ({ ...mealCustom(name, { kcal: 300 }, D, slot, "m1")!, qty: "200 г", n: { kcal: 300, vitC: 5, na, k } });
const saltyDay = [nk("Суп", "обед", 1500, 800), nk("Бутерброды", "ужин", 1000, 600)];
ok("натрия много, калия мало — подсказка", vitaminHints(saltyDay, ctx).some((h) => h.id === "na-k"));
ok("источники подсказки есть в SOURCES", vitaminHints(saltyDay, ctx).filter((h) => h.id === "na-k")[0].src.every((id) => id in SOURCES));
ok("калия достаточно — подсказки нет", naKDay([nk("Суп", "обед", 1500, 2000), nk("Картофель", "ужин", 1000, 2000)]) === null);
ok("натрия немного — подсказки нет", naKDay([nk("Каша", "обед", 300, 500), nk("Яблоко", "ужин", 10, 200)]) === null);
ok("до 17 часов день не оценивается", vitaminHints(saltyDay, ctx, 12).length === 0);
ok("запись без данных о минералах — не судим", naKDay([nodata, nk("Суп", "ужин", 3000, 500)]) === null);
console.log(`vitamins: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
