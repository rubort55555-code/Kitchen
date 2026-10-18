// Пищевая ценность рецепта: КБЖУ, витамины и минералы по составу продуктов (Fineli и USDA SR28, на 100 г)
// и весу бытовых мер («1 шт», «2 ст. л.», «зубчик»). Расчёт ориентировочный: без потерь при варке.
import type { Ingredient, Recipe } from "./types";
import { norm } from "./util";
import { findCatalog } from "./catalog";
import DATA from "./compositionData.json";

/** Показатели в том порядке, в каком они лежат в compositionData.json (v). Ключи — как в micros() из nutrition.ts. */
export const NUTRIENTS = [
  { key: "kcal", title: "Энергия", unit: "ккал" },
  { key: "protein", title: "Белки", unit: "г" },
  { key: "fat", title: "Жиры", unit: "г" },
  { key: "carbs", title: "Углеводы", unit: "г" },
  { key: "fiber", title: "Клетчатка", unit: "г" },
  { key: "sugar", title: "Сахара", unit: "г" },
  { key: "satFat", title: "Насыщенные жиры", unit: "г" },
  { key: "vitC", title: "Витамин C", unit: "мг" },
  { key: "vitB1", title: "Витамин B1", unit: "мг" },
  { key: "vitB2", title: "Витамин B2", unit: "мг" },
  { key: "niacin", title: "Ниацин (PP)", unit: "мг" },
  { key: "pantothenic", title: "Пантотеновая кислота", unit: "мг" },
  { key: "vitB6", title: "Витамин B6", unit: "мг" },
  { key: "folate", title: "Фолаты", unit: "мкг" },
  { key: "vitB12", title: "Витамин B12", unit: "мкг" },
  { key: "vitA", title: "Витамин A", unit: "мкг" },
  { key: "vitE", title: "Витамин E", unit: "мг" },
  { key: "vitD", title: "Витамин D", unit: "мкг" },
  { key: "vitK", title: "Витамин K", unit: "мкг" },
  { key: "ca", title: "Кальций", unit: "мг" },
  { key: "fe", title: "Железо", unit: "мг" },
  { key: "mg", title: "Магний", unit: "мг" },
  { key: "p", title: "Фосфор", unit: "мг" },
  { key: "k", title: "Калий", unit: "мг" },
  { key: "na", title: "Натрий", unit: "мг" },
  { key: "zn", title: "Цинк", unit: "мг" },
  { key: "cu", title: "Медь", unit: "мг" },
  { key: "mn", title: "Марганец", unit: "мг" },
  { key: "se", title: "Селен", unit: "мкг" },
  { key: "chol", title: "Холестерин", unit: "мг" },
  { key: "i", title: "Йод", unit: "мкг" },
] as const;
export type NutrientKey = (typeof NUTRIENTS)[number]["key"];
export type Nutrients = Record<NutrientKey, number>;

/** y — съедобная доля для веса «с костями» (курица целая, кости), по умолчанию 1. */
interface Entry { n: string; id: string; u: Record<string, number>; d?: number; y?: number; v: (number | null)[] }
const ENTRIES = (DATA as unknown as { items: Entry[] }).items;
const byName = new Map(ENTRIES.map((e) => [norm(e.n), e]));

/** Состав продукта по названию ингредиента: точно, иначе через справочник («Помидоры черри» → «Помидоры»). */
export function compositionOf(name: string): Entry | null {
  const k = norm(name);
  const e = byName.get(k);
  if (e) return e;
  const c = findCatalog(name);
  if (c) return byName.get(norm(c.n)) || (c.g ? byName.get(norm(c.g)) : undefined) || null;
  return null;
}

/** Единица к одной форме: «зубчика» → «зубчик», «ст.л.» → «ст. л.». */
export function unitKey(u: string): string {
  const s = u.trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
  if (/^ст\.? ?л/.test(s)) return "ст. л.";
  if (/^ч\.? ?л/.test(s)) return "ч. л.";
  if (/^зубч/.test(s)) return "зубчик";
  if (/^головк/.test(s)) return "головка";
  if (/^ломтик/.test(s)) return "ломтик";
  if (/^стеб/.test(s)) return "стебель";
  if (/^пуч/.test(s)) return "пучок";
  if (/^(лист|несколько лист)/.test(s)) return "лист";
  if (/^щеп/.test(s)) return "щепотка";
  if (/^(шт|штук)/.test(s)) return "шт";
  if (/^(уп|упак)/.test(s)) return "уп";
  if (/^банк/.test(s)) return "банка";
  if (/^(г|гр|грамм\w*)$/.test(s)) return "г";
  if (/^кг$/.test(s)) return "кг";
  if (/^мл$/.test(s)) return "мл";
  if (/^л$/.test(s)) return "л";
  return s;
}

/** Граммы ингредиента. 0 — «по вкусу» и подобное (не влияет на итог), null — не получилось посчитать. */
export function gramsOf(i: Ingredient, e: Entry | null = compositionOf(i.name)): number | null {
  const a = (i.amount || "").trim();
  if (!a || /по вкусу|для подачи|на кончике/i.test(a)) return 0;
  const m = a.match(/^(\d+(?:[.,]\d+)?)(?:\s*(?:[-–]|\/)\s*(\d+(?:[.,]\d+)?))?\s*(.*)$/);
  let qty = 1, unit = a;
  if (m) {
    const x = Number(m[1].replace(",", ".")), y = m[2] ? Number(m[2].replace(",", ".")) : null;
    qty = y === null ? x : a.includes("/") ? x / y : (x + y) / 2;
    unit = m[3];
  }
  const u = unitKey(unit);
  if (u === "г") return qty * (e?.y ?? 1);
  if (u === "кг") return qty * 1000 * (e?.y ?? 1);
  if (u === "мл") return qty * (e?.d ?? 1);
  if (u === "л") return qty * 1000 * (e?.d ?? 1);
  if (u === "щепотка") return qty * (e?.u["щепотка"] ?? 0.5);
  // Сначала точная запись («несколько веточек», «пакетика»), потом общая форма; банка = шт (консервы)
  const w = e?.u[unit.trim().toLowerCase()] ?? e?.u[u] ?? (u === "банка" ? e?.u["шт"] : undefined);
  return typeof w === "number" ? qty * w : null;
}

export interface RecipeNutrition {
  /** На одну порцию. */
  perServing: Nutrients;
  /** Вес продуктов на порцию, г (сырых, до готовки). */
  grams: number;
  /** Ингредиенты, которые не удалось учесть. */
  missing: string[];
  /** Доля ингредиентов, которые удалось посчитать (0–1). */
  coverage: number;
}

const zero = (): Nutrients => Object.fromEntries(NUTRIENTS.map((x) => [x.key, 0])) as Nutrients;

/** Пищевая ценность рецепта на порцию. null — посчитать нельзя (нет ни одного известного продукта). */
export function recipeNutrition(r: Recipe, servings = r.servings || 2): RecipeNutrition | null {
  const sum = zero();
  const missing: string[] = [];
  let known = 0;
  for (const ing of r.ingredients) {
    const e = compositionOf(ing.name);
    const g = gramsOf(ing, e);
    if (g === null || !e) { missing.push(ing.name); continue; }
    known += g;
    NUTRIENTS.forEach((x, k) => { sum[x.key] += ((e.v[k] ?? 0) * g) / 100; });
  }
  if (!known) return null;
  const s = Math.max(1, servings);
  const perServing = zero();
  for (const x of NUTRIENTS) perServing[x.key] = sum[x.key] / s;
  return { perServing, grams: known / s, missing, coverage: (r.ingredients.length - missing.length) / r.ingredients.length };
}
