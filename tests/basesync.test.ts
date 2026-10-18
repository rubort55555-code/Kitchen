// Проверка обновления встроенных рецептов: node node_modules/.bin/tsx tests/basesync.test.ts
import { mergeBase, recipeSig } from "../src/lib/baseSync";
import { setCatalog, findCatalog, CATALOG } from "../src/lib/catalog";
import type { Recipe } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const R = (id: string, steps: string[], o: Partial<Recipe> = {}): Recipe =>
  ({ id, name: "Рецепт " + id, kind: "суп", servings: 2, ingredients: [{ name: "Вода", amount: "1 л" }], steps, source: "base", createdAt: 0, ...o });

// Первая загрузка: всё добавляется, подписи запоминаются
{
  const seen = new Set<string>(), sigs: Record<string, string> = {};
  const r = mergeBase([R("a", ["1"]), R("b", ["1"])], new Map(), seen, sigs);
  ok("первая загрузка: добавлены оба", r.add.length === 2 && r.update.length === 0);
  ok("первая загрузка: подписи запомнены", sigs.a === recipeSig(R("a", ["1"])) && !!sigs.b);
}

// Рецепт исправили в базе: у того, кто его не менял, обновляется; личное (избранное, фото, оценка) сохраняется
{
  const mine = { ...R("a", ["1"]), fav: true, rating: 5, photo: "data:x", history: ["2026-10-01"] };
  const sigs = { a: recipeSig(R("a", ["1"])) };
  const r = mergeBase([R("a", ["1", "2"], { minutes: 20 })], new Map([["a", mine]]), new Set(["a"]), sigs);
  const u = r.update[0];
  ok("исправление в базе дошло", r.update.length === 1 && u.steps.length === 2 && u.minutes === 20, r);
  ok("личное сохранилось", u.fav === true && u.rating === 5 && u.photo === "data:x" && u.history?.length === 1, u);
  ok("подпись обновилась", sigs.a === recipeSig(R("a", ["1", "2"], { minutes: 20 })));
}

// Человек сам поправил рецепт — его версия остаётся, даже если базу потом исправили
{
  const mine = R("a", ["моя версия"]);
  const sigs = { a: recipeSig(R("a", ["1"])) };
  const r = mergeBase([R("a", ["1", "2"])], new Map([["a", mine]]), new Set(["a"]), sigs);
  ok("правка человека не затирается", r.update.length === 0 && r.add.length === 0);
  ok("подпись прежняя — и в следующий раз не затрётся", sigs.a === recipeSig(R("a", ["1"])));
}

// Поле убрали из базы (было время — не стало) — убирается и у человека
{
  const mine = R("a", ["1"], { minutes: 15 });
  const sigs = { a: recipeSig(mine) };
  const r = mergeBase([R("a", ["1"])], new Map([["a", mine]]), new Set(["a"]), sigs);
  ok("убранное поле убрано", r.update.length === 1 && !("minutes" in r.update[0]), r.update[0]);
}

// Удалённый рецепт не возвращается; свой рецепт с тем же id не трогаем
{
  const r1 = mergeBase([R("a", ["1"])], new Map(), new Set(["a"]), {});
  ok("удалённый не возвращается", r1.add.length === 0);
  const own = R("a", ["своё"], { source: "manual" });
  const r2 = mergeBase([R("a", ["1"])], new Map([["a", own]]), new Set(["a"]), { a: recipeSig(own) });
  ok("свой рецепт не трогаем", r2.update.length === 0);
}

// Старые телефоны без подписей: совпадающий рецепт получает подпись, отличающийся — не трогаем (не знаем, кто менял)
{
  const sigs: Record<string, string> = {};
  const r = mergeBase([R("a", ["1"]), R("b", ["новое"])], new Map([["a", R("a", ["1"])], ["b", R("b", ["старое"])]]), new Set(["a", "b"]), sigs);
  ok("без подписей: ничего не затёрто", r.update.length === 0 && r.add.length === 0);
  ok("без подписей: совпавший запомнен", !!sigs.a && !sigs.b);
}

// Порядок полей в сохранённом рецепте не важен
ok("порядок полей не важен", recipeSig(R("a", ["1"])) === recipeSig({ steps: ["1"], ...R("a", ["1"]) }));

// Справочник с сайта заменяет встроенный, поиск работает по новому
{
  const before = CATALOG.length;
  ok("до замены «Тестовый продукт» не найден", findCatalog("тестик")?.n !== "Тестовый продукт");
  setCatalog([...CATALOG, { n: "Тестовый продукт", c: "Готовое", e: "🍲", u: "г", p: "Холодильник", d: [3, null, null], s: ["тестик"] }]);
  ok("после замены найден по названию и синониму", findCatalog("тестовый продукт")?.n === "Тестовый продукт" && findCatalog("тестик")?.n === "Тестовый продукт");
  ok("справочник вырос на 1", CATALOG.length === before + 1);
  setCatalog([]);
  ok("пустой справочник не принимаем", CATALOG.length === before + 1);
}

console.log(`basesync: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
