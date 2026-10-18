// Выписка из финской базы Fineli (THL, Release 18, лицензия CC BY 4.0) — только продукты из tools/nutrition-map.jsonl.
// Данные Fineli: https://github.com/mafredri/fineli-sql (data/Fineli_Rel18_open) или https://fineli.fi
// Запуск: node tools/fineli-extract.mjs <папка Fineli_Rel18_open>  → tools/fineli-values.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("Укажите папку с CSV Fineli (Fineli_Rel18_open)"); process.exit(1); }
const csv = (f) => new TextDecoder("windows-1252").decode(readFileSync(join(dir, f))).split(/\r?\n/).filter(Boolean).map((l) => l.split(";"));
const names = new Map(csv("foodname_EN.csv").slice(1).map((r) => [r[0], r[1]]));
const want = new Set(readFileSync("tools/nutrition-map.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).fineli).filter(Boolean).map(String));
const out = {};
for (const [id, comp, value] of csv("component_value.csv").slice(1)) {
  if (!want.has(id)) continue;
  const v = Number(String(value).replace(",", "."));
  if (!isFinite(v)) continue;
  (out[id] ??= { name: names.get(id), v: {} }).v[comp] = v;
}
const missing = [...want].filter((id) => !out[id]);
if (missing.length) { console.error("Нет в Fineli: " + missing.join(", ")); process.exit(1); }
writeFileSync("tools/fineli-values.json", JSON.stringify({ source: "Fineli Release 18, THL, CC BY 4.0", foods: out }, null, 0));
console.log(`Продуктов Fineli: ${Object.keys(out).length}`);
