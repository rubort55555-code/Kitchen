// Аудит справочника: как каждый ингредиент из recipes/*.txt находит продукт.
//   node tools/audit-catalog.mjs               — сводка и список нечётких совпадений
//   node tools/audit-catalog.mjs --save f.json — сохранить «ингредиент → продукт» для сравнения
//   node tools/audit-catalog.mjs --diff f.json — показать, что изменилось с прошлого раза
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { loadAll } from "./recipes.mjs";

const require = createRequire(import.meta.url);
let esbuild;
try { esbuild = require("esbuild"); }
catch { esbuild = require(join(process.env.LOCAL_NODE_MODULES || "/opt/npm-tools/node_modules", "esbuild")); }
const dir = mkdtempSync(join(tmpdir(), "kitchen-audit-"));
const out = join(dir, "l.mjs");
await esbuild.build({
  stdin: { contents: `export { CATALOG, findCatalog } from "./src/lib/catalog"; export { norm } from "./src/lib/util";`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
});
const L = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const { recipes } = loadAll("recipes");
const count = new Map();
for (const r of recipes) for (const i of r.ingredients) count.set(i.name, (count.get(i.name) || 0) + 1);

const exact = new Set(), syn = new Set();
for (const it of L.CATALOG) { exact.add(L.norm(it.n)); for (const s of it.s || []) syn.add(L.norm(s)); }

const res = {};
const fuzzy = [], none = [];
for (const [name, n] of count) {
  const c = L.findCatalog(name);
  res[name] = c ? c.n : null;
  const q = L.norm(name);
  if (!c) none.push([name, n]);
  else if (!exact.has(q) && !syn.has(q)) fuzzy.push([name, c.n, n]);
}
// Защита от раздутых списков и повторов
const seenN = new Map(), seenS = new Map(), lint = [];
for (const it of L.CATALOG) {
  const k = L.norm(it.n);
  if (seenN.has(k)) lint.push(`повтор названия: «${it.n}»`);
  seenN.set(k, it);
  if ((it.s || []).length > 6) lint.push(`слишком много синонимов (${it.s.length}): «${it.n}»`);
  if (it.g && !L.CATALOG.some((x) => L.norm(x.n) === L.norm(it.g))) lint.push(`«${it.n}»: базовый продукт «${it.g}» не найден`);
}
for (const it of L.CATALOG) for (const s of it.s || []) {
  const k = L.norm(s);
  if (seenN.has(k) && seenN.get(k) !== it) lint.push(`синоним «${s}» у «${it.n}» совпадает с названием «${seenN.get(k).n}»`);
  else if (seenS.has(k) && seenS.get(k) !== it) lint.push(`синоним «${s}» есть и у «${seenS.get(k).n}», и у «${it.n}»`);
  seenS.set(k, it);
}
if (process.argv.includes("--lint")) { console.log(lint.join("\n") || "Справочник чистый"); console.log(`Позиций: ${L.CATALOG.length}`); process.exit(lint.length ? 1 : 0); }
const args = process.argv.slice(2);
if (args[0] === "--save") { writeFileSync(args[1], JSON.stringify(res, null, 1)); console.log("сохранено", Object.keys(res).length); process.exit(0); }
if (args[0] === "--diff") {
  const old = JSON.parse(readFileSync(args[1], "utf8"));
  let ch = 0;
  for (const [k, v] of Object.entries(res)) if (old[k] !== v) { ch++; console.log(`${k}:  ${old[k] ?? "—"}  →  ${v ?? "—"}`); }
  console.log(`\nИзменилось: ${ch} из ${Object.keys(res).length}`);
  process.exit(0);
}
console.log(`Каталог: ${L.CATALOG.length} позиций. Уникальных ингредиентов в рецептах: ${count.size}`);
console.log(`Точно/по синониму: ${count.size - fuzzy.length - none.length}, по началу слова: ${fuzzy.length}, не найдено: ${none.length}`);
if (none.length) console.log("\nНЕ НАЙДЕНО:\n" + none.sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ×${c}`).join(", "));
console.log("\nПО НАЧАЛУ СЛОВА (ингредиент → продукт):\n" + fuzzy.sort((a, b) => a[1].localeCompare(b[1])).map(([n, c, k]) => `${n} → ${c}`).join("\n"));
