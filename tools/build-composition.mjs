// Таблица состава продуктов для расчёта пищевой ценности рецептов.
// Источники: Fineli Release 18 (THL, Финляндия, CC BY 4.0; выписка — tools/fineli-values.json, см. tools/fineli-extract.mjs)
// и USDA National Nutrient Database for Standard Reference, Release 28 (пакет fda-nutrient-database, общественное достояние) —
// для продуктов и показателей, которых нет в Fineli.
// Сопоставление «наш ингредиент → продукт USDA» и вес бытовых мер — tools/nutrition-map.jsonl (правится руками);
// override — значения российского продукта (ГОСТ, маркировка) поверх аналога USDA, source — откуда они.
// Запуск: node tools/build-composition.mjs  → src/lib/compositionData.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Поля сокращённого файла SR28 (ABBREV.txt), по порядку
const F = "id desc water kcal prot fat ash carb fib sug ca fe mg p k na zn cu mn se vitc b1 b2 b3 b5 b6 folate folic foodfol b9dfe choline b12 vitaiu vita retinol acar bcar bcrypt lyco lutzea vite vitd vitdiu vitk satfat mufa pufa chol gw1 gd1 gw2 gd2 refuse".split(" ");
// Порядок — как NUTRIENTS в src/lib/recipeNutrition.ts
const OUT = ["kcal", "prot", "fat", "carb", "fib", "sug", "satfat", "vitc", "b1", "b2", "b3", "b5", "b6", "b9dfe", "b12", "vita", "vite", "vitd", "vitk", "ca", "fe", "mg", "p", "k", "na", "zn", "cu", "mn", "se", "chol", "iod"];
// Те же показатели в Fineli (единицы совпадают: г, мг, мкг; энергия в кДж). Пантотеновой кислоты в Fineli нет — берём USDA.
const FINELI = { kcal: "ENERC", prot: "PROT", fat: "FAT", carb: "CHOAVL", fib: "FIBC", sug: "SUGAR", satfat: "FASAT", vitc: "VITC", b1: "THIA", b2: "RIBF", b3: "NIA", b6: "VITPYRID", b9dfe: "FOL", b12: "VITB12", vita: "VITA", vite: "VITE", vitd: "VITD", vitk: "VITK", ca: "CA", fe: "FE", mg: "MG", p: "P", k: "K", na: "NA", zn: "ZN", cu: "CU", mn: "MN", se: "SE", chol: "CHOLE", iod: "ID" };
const fineli = existsSync("tools/fineli-values.json") ? JSON.parse(readFileSync("tools/fineli-values.json", "utf8")).foods : {};

const sr = new Map();
for (const line of readFileSync("node_modules/fda-nutrient-database/data/ABBREV.txt", "latin1").split(/\r?\n/)) {
  const parts = line.split("^");
  if (parts.length !== F.length) continue;
  const r = {};
  F.forEach((k, i) => { const v = parts[i].replace(/~/g, ""); r[k] = v === "" ? null : isNaN(Number(v)) ? v : Number(v); });
  sr.set(parts[0].replace(/~/g, ""), r);
}

const items = [], errors = [];
for (const [k, line] of readFileSync("tools/nutrition-map.jsonl", "utf8").split("\n").entries()) {
  if (!line.trim()) continue;
  const m = JSON.parse(line);
  const r = sr.get(m.ndb);
  if (!r) { errors.push(`строка ${k + 1}: ${m.name} — нет продукта ${m.ndb} в SR28`); continue; }
  if (r.b9dfe === null) r.b9dfe = r.folate;
  // Углеводы — как в российских справочниках и на этикетках: усвояемые, без пищевых волокон
  // (в USDA «carbohydrate by difference» включает клетчатку).
  r.carb = Math.max(0, (r.carb || 0) - (r.fib || 0));
  // Fineli точнее для северных и российских продуктов и есть йод: его значения поверх USDA, чего нет — остаётся USDA
  const f = m.fineli ? fineli[String(m.fineli)] : null;
  if (m.fineli && !f) { errors.push(`${m.name}: нет продукта Fineli ${m.fineli} в tools/fineli-values.json`); continue; }
  if (f) for (const [k, code] of Object.entries(FINELI)) if (typeof f.v[code] === "number") r[k] = k === "kcal" ? Math.round((f.v[code] / 4.184) * 10) / 10 : f.v[code];
  // Российские продукты, у которых американский аналог заметно отличается: Б/Ж/У/ккал (и натрий) по ГОСТ и маркировке
  if (m.override) for (const [k, v] of Object.entries(m.override)) r[k] = v;
  const v = OUT.map((f) => (typeof r[f] === "number" ? Math.round(r[f] * 1000) / 1000 : null));
  const it = { n: m.name, id: f ? "fineli:" + m.fineli : m.ndb, u: m.units || {}, v };
  if (typeof m.density === "number") it.d = m.density;
  if (typeof m.edible === "number" && m.edible < 1) it.y = m.edible;
  items.push(it);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
items.sort((a, b) => a.n.localeCompare(b.n, "ru"));
writeFileSync("src/lib/compositionData.json", JSON.stringify({ source: "Fineli Release 18 (THL, CC BY 4.0); USDA SR28", items }));
console.log(`Продуктов в таблице состава: ${items.length}`);
