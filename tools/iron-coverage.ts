// Отчёт о покрытии справочника продуктов разметкой по железу (этап 1 программы биодоступности).
// Запуск: tsx tools/iron-coverage.ts → literature/nutrient-interactions/iron/COVERAGE_IRON.md
import { writeFileSync } from "node:fs";
import { CATALOG } from "../src/lib/catalog";
import { foodIron } from "../src/lib/iron";

const total = CATALOG.length;
const grade: Record<string, number> = { B: 0, C: 0, D: 0 };
const flags: Record<string, number> = {};
const cat: Record<string, Record<string, number>> = {};
const dByCat: Record<string, string[]> = {};
for (const it of CATALOG) {
  const f = foodIron(it.n, it);
  grade[f.grade]++;
  (cat[it.c] ||= { B: 0, C: 0, D: 0 })[f.grade]++;
  for (const fl of f.flags) flags[fl] = (flags[fl] || 0) + 1;
  if (f.grade === "D") (dByCat[it.c] ||= []).push(it.n);
}
const pct = (n: number) => `${Math.round((n / total) * 1000) / 10}%`;
const FLAG_TEXT: Record<string, string> = { meat: "мясо, птица (в т. ч. субпродукты)", organ: "субпродукты", fish: "рыба и морепродукты", egg: "яйца", dairy: "молочное (кальций, молочный белок)", legume: "бобовые (фитаты)", soy: "соя", nuts: "орехи и семена (фитаты)", grain: "крупы и злаки (фитаты)", polyphenol: "чай, кофе, какао, шоколад (полифенолы)", alcohol: "алкоголь (в оценке не используется)" };
let md = `# Покрытие справочника продуктов разметкой по железу

Создано \`tools/iron-coverage.ts\` (в репозитории — \`npm run coverage:iron\`) по \`src/lib/iron.ts\`. Не править вручную.

Всего продуктов в справочнике: **${total}**.

## Степени надёжности (см. ../COVERAGE.md)
| Степень | Продуктов | Доля | Что значит |
|---|---|---|---|
| B | ${grade.B} | ${pct(grade.B)} | направление эффекта на усвоение железа подтверждено обзорами и исследованиями на людях (мясо, рыба, яйца, молочное, чай/кофе/какао, бобовые, соя) |
| C | ${grade.C} | ${pct(grade.C)} | общая категория без точных данных (крупы, хлеб, орехи, овощи, фрукты) или продукт, не влияющий на железо заметно (масла, сахар, специи, соки) |
| D | ${grade.D} | ${pct(grade.D)} | **данных нет**: составные блюда, полуфабрикаты, выпечка, редкие и «мировые» продукты, часть напитков — в оценке не учитываются |

## Признаки, найденные у продуктов
| Признак | Продуктов |
|---|---|
${Object.entries(flags).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${FLAG_TEXT[k] || k} | ${v} |`).join("\n")}

## По категориям справочника
| Категория | B | C | D |
|---|---|---|---|
${Object.entries(cat).sort((a, b) => b[1].D - a[1].D).map(([k, v]) => `| ${k} | ${v.B} | ${v.C} | ${v.D} |`).join("\n")}

## Продукты без данных (D) — очередь на разметку
${Object.entries(dByCat).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `### ${k} (${v.length})\n${v.join(", ")}`).join("\n\n")}
`;
writeFileSync("literature/nutrient-interactions/iron/COVERAGE_IRON.md", md);
console.log(`Продуктов ${total}: B ${grade.B} (${pct(grade.B)}), C ${grade.C} (${pct(grade.C)}), D ${grade.D} (${pct(grade.D)})`);
