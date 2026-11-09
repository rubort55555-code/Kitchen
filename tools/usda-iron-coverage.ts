// Независимая проверка разметки по железу на данных национальных баз состава продуктов.
// Запуск: tsx tools/usda-iron-coverage.ts usda <папка с food.csv, food_category.csv, food_nutrient.csv>   (USDA SR Legacy, CC0)
//         tsx tools/usda-iron-coverage.ts cnf  <папка с Food_Name.csv, CNF_Food_Group.csv, Nutrient_Amount.csv>   (Canadian Nutrient File, OGL-Canada)
// Пишет отчёт в literature/nutrient-interactions/iron/ (только счётчики; сами данные в репозиторий не кладём).
import { readFileSync, writeFileSync } from "node:fs";
import { foodIronFromUsdaGroup } from "../src/lib/iron";

const kind = process.argv[2], dir = process.argv[3];
if (!dir || !["usda", "cnf"].includes(kind)) { console.error("Использование: tsx tools/usda-iron-coverage.ts usda|cnf <папка>"); process.exit(1); }
function csv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
// Единый вид: список продуктов {id, группа}, железо мг на 100 г
let food: { id: string; group: string }[] = [];
const iron = new Map<string, number>();
if (kind === "usda") {
  const cat = new Map(csv(`${dir}/food_category.csv`).map((r) => [r.id, r.description]));
  food = csv(`${dir}/food.csv`).map((f) => ({ id: f.fdc_id, group: cat.get(f.food_category_id) || "?" }));
  for (const r of csv(`${dir}/food_nutrient.csv`)) if (r.nutrient_id === "1089" && r.amount !== "") iron.set(r.fdc_id, Number(r.amount));
} else {
  const cat = new Map(csv(`${dir}/CNF_Food_Group.csv`).map((r) => [r.CNF_Food_Group_Code, r.CNF_Food_Group_Description_EN]));
  food = csv(`${dir}/Food_Name.csv`).map((f) => ({ id: f.Food_Code, group: cat.get(f.CNF_Food_Group_Code) || "?" }));
  for (const r of csv(`${dir}/Nutrient_Amount.csv`)) if (r.Nutrient_Code === "303" && r.Nutrient_Amount !== "") iron.set(r.Food_Code, Number(r.Nutrient_Amount));
}
type S = { n: number; fe1: number; fe25: number; grade: string };
const by = new Map<string, S>();
for (const f of food) {
  const g = f.group;
  const s = by.get(g) || { n: 0, fe1: 0, fe25: 0, grade: foodIronFromUsdaGroup(g).grade };
  s.n++; const v = iron.get(f.id) ?? 0; if (v >= 1) s.fe1++; if (v >= 2.5) s.fe25++;
  by.set(g, s);
}
const sum = (f: (s: S) => number, grade?: string) => [...by.values()].filter((s) => !grade || s.grade === grade).reduce((a, s) => a + f(s), 0);
const total = sum((s) => s.n), fe1 = sum((s) => s.fe1);
const pct = (a: number, b: number) => `${Math.round((a / b) * 1000) / 10}%`;
const rows = [...by.entries()].sort((a, b) => b[1].fe1 - a[1].fe1);
const SRC = kind === "usda" ? { title: "USDA SR Legacy", text: "USDA FoodData Central, SR Legacy (апрель 2018), общественное достояние (CC0)", file: "USDA_SR_LEGACY.md" } : { title: "Canadian Nutrient File 2026", text: "Health Canada, Canadian Nutrient File 2026, лицензия Open Government Licence — Canada (open.canada.ca)", file: "CNF_CANADA.md" };
const md = `# Проверка разметки по железу: ${SRC.title}

Источник: ${SRC.text}. Создано \`tools/usda-iron-coverage.ts\`; в репозиторий кладутся только счётчики.

Всего продуктов: **${total}**; из них содержат железо ≥ 1 мг на 100 г: **${fe1}**; ≥ 2,5 мг: **${sum((s) => s.fe25)}**.

Разметка по группам (\`foodIronFromUsdaGroup\` в \`src/lib/iron.ts\`):
- группа с оценкой B или C: продуктов **${sum((s) => s.n, "B") + sum((s) => s.n, "C")}** (${pct(sum((s) => s.n, "B") + sum((s) => s.n, "C"), total)}), из них железосодержащих (≥ 1 мг/100 г): **${sum((s) => s.fe1, "B") + sum((s) => s.fe1, "C")}** (${pct(sum((s) => s.fe1, "B") + sum((s) => s.fe1, "C"), fe1)} от всех железосодержащих);
- группа без оценки (D): ${sum((s) => s.n, "D")} продуктов, из них железосодержащих ${sum((s) => s.fe1, "D")} — это смешанные группы (готовые блюда, детское питание, снеки, напитки и др.), для них нужна классификация по составу.

| Группа | Продуктов | ≥ 1 мг Fe/100 г | ≥ 2,5 мг | Оценка |
|---|---|---|---|---|
${rows.map(([g, s]) => `| ${g} | ${s.n} | ${s.fe1} | ${s.fe25} | ${s.grade} |`).join("\n")}
`;
writeFileSync(`literature/nutrient-interactions/iron/${SRC.file}`, md);
console.log(`Всего ${total}; железосодержащих ${fe1}; в группах с оценкой B/C: ${sum((s) => s.fe1, "B") + sum((s) => s.fe1, "C")} (${pct(sum((s) => s.fe1, "B") + sum((s) => s.fe1, "C"), fe1)})`);
