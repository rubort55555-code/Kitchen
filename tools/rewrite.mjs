// Переписывание рецептов партиями (подробные шаги, посуда, подача, хранение, советы).
//   node tools/rewrite.mjs next 100 > batch.txt   — следующие 100 рецептов, ещё не переписанных (по порядку файлов)
//   node tools/rewrite.mjs apply batch.txt          — заменить рецепты в recipes/*.txt на переписанные (по названию)
//   node tools/rewrite.mjs stat                     — сколько уже переписано
// Переписанный рецепт — тот, у которого есть строка «= Посуда: …».
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "recipes";
const files = readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort();
const nameOf = (block) => { const h = block.split("\n").find((l) => l.trim().startsWith("#")); return h ? h.trim().slice(1).split("|")[0].trim() : null; };
const done = (block) => /^\s*=\s*Посуда:/m.test(block);
const blocksOf = (text) => text.replace(/\r/g, "").split(/\n\s*\n/);

const [cmd, arg] = process.argv.slice(2);
if (cmd === "next") {
  const n = Number(arg) || 100;
  const out = [];
  for (const f of files) {
    for (const b of blocksOf(readFileSync(join(DIR, f), "utf8"))) {
      if (out.length >= n) break;
      if (nameOf(b) && !done(b)) out.push(`// файл: ${f}\n${b.trim()}`);
    }
  }
  console.log(out.join("\n\n"));
} else if (cmd === "apply") {
  const fresh = new Map();
  for (const b of blocksOf(readFileSync(arg, "utf8"))) {
    const n = nameOf(b);
    if (n) fresh.set(n, b.split("\n").filter((l) => !l.trim().startsWith("// файл:")).join("\n").trim());
  }
  const left = new Set(fresh.keys());
  for (const f of files) {
    const p = join(DIR, f);
    const text = readFileSync(p, "utf8");
    const parts = text.replace(/\r/g, "").split(/(\n\s*\n)/);
    let changed = false;
    for (let i = 0; i < parts.length; i += 2) {
      const n = nameOf(parts[i]);
      if (!n || !fresh.has(n)) continue;
      // Комментарии перед рецептом в том же блоке сохраняем
      const lead = parts[i].split("\n").filter((l, k, a) => l.trim().startsWith("//") && a.slice(0, k).every((x) => x.trim().startsWith("//")));
      parts[i] = [...lead, fresh.get(n)].join("\n");
      left.delete(n);
      changed = true;
    }
    if (changed) writeFileSync(p, parts.join(""));
  }
  console.log(`Заменено: ${fresh.size - left.size} из ${fresh.size}`);
  if (left.size) { console.error("Не найдены по названию (название менять нельзя):\n" + [...left].join("\n")); process.exit(1); }
} else if (cmd === "stat") {
  let all = 0, ok = 0;
  for (const f of files) for (const b of blocksOf(readFileSync(join(DIR, f), "utf8"))) if (nameOf(b)) { all++; if (done(b)) ok++; }
  console.log(`Переписано: ${ok} из ${all}, осталось ${all - ok}`);
} else {
  console.error("Команды: next N | apply файл | stat");
  process.exit(1);
}
