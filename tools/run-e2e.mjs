// Сценарии в браузере (Playwright для Python) одной командой: npm run test:e2e
// Сам собирает приложение: обычную сборку, «зеркало» для e2e_staging и сборку с адресом приёмника для e2e_feedback,
// а в конце возвращает обычную сборку в dist/. Браузер — переменная CHROMIUM (путь к chrome), как в самих сценариях.
// Только часть: npm run test:e2e -- diary menu
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const only = process.argv.slice(2);
const py = process.env.PYTHON || "python3";
const all = readdirSync("tests").filter((f) => /^e2e.*\.py$/.test(f)).sort()
  .filter((f) => !only.length || only.some((o) => f.includes(o)));
// Сценарии, которым нужна особая сборка, — в конце
const SPECIAL = { "e2e_feedback.py": { FEEDBACK_URL: "https://fb.test" } };

function run(cmd, args, env = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
}
function build(env = {}) {
  const r = run("node", ["build.mjs"], env);
  if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
}

console.log("Сборка приложения и «зеркала»…");
build();
build({ STAGING: "1", OUT_DIR: "dist-staging" });

const failed = [];
const t0 = Date.now();
let special = null;
for (const f of [...all.filter((f) => !SPECIAL[f]), ...all.filter((f) => SPECIAL[f])]) {
  if (SPECIAL[f] && special !== f) { build(SPECIAL[f]); special = f; }
  const t = Date.now();
  const r = run(py, ["tests/" + f]);
  const out = (r.stdout || "") + (r.stderr || "");
  const last = out.trim().split("\n").filter((l) => l.trim() && !/^[╔╚║═]/.test(l.trim())).pop() || "";
  const ok = r.status === 0;
  console.log(`${ok ? "✓" : "✗"} ${f.padEnd(22)} ${String(Math.round((Date.now() - t) / 1000)).padStart(4)} с  ${last.slice(0, 100)}`);
  if (!ok) { failed.push(f); console.log(out.split("\n").filter((l) => /FAIL|Error|Traceback/.test(l)).slice(0, 30).join("\n") || out.slice(-3000)); }
}
if (special) build();
console.log(`\nСценариев: ${all.length}, упало: ${failed.length}, время: ${((Date.now() - t0) / 1000).toFixed(0)} с`);
if (failed.length) { console.log("Упали: " + failed.join(", ")); process.exit(1); }
