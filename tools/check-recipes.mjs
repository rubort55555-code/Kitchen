// Проверка базы рецептов (recipes/*.txt). Запуск: node tools/check-recipes.mjs [--strict]
//
// Что проверяет:
//  1. формат (через tools/recipes.mjs) и повторы названий;
//  2. наши исключения: рецепт должен быть «ok» — без холодца, белой морской рыбы
//     (кроме минтая и камбалы) и без большого количества семечек;
//  3. продукты не из справочника (список с количеством повторов; с --strict это ошибка);
//  4. пустые количества, подозрительные порции и время, слишком короткие шаги.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { loadAll } from "./recipes.mjs";

const strict = process.argv.includes("--strict");

// esbuild: обычный (после npm install) или из LOCAL_NODE_MODULES (когда нет доступа к npm)
const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require("esbuild"); }
catch { esbuild = require(join(process.env.LOCAL_NODE_MODULES || "/opt/npm-tools/node_modules", "esbuild")); }

// Собираем нужные куски приложения (TypeScript) во временный файл и подключаем.
const dir = mkdtempSync(join(tmpdir(), "kitchen-check-"));
const out = join(dir, "logic.mjs");
await esbuild.build({
  stdin: {
    contents: `export { DEFAULT_RULES, compileRules, checkRecipe } from "./src/lib/exclusions";
               export { findCatalog } from "./src/lib/catalog";
               export { norm } from "./src/lib/util";`,
    resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
});
const L = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

// Продукты, которых нет в справочнике, но которые в рецептах — норма (не покупаются отдельно)
const FREE = /^(вода|кипяток|лёд|лед|соль|перец|специи|сахар ванильный|ванилин|корица|гвоздика|мускат|мускатный орех|куркума|имбирь молотый|сушёный\b|сушеный\b|тмин|кориандр|орегано|розмарин|тимьян|мята|аджика|хмели-сунели)/;

const { recipes, errors } = loadAll("recipes");
const compiled = L.compileRules(L.DEFAULT_RULES, [], []);
const problems = [...errors];
const unknown = new Map();
const names = new Map();

for (const r of recipes) {
  const where = `«${r.name}»`;
  const key = L.norm(r.name);
  if (names.has(key)) problems.push(`Повтор названия: ${where}`);
  names.set(key, 1);

  const res = L.checkRecipe({ ...r, createdAt: 0 }, compiled, []);
  if (res.verdict !== "ok") problems.push(`${where}: ${res.verdict} — ${res.issues.map((i) => i.msg).join(" ")}`);

  if (!r.kind) problems.push(`${where}: не указан вид блюда`);
  if (!r.minutes || r.minutes > 600) problems.push(`${where}: странное время (${r.minutes})`);
  if (!r.servings || r.servings > 24) problems.push(`${where}: странное число порций (${r.servings})`);
  for (const i of r.ingredients) {
    if (!i.amount && !FREE.test(L.norm(i.name))) problems.push(`${where}: у «${i.name}» нет количества`);
    if (!L.findCatalog(i.name) && !FREE.test(L.norm(i.name))) {
      const k = i.name;
      unknown.set(k, (unknown.get(k) || 0) + 1);
    }
  }
  for (const s of r.steps) if (s.length < 8) problems.push(`${where}: слишком короткий шаг «${s}»`);
}

const byKind = new Map();
for (const r of recipes) byKind.set(r.kind || "?", (byKind.get(r.kind || "?") || 0) + 1);
console.log(`Рецептов: ${recipes.length}`);
console.log([...byKind].map(([k, n]) => `${k}: ${n}`).join(" · "));

if (unknown.size) {
  const list = [...unknown].sort((a, b) => b[1] - a[1]);
  console.log(`\nНет в справочнике (${list.length}):`);
  console.log(list.map(([n, c]) => `${n} ×${c}`).join(", "));
  if (strict) problems.push(`Продуктов не из справочника: ${list.length}`);
}
if (problems.length) {
  console.error(`\nПроблем: ${problems.length}\n` + problems.slice(0, 80).join("\n"));
  process.exit(1);
}
console.log("\nВсё в порядке.");
