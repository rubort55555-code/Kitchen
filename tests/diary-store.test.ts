// Проверка действий дневника в хранилище (без браузера, запись в IndexedDB отключена): node node_modules/.bin/tsx tests/diary-store.test.ts
console.error = () => {}; // в Node нет IndexedDB — ошибки сохранения ожидаемы, в памяти всё работает
import { addMeals, addWater, deleteMeals, diaryWho, rememberBarcode, getState, makeBackup, repeatDay, saveRecipes, setDiaryWho, setSettings, syncPlanMeal, updateMeal, waterOf } from "../src/lib/store";
import { toggleDone } from "../src/lib/plan";
import { mealCustom, mealFromRecipe } from "../src/lib/diary";
import { parseRecipeText } from "../tools/recipes.mjs";
import { readFileSync } from "node:fs";
import type { Recipe } from "../src/lib/types";
import { addDays, ymd } from "../src/lib/util";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const recipes = parseRecipeText(readFileSync("recipes/01-zavtraki.txt", "utf8"), "01-zavtraki.txt").recipes as Recipe[];
const omelet = recipes.find((r) => r.name === "Омлет классический")!;
saveRecipes([omelet]);
const today = ymd(), yesterday = addDays(today, -1);

// Чей дневник
ok("дневник: по умолчанию первый член семьи", diaryWho() === "m1");
setDiaryWho("m2");
ok("дневник: выбранный человек", diaryWho() === "m2");
setDiaryWho("нет-такого");
ok("дневник: несуществующий id → первый", diaryWho() === "m1");
setDiaryWho("m1");

// Добавление, правка, удаление
const a = mealCustom("Бутерброд", { kcal: 300, protein: 10 }, today, "завтрак", "m1")!;
const b = mealCustom("Суп", { kcal: 250 }, yesterday, "обед", "m1")!;
addMeals([a, b]);
ok("добавлено 2 записи", getState().meals.length === 2);
updateMeal(a.id, { name: "Бутерброд с сыром" });
ok("правка записи", getState().meals.find((m) => m.id === a.id)!.name === "Бутерброд с сыром");
deleteMeals([b.id]);
ok("удаление", getState().meals.length === 1 && !getState().meals.some((m) => m.id === b.id));
addMeals([b]);
ok("возврат удалённой (отмена)", getState().meals.length === 2);

// Повторить вчера
const copies = repeatDay(yesterday, today, "m1");
ok("повторить вчера: скопирована 1 запись на сегодня", copies.length === 1 && copies[0].date === today && copies[0].name === "Суп" && getState().meals.length === 3);
ok("повторить вчера: записи другого человека не копируются", repeatDay(yesterday, today, "m2").length === 0 && getState().meals.length === 3);

// Вода
addWater(today, 250); addWater(today, 250);
ok("вода: 2 стакана = 500 мл", waterOf(today) === 500);
addWater(today, -250);
ok("вода: минус стакан", waterOf(today) === 250);
addWater(today, -1000);
ok("вода: не уходит в минус, пустой день не хранится", waterOf(today) === 0 && getState().settings.water?.["m1|" + today] === undefined);

setDiaryWho("m2");
ok("вода: у каждого человека своя", waterOf(today) === 0);
addWater(today, 250);
setDiaryWho("m1");
ok("вода: стакан Миши не попал Ане", waterOf(today) === 0 && waterOf(today, getState().settings, "m2") === 250);

// Запомненные штрихкоды
rememberBarcode("4600000000017", "Творог 5%", { code: "4600000000017", title: "Творог 5%", per100: { kcal: 121, p: 17, f: 5, c: 1.8 } });
const mem = getState().settings.barcodes?.["4600000000017"];
ok("штрихкод запомнен вместе с данными этикетки", mem?.name === "Творог 5%" && mem.off?.per100?.kcal === 121 && mem.t > 0);
rememberBarcode("4600000000024", "Хлеб", null);
ok("запоминание второго кода не стирает первый", !!getState().settings.barcodes?.["4600000000017"] && !!getState().settings.barcodes?.["4600000000024"]);

// Меню ↔ дневник
const e = { id: "pe1", date: today, slot: "завтрак" as const, name: omelet.name, recipeId: omelet.id };
setSettings({ plan: [e] });
const before = getState().meals.length;
toggleDone("pe1");
const synced = getState().meals.filter((m) => m.planEntryId === "pe1");
ok("отметка «приготовили» создаёт запись дневника", synced.length === 1 && synced[0].recipeId === omelet.id && synced[0].slot === "завтрак" && synced[0].date === today && (synced[0].n.kcal || 0) > 50, synced);
ok("запись создана ровно одна", getState().meals.length === before + 1);
syncPlanMeal({ ...e, done: true }, true);
ok("повторная отметка не дублирует запись", getState().meals.filter((m) => m.planEntryId === "pe1").length === 1);
toggleDone("pe1");
ok("снятие отметки убирает запись", getState().meals.filter((m) => m.planEntryId === "pe1").length === 0 && getState().meals.length === before);
setSettings({ plan: [{ id: "pe2", date: today, slot: "обед", name: "Что-то своё" }] });
toggleDone("pe2");
ok("блюдо без рецепта в дневник не пишется", getState().meals.every((m) => m.planEntryId !== "pe2"));

// Копия данных
const bk = makeBackup();
ok("копия данных включает дневник", Array.isArray(bk.meals) && bk.meals.length === getState().meals.length);

// Журнал замеров
import { addMeasure, deleteMeasure, measuresOf } from "../src/lib/store";
setSettings({ members: [{ id: "m1", name: "Аня", allergies: [], dislikes: [], body: { sex: "f", born: 1991, height: 165, weight: 62, goal: "keep" } }] });
addMeasure("m1", { date: "2026-11-01", weight: 61, waist: 74 });
ok("замер: записан", measuresOf("m1").length === 1);
ok("замер: свежий обновляет вес и талию в профиле", getState().settings.members[0].body!.weight === 61 && getState().settings.members[0].body!.waist === 74);
addMeasure("m1", { date: "2026-10-01", weight: 65 });
ok("замер: старый по дате профиль не трогает", getState().settings.members[0].body!.weight === 61 && measuresOf("m1")[0].date === "2026-10-01");
deleteMeasure("m1", "2026-10-01");
ok("замер: удаление", measuresOf("m1").length === 1);
ok("замер: у другого человека пусто и это один и тот же массив", measuresOf("m2") === measuresOf("m3"));

// Гарнир идёт в дневник вместе с блюдом
{
  const gr = parseRecipeText(readFileSync("recipes/06-garniry.txt", "utf8"), "06-garniry.txt").recipes as Recipe[];
  saveRecipes(gr);
  const rice = gr.find((r) => r.name === "Рис отварной рассыпчатый")!;
  const e = { id: "pe-g1", date: today, slot: "ужин" as const, name: omelet.name, recipeId: omelet.id, garnish: { id: rice.id, name: rice.name }, portions: { m1: 1.5 } };
  setSettings({ plan: [e] });
  syncPlanMeal(e, true);
  const mine = getState().meals.filter((m) => m.planEntryId === "pe-g1");
  ok("гарнир: в дневник попали блюдо и гарнир", mine.length === 2 && mine.some((m) => m.name === rice.name), mine.map((m) => m.name));
  ok("гарнир: порция та же, что у блюда (1,5)", mine.every((m) => m.servings === 1.5));
  syncPlanMeal(e, false);
  ok("гарнир: отмена убирает обе записи", getState().meals.filter((m) => m.planEntryId === "pe-g1").length === 0);
}

// Согласия
import { askConsent, resolveConsent } from "../src/lib/consent";
import { giveConsent, withdrawConsent, eraseHealthData } from "../src/lib/store";
import { getUI } from "../src/lib/ui";
{
  const pr = askConsent("off");
  ok("согласие: без записи открывается окно", getUI().sheets.some((x) => x.kind === "consent"));
  resolveConsent("off", false);
  ok("согласие: отказ → false", (await pr) === false);
  giveConsent("off");
  ok("согласие: дано → askConsent сразу true", (await askConsent("off")) === true);
  withdrawConsent("off");
  ok("согласие: отозвано", !getState().settings.consent?.off);
  addMeasure("m1", { date: "2026-11-02", weight: 60 });
  eraseHealthData();
  ok("удаление данных о здоровье: профиль и замеры стёрты", !getState().settings.members[0].body && !getState().settings.measures);
}

console.log(`diary-store: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
