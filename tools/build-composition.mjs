// Таблица состава продуктов для расчёта пищевой ценности рецептов.
// Источник: USDA National Nutrient Database for Standard Reference, Release 28 (пакет fda-nutrient-database, общественное достояние).
// Сопоставление «наш ингредиент → продукт USDA» и вес бытовых мер — tools/nutrition-map.jsonl (правится руками).
// Запуск: node tools/build-composition.mjs  → src/lib/compositionData.json
import { readFileSync, writeFileSync } from "node:fs";

// Поля сокращённого файла SR28 (ABBREV.txt), по порядку
const F = "id desc water kcal prot fat ash carb fib sug ca fe mg p k na zn cu mn se vitc b1 b2 b3 b5 b6 folate folic foodfol b9dfe choline b12 vitaiu vita retinol acar bcar bcrypt lyco lutzea vite vitd vitdiu vitk satfat mufa pufa chol gw1 gd1 gw2 gd2 refuse".split(" ");
// Порядок — как NUTRIENTS в src/lib/recipeNutrition.ts
const OUT = ["kcal", "prot", "fat", "carb", "fib", "sug", "satfat", "vitc", "b1", "b2", "b3", "b5", "b6", "b9dfe", "b12", "vita", "vite", "vitd", "vitk", "ca", "fe", "mg", "p", "k", "na", "zn", "cu", "mn", "se", "chol"];

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
  const v = OUT.map((f) => (typeof r[f] === "number" ? Math.round(r[f] * 1000) / 1000 : null));
  const it = { n: m.name, id: m.ndb, u: m.units || {}, v };
  if (typeof m.density === "number") it.d = m.density;
  if (typeof m.edible === "number" && m.edible < 1) it.y = m.edible;
  items.push(it);
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
items.sort((a, b) => a.n.localeCompare(b.n, "ru"));
writeFileSync("src/lib/compositionData.json", JSON.stringify({ source: "USDA SR28", items }));
console.log(`Продуктов в таблице состава: ${items.length}`);
