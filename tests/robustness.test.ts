// Устойчивость к битым данным и скорость подсказок (по итогам стресс-теста): npx tsx tests/robustness.test.ts
import { cleanSettings, cleanProducts, cleanLog, cleanRecipes, cleanMeals } from "../src/lib/sanitize";
import { parseBackupText } from "../src/lib/importOld";
import { parseAnswer } from "../src/lib/claude";
import { defaultSettings, getState } from "../src/lib/store";
import { hintsFor } from "../src/lib/shop";
import { fixWords } from "../src/lib/ocrWords";
import { parseReceipt } from "../src/lib/receipt";
import { mealFromComposition, mealCustom } from "../src/lib/diary";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

// Настройки неверного вида заменяются обычными
const base = defaultSettings();
const s = cleanSettings({ members: "сломано", rules: 5, plan: "x", shop: null, tipsSeen: [1, "a"], lastBackup: "вчера", lastBuy: [], water: 5, planSlots: ["полдник"] }, base);
ok("members не списком → по умолчанию", Array.isArray(s.members) && s.members.length === 2);
ok("rules не списком → пусто", Array.isArray(s.rules));
ok("plan/shop не списком → пусто", Array.isArray(s.plan) && Array.isArray(s.shop));
ok("tipsSeen — только строки", s.tipsSeen.length === 1 && s.tipsSeen[0] === "a");
ok("lastBackup не число → по умолчанию", s.lastBackup === 0);
ok("lastBuy не объект → по умолчанию", !Array.isArray(s.lastBuy) && typeof s.lastBuy === "object");
ok("water не объект → убрано", s.water === undefined);
ok("неизвестный приём пищи → по умолчанию", s.planSlots.join() === base.planSlots.join());
ok("битые участники отбрасываются", cleanSettings({ members: [null, { id: "x" }, { id: "a", name: "Аня", allergies: "орехи" }] }, base).members.map((m) => m.name + m.allergies.length).join() === "Аня0");
ok("__proto__ не переносится", (cleanSettings(JSON.parse('{"__proto__":{"polluted":1}}'), base) as any).polluted === undefined && ({} as any).polluted === undefined);
const good = cleanSettings({ ...base, shop: [{ id: "1", name: "Молоко", amount: "1 л", done: false, createdAt: 1 }] }, base);
ok("правильные настройки не меняются", good.shop.length === 1 && good.rules.length === base.rules.length && good.members.length === 2);

// Записи
ok("продукты: null и без id отбрасываются", cleanProducts([null, { id: 1 }, { id: "a", name: "Сыр", qty: 1, unit: "г", place: "Шкаф", price: 10, bought: "2026-11-01", until: null, initialQty: 1, createdAt: 1 }]).length === 1);
ok("продукты: бесконечное количество отбрасывается", cleanProducts([{ id: "a", name: "Сыр", qty: Infinity }]).length === 0);
ok("продукты: неизвестная единица → шт", cleanProducts([{ id: "a", name: "Сыр", qty: 1, unit: "бочка" }])[0].unit === "шт");
ok("журнал: неизвестная причина отбрасывается", cleanLog([{ id: "a", t: 1, name: "x", reason: "съели" }, null]).length === 0);
ok("рецепты: ингредиенты не списком → пусто", cleanRecipes([{ id: "r", name: "Суп", ingredients: "много", steps: [1, "Варить"] }])[0].ingredients.length === 0);
ok("рецепты: шаги — только строки", cleanRecipes([{ id: "r", name: "Суп", steps: [1, "Варить"] }])[0].steps.join() === "Варить");
ok("дневник: нечисловые нутриенты убраны", Object.keys(cleanMeals([{ id: "m", date: "2026-11-01", name: "x", n: { kcal: "много", protein: 5 } }])[0].n).join() === "protein");

// Копия
const p = parseBackupText(JSON.stringify({ app: "kitchen-app", products: [null, { id: 1 }], log: [null], recipes: [null], settings: { members: "сломано", rules: 5 } }), base);
ok("битая копия читается и чинится", !!p && p.backup.products.length === 0 && p.backup.log.length === 0 && Array.isArray(p.backup.settings.members) && Array.isArray(p.backup.settings.rules));

// Ответ Claude неверного формата
for (const t of ['{"recipes":"x"}', '{"dishes":5}', '{"ideas":{"a":1}}']) {
  let r: ReturnType<typeof parseAnswer> | null = null;
  try { r = parseAnswer(t); } catch { /* ошибка — провал */ }
  ok(`ответ ${t}: без исключения и с подсказкой`, !!r && r.recipes.length === 0 && !!r.error);
}

// Подсказки к покупкам: журнал считается один раз, а не на каждую строку
const st: any = getState();
const names = ["Молоко", "Хлеб", "Яйца", "Сыр твёрдый", "Курица"];
st.log = Array.from({ length: 20000 }, (_, i) => ({ id: "l" + i, t: i, name: names[i % 5], reason: i % 7 ? "bought" : "spoiled", qty: 1, unit: "шт", rub: 10 }));
st.products = Array.from({ length: 1000 }, (_, i) => ({ id: "p" + i, name: names[i % 5], qty: 1, initialQty: 1, unit: "шт", place: "Холодильник", bought: "2026-11-01", until: null, price: 1, createdAt: 0 }));
hintsFor("Молоко");
let t = performance.now();
for (let k = 0; k < 60; k++) hintsFor(names[k % 5]);
const ms = performance.now() - t;
ok(`60 строк покупок при журнале 20 000 и 1000 продуктах — быстро (${ms.toFixed(0)} мс)`, ms < 150, ms);
const h = hintsFor("Молоко");
ok("подсказка: доля пропавшего считается", h.loss !== null && h.loss > 0.1 && h.loss < 0.2, h);
ok("подсказка: дома есть", !!h.have && h.have.includes("+"));

// Исправление слов осталось прежним, но быстрее
ok("ЗРЛИВНОЙ → ЗАЛИВНОЙ", fixWords("ЗРЛИВНОЙ ЦОБРЫЙ") === "ЗАЛИВНОЙ ДОБРЫЙ", fixWords("ЗРЛИВНОЙ ЦОБРЫЙ"));
let seed = 3; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const A = "абвгдежзиклмнопрстуфхцчшщыэюяАБВГДЕЖЗИКЛМНОПРСТУ0123456789 .,:-x";
const noisy = Array.from({ length: 150 }, () => { let x = ""; for (let i = 0; i < 48; i++) x += A[Math.floor(rnd() * A.length)]; return x; }).join("\n");
t = performance.now(); parseReceipt(noisy); const rms = performance.now() - t;
ok(`зашумлённый чек 150 строк разбирается быстро (${rms.toFixed(0)} мс)`, rms < 700, rms);

// Пределы в дневнике
ok("дневник: больше 5 кг за запись не принимается", mealFromComposition("Молоко", 1e9, "2026-11-12", "обед") === null);
ok("дневник: 200 г принимается", mealFromComposition("Молоко", 200, "2026-11-12", "обед") !== null);
ok("дневник: своё блюдо 100 000 ккал не принимается", mealCustom("x", { kcal: 100000 }, "2026-11-12", "обед") === null);

console.log(`robustness: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
