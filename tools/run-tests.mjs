// Все проверки логики одной командой: npm test
// Запускает каждый tests/*.test.ts отдельно (у каждого своё состояние) и в конце печатает итог.
// Код выхода 1, если упал хотя бы один набор, — так GitHub не пропустит публикацию.
// Только часть: npm test -- iron diary
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const only = process.argv.slice(2);
const files = readdirSync("tests").filter((f) => f.endsWith(".test.ts")).sort()
  .filter((f) => !only.length || only.some((o) => f.includes(o)));
if (!files.length) { console.error("Не найдено ни одного набора проверок" + (only.length ? ": " + only.join(", ") : "")); process.exit(1); }

const failed = [];
const t0 = Date.now();
for (const f of files) {
  const t = Date.now();
  const r = spawnSync(process.execPath, ["--import", "tsx", "tests/" + f], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const last = out.trim().split("\n").pop() || "";
  const ok = r.status === 0;
  console.log(`${ok ? "✓" : "✗"} ${f.padEnd(28)} ${String(Date.now() - t).padStart(6)} мс  ${last.slice(0, 100)}`);
  if (!ok) { failed.push(f); console.log(out.split("\n").filter((l) => /FAIL|Error|error|✗/.test(l)).slice(0, 30).join("\n") || out.slice(-3000)); }
}
console.log(`\nНаборов: ${files.length}, упало: ${failed.length}, время: ${((Date.now() - t0) / 1000).toFixed(0)} с`);
if (failed.length) { console.log("Упали: " + failed.join(", ")); process.exit(1); }
