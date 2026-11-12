// Стресс/фазз логики: мусорные, огромные и «злые» входы для парсеров и расчётов.
// Запуск: npx tsx tests/stress/fuzz-logic.ts
import { parseReceipt, parseClaudeReceipt, findTotal, cleanName } from "../../src/lib/receipt";
import { parseAnswer, buildPrompt, jsonBlocks } from "../../src/lib/claude";
import { parseRecipeText, parseIngredientLine } from "../../src/lib/recipeText";
import { parseBackupText } from "../../src/lib/importOld";
import { findCatalog, suggest } from "../../src/lib/catalog";
import { fixWords } from "../../src/lib/ocrWords";
import { normCode, decodeGray } from "../../src/lib/barcode";
import { findTimes } from "../../src/lib/timers";
import { report, insights, priceTrends } from "../../src/lib/stats";
import { productsCsv, logCsv, pricesCsv } from "../../src/lib/csv";
import { addQty, qtyText } from "../../src/lib/units";
import { searchFoods, sumMeals, mealCustom, mealFromComposition } from "../../src/lib/diary";
import { scaleAmount, rub, num } from "../../src/lib/util";
import { defaultSettings } from "../../src/lib/store";
import type { LogEntry, Product } from "../../src/lib/types";
import { readFileSync } from "node:fs";

type R = { name: string; ok: boolean; ms: number; note?: string };
const out: R[] = [];
let seed = 12345;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const ALPH = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯabcxyz0123456789 .,:;-+*/=xх×()[]{}\"'\n\t₽%№@#$&!?😀🍕\u0000​";
const junk = (n: number) => { let s = ""; for (let i = 0; i < n; i++) s += ALPH[Math.floor(rnd() * ALPH.length)]; return s; };

function run(name: string, fn: () => unknown, limitMs = 2000) {
  const t0 = performance.now();
  try {
    const r = fn();
    const ms = performance.now() - t0;
    const slow = ms > limitMs;
    out.push({ name, ok: !slow, ms, note: slow ? `медленно: ${ms.toFixed(0)} мс (порог ${limitMs})` : typeof r === "string" ? r : undefined });
  } catch (e: any) {
    out.push({ name, ok: false, ms: performance.now() - t0, note: "исключение: " + (e?.stack || e).toString().split("\n").slice(0, 3).join(" | ") });
  }
}

// ---------- 1. Чеки ----------
const realReceipt = `ООО "Магнит"\nМолоко 3,2% 1л 2 x 89.90 179.80\nХлеб бородинский 1 x 55.00 =55.00\nСыр Российский 0.352 x 650.00 228.80\nИТОГО =463.60\nНДС 20% 77.27`;
run("чек: 1000 случайных строк мусора (по 200 символов)", () => { for (let i = 0; i < 1000; i++) parseReceipt(junk(200)); }, 5000);
run("чек: зашумлённое фото — 150 строк по 48 символов (порог 1 с)", () => { parseReceipt(Array.from({ length: 150 }, () => junk(48)).join("\n")); }, 1000);
run("чек: 5000-строчный чек (≈5000 позиций)", () => { const t = Array.from({ length: 5000 }, (_, i) => `Товар номер ${i} 1 x ${(i % 300) + 0.5} ${(i % 300) + 0.5}`).join("\n") + "\nИТОГО 1000"; const n = parseReceipt(t).length; return `позиций: ${n}`; }, 5000);
run("чек: одна строка 20 000 случайных символов", () => { parseReceipt(junk(20000)); }, 3000);
run("чек: 50 000 цифр подряд (регексп-бэктрекинг)", () => { parseReceipt("1".repeat(50000)); findTotal("ИТОГО " + "1 ".repeat(25000)); }, 3000);
run("чек: «1 x 1 x 1 x …» 10 000 раз", () => { parseReceipt("Молоко " + "1 x ".repeat(10000)); }, 3000);
run("чек: пустой/пробелы/нулевые символы", () => { parseReceipt(""); parseReceipt("   \n\n\t"); parseReceipt("\u0000\u0000"); });
run("чек: отрицательные и гигантские цены", () => { const r = parseReceipt("Молоко 1 x -50.00 -50.00\nСыр 1 x 99999999999999 99999999999999\nИТОГО -50"); const bad = r.filter((x: any) => !isFinite(x.price) || x.price < 0); return bad.length ? `ПРИНЯТЫ некорректные цены: ${JSON.stringify(bad.map((b: any) => b.price))}` : `позиций ${r.length}`; });
run("чек: нормальный чек разобран", () => { const r = parseReceipt(realReceipt); if (r.length < 3) throw new Error("разобрано позиций: " + r.length + " " + JSON.stringify(r)); return `позиций ${r.length}`; });
run("чек Claude: 500 мусорных ответов", () => { for (let i = 0; i < 500; i++) parseClaudeReceipt(junk(300)); });
run("чек Claude: JSON с неверными типами", () => { const variants = ['{"items":null}', '{"items":"x"}', '{"items":[null,1,"a",{"name":5,"price":"abc"}]}', '[]', 'null', '{"items":[{"name":"Молоко","price":1e309}]}', '```json\n{"items":[{"name":"","qty":-1}]}\n```']; const res = variants.map((v) => parseClaudeReceipt(v)); const inf = res.flatMap((r) => r.items).filter((x: any) => !isFinite(x.price) || x.qty < 0 || !x.name); return inf.length ? `ПРИНЯТЫ некорректные позиции: ${JSON.stringify(inf)}` : "ок"; });
run("чек Claude: глубоко вложенный JSON (10 000 уровней)", () => { parseClaudeReceipt("[".repeat(10000) + "]".repeat(10000)); }, 3000);
run("OCR-исправление слов: 2000 строк мусора", () => { for (let i = 0; i < 2000; i++) fixWords(junk(60)); }, 4000);
run("OCR-исправление: строка 20 000 символов", () => { fixWords(junk(20000)); }, 4000);
run("cleanName: мусор", () => { for (let i = 0; i < 2000; i++) cleanName(junk(80)); });

// ---------- 2. Ответ Claude с рецептами ----------
const sample = readFileSync(new URL("../sample_answer.txt", import.meta.url), "utf8");
run("ответ Claude: образец разбирается", () => { const r = parseAnswer(sample); if (!r.recipes.length) throw new Error("0 рецептов"); return `рецептов ${r.recipes.length}`; });
run("ответ Claude: 1000 мусорных текстов", () => { for (let i = 0; i < 1000; i++) parseAnswer(junk(300)); });
run("ответ Claude: образец ×200 (≈1 МБ)", () => { const r = parseAnswer(sample.repeat(200)); return `рецептов ${r.recipes.length}`; }, 5000);
run("ответ Claude: незакрытые ``` и {", () => { parseAnswer("```json\n{" + '"a":'.repeat(5000)); jsonBlocks("{".repeat(50000)); }, 3000);
run("ответ Claude: неверные типы полей", () => { const v = ['{"recipes":[{"name":null,"ingredients":"x","steps":5}]}', '{"recipes":"x"}', '[{"name":{"a":1}}]', '{"recipes":[{"name":"Суп","ingredients":[null,{"name":7,"amount":{}}],"steps":[null,1]}]}', '{"recipes":[{"name":"A","minutes":-5,"servings":1e9}]}']; const res = v.map(parseAnswer); return res.map((r) => r.recipes.length + (r.error ? "e" : "")).join(","); });
run("ответ Claude: __proto__ в JSON", () => { const r = parseAnswer('{"recipes":[{"name":"x","__proto__":{"polluted":1},"ingredients":[],"steps":[]}]}'); return ({} as any).polluted ? "ЗАГРЯЗНЕНИЕ прототипа" : `ок (${r.recipes.length})`; });

// ---------- 3. Текст рецепта ----------
run("текст рецепта: 1000 мусорных", () => { for (let i = 0; i < 1000; i++) parseRecipeText(junk(400)); });
run("текст рецепта: 10 000 ингредиентов", () => { const t = "Суп\nИнгредиенты:\n" + Array.from({ length: 10000 }, (_, i) => `- Морковь ${i} г`).join("\n") + "\nПриготовление:\n1. Варить"; const d = parseRecipeText(t); return `ингредиентов ${d.ingredients?.length}`; }, 6000);
run("строка ингредиента: 5000 случайных", () => { for (let i = 0; i < 5000; i++) parseIngredientLine(junk(50)); });
run("таймеры в шаге: мусор и длинный текст", () => { for (let i = 0; i < 2000; i++) findTimes(junk(100)); findTimes("варить 5 минут ".repeat(5000)); }, 3000);
run("таймеры: «99999999 часов»", () => { const t = findTimes("варить 99999999 часов"); return JSON.stringify(t); });

// ---------- 4. Справочник и поиск ----------
run("справочник: 3000 поисков мусора", () => { for (let i = 0; i < 3000; i++) findCatalog(junk(20)); }, 4000);
run("подсказки: 3000 запросов", () => { for (let i = 0; i < 3000; i++) suggest(junk(1 + Math.floor(rnd() * 6)), [], []); return `${(0).toFixed(0)}`; }, 30000);
run("подсказки: запрос 100 000 символов", () => { suggest("а".repeat(100000), [], []); findCatalog("б".repeat(100000)); }, 3000);
run("поиск еды в дневнике: 2000 запросов", () => { for (let i = 0; i < 2000; i++) searchFoods(junk(1 + Math.floor(rnd() * 5))); }, 4000);
run("поиск: регексп-спецсимволы", () => { for (const q of ["(", "[", "*", "+?", "\\", ".*.*.*.*.*", "(a+)+$"]) { suggest(q, [], []); findCatalog(q); searchFoods(q); } });

// ---------- 5. Копия данных ----------
run("копия: 1000 мусорных файлов", () => { for (let i = 0; i < 1000; i++) parseBackupText(junk(200), defaultSettings()); });
run("копия: валидный JSON без полей", () => { const v = ['{"app":"kitchen-app"}', '{"app":"kitchen-app","products":{}}', '{"app":"kitchen-app","products":[null,1,"x"],"log":"x","recipes":5,"settings":"x"}', '{"app":"chto-prigotovit","state":{"items":[null,{"name":5},{"name":"Молоко","amount":"x","unit":"бочка"}],"log":[1,null]}}']; return v.map((x) => { const r = parseBackupText(x, defaultSettings()); return r ? r.kind : "null"; }).join(","); });
run("копия: принимает products с null-элементами (риск падения при восстановлении)", () => { const r: any = parseBackupText('{"app":"kitchen-app","products":[null,{"id":1}],"settings":{"members":"x"}}', defaultSettings()); return r ? `ПРИНЯТА копия с битыми продуктами/настройками (products[0]=null, members="x") — проверки содержимого нет` : "отклонена"; });

// ---------- 6. Статистика и CSV на большом объёме ----------
const now = Date.now();
const names = ["Молоко", "Хлеб", "Сыр", "Курица", "Яйца", "Гречка", "Помидоры", 'Сок "Добрый", 1л', "=HYPERLINK(\"x\")"];
const reasons = ["bought", "eaten", "cooked", "spoiled", "thrown", "adjust"] as const;
const bigLog: LogEntry[] = Array.from({ length: 200000 }, (_, i) => ({ id: "l" + i, t: now - Math.floor(rnd() * 365 * 86400000), name: pick(names), reason: pick(reasons as any), qty: 1 + Math.floor(rnd() * 5), unit: "шт", rub: Math.round(rnd() * 500) }));
const bigProducts: Product[] = Array.from({ length: 20000 }, (_, i) => ({ id: "p" + i, name: pick(names) + " " + i, qty: 1, initialQty: 1, unit: "шт", place: "Холодильник", bought: "2026-11-01", until: "2026-11-20", price: 100, createdAt: now }));
run("статистика: отчёт по 200 000 записей", () => { const r = report(bigLog, bigProducts, now - 365 * 86400000); insights(bigLog, r, 365); }, 3000);
run("статистика: тренды цен по 200 000 записей", () => { priceTrends(bigLog); }, 3000);
run("CSV: 200 000 записей журнала + 20 000 продуктов", () => { const s = logCsv(bigLog) + productsCsv(bigProducts) + pricesCsv(bigLog); return `${(s.length / 1e6).toFixed(1)} млн символов`; }, 5000);
run("CSV: экранирование кавычек/формул", () => { const s = productsCsv([{ ...bigProducts[0], name: '=HYPERLINK("http://evil")' }, { ...bigProducts[0], name: 'Сок "Добрый", 1л' }]); const inj = /(^|[;,\n])=HYPERLINK/.test(s); return inj ? "ФОРМУЛА не экранирована (CSV-инъекция при открытии в Excel)" : "ок"; });

// ---------- 7. Числа ----------
run("единицы: NaN/Infinity/огромные", () => { const r = [addQty(NaN, "г", 1, "кг"), addQty(Infinity, "л", 1, "мл"), qtyText(NaN, "г"), qtyText(1e21, "кг"), qtyText(-5, "шт")]; return JSON.stringify(r); });
run("rub/num: NaN/Infinity", () => JSON.stringify([rub(NaN), rub(Infinity), rub(-0.004), num(NaN), num(1e21)]));
run("масштаб порций: странные строки", () => { const r = ["", "щепотка", "1/0 ст", "1e309 г", "-3 шт", "½ стакана", "2-3 шт"].map((a) => scaleAmount(a, 2.5)); return JSON.stringify(r); });
run("дневник: своё блюдо с NaN/отрицательными", () => { const a = mealCustom("x", { kcal: NaN }, "2026-11-12", "breakfast" as any); const b = mealCustom("y", { kcal: -500, protein: -10 }, "2026-11-12", "breakfast" as any); const c = mealFromComposition("Молоко", -100, "2026-11-12", "breakfast" as any); const d = mealFromComposition("Молоко", 1e9, "2026-11-12", "breakfast" as any); const s = sumMeals([a, b, c, d].filter(Boolean) as any); return `NaN→${a ? "ПРИНЯТО" : "отказ"}, отриц. ккал→${b ? "ПРИНЯТО(" + b.n?.kcal + ")" : "отказ"}, −100 г→${c ? "ПРИНЯТО(" + c.n?.kcal + ")" : "отказ"}, 1e9 г→${d ? "ПРИНЯТО(" + Math.round(d.n?.kcal || 0) + " ккал)" : "отказ"}; сумма ккал=${s.kcal}`; });

// ---------- 8. Штрихкоды ----------
run("штрихкод: 10 000 случайных строк", () => { for (let i = 0; i < 10000; i++) normCode(junk(14)); });
run("штрихкод: шумовое изображение 1280×720 ×5", () => { for (let k = 0; k < 5; k++) { const g = new Uint8Array(1280 * 720); for (let i = 0; i < g.length; i++) g[i] = rnd() * 255; decodeGray(g, 1280, 720); } }, 5000);
run("штрихкод: пустое изображение 0×0 и 1×1", () => { decodeGray(new Uint8Array(0), 0, 0); decodeGray(new Uint8Array(1), 1, 1); });

// ---------- 9. Запрос к Claude на огромных данных ----------
run("запрос Claude: 20 000 продуктов", () => { const s = buildPrompt({ who: [], minutes: null, kind: "любое", count: 3, wish: "", useFirst: [] }, bigProducts, defaultSettings().members, defaultSettings().rules, [], []); return `длина запроса ${s.length} символов (URL claude.ai/new?q= ${s.length > 8000 ? "СЛИШКОМ ДЛИННЫЙ — браузер/сервер может обрезать" : "в норме"})`; }, 4000);

console.log(JSON.stringify(out, null, 1));
const bad = out.filter((r) => !r.ok);
console.error(`\nИтого: ${out.length - bad.length} из ${out.length} без сбоев`);
