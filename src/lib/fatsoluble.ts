// Жирорастворимые витамины (A, D, E, K) и каротиноиды: хватает ли жира в приёме пищи, чтобы они усвоились (этап 3 программы биодоступности).
// Как и на других этапах, это качественные подсказки: точных коэффициентов для всех продуктов в открытых работах нет, а на упаковке
// каротиноиды и «жир нужного типа» не пишут. Степень надёжности: B — направление эффекта подтверждено исследованиями на людях; C — эвристика приложения.
import type { Meal, Recipe } from "./types";
import { mealParts, type Grade } from "./iron";
import type { Hint } from "./interactions";
import { sumMeals } from "./diary";

/** Источники пороговых значений по жиру (выписаны из прочитанных текстов, см. literature/nutrient-interactions/fat-soluble/EVIDENCE.md). */
export const FAT_MIN_G = 3; // для витамина E нужно не менее ≈ 3 г жира за приём (одно из исследований, цитируется в обзоре Reboul, 2017)
export const FAT_CAROTENE_G = 8; // усвоение β-каротина растёт с жиром примерно до 8 г в приёме (Moran и др., 2017, о работе White и др.)
export const FAT_FULL_G = 32; // витамин A (ретинилпальмитат), K, ликопин, α-каротин — рост усвоения до ≈ 32 г масла (там же)

/** «Много» витамина в приёме: доля суточной нормы около 20–30% (эвристика приложения, степень C). */
export const RICH = { vitA: 300, vitE: 4, vitK: 60, vitD: 3 } as const;

export type CarotenoidKind = "beta" | "lycopene" | "lutein";
const w = (src: string) => new RegExp("(?<![а-яё])(" + src + ")", "i");
// Основные пищевые источники по названию (общеизвестные; в прочитанных работах приведены как «каротиноидные овощи и фрукты»)
const CAROTENOID: { kind: CarotenoidKind; re: RegExp }[] = [
  { kind: "lycopene", re: w("томат|помидор|черри|кетчуп|арбуз|гуав") },
  { kind: "beta", re: w("морков|тыкв|батат|абрикос|манго|папайя|дын[яи]|перец красн|паприк|шиповник|курага") },
  { kind: "lutein", re: w("шпинат|капуста кале|кале(?![а-яё])|брокколи|мангольд|зел[её]н[а-я]* горош|кукуруз|петрушк|салат ромэн|руккол") },
];
/** Каротиноидная группа продукта по названию; null — не определена. */
export function carotenoidOf(name: string): CarotenoidKind | null {
  return CAROTENOID.find((x) => x.re.test(name))?.kind ?? null;
}

export type FatLevel = "low" | "enough" | "good";
export interface FatSolubleMeal {
  slot: string;
  fat: number;
  /** Какие витамины есть в заметном количестве. */
  vitamins: ("A" | "D" | "E" | "K")[];
  carotenoids: CarotenoidKind[];
  /** Хватает ли жира: меньше 3 г — мало; 3–8 г — достаточно для E и лютеина; 8 г и больше — хорошо для β-каротина. */
  level: FatLevel;
  grade: Grade;
}
export interface FsCtx { recipes: Recipe[] }

/** Оценка приёма пищи: есть ли жирорастворимые витамины и достаточно ли жира. null — витаминов и каротиноидов мало. */
export function analyzeFatSoluble(slot: string, meals: Meal[], ctx: FsCtx): FatSolubleMeal | null {
  const s = sumMeals(meals);
  const v: FatSolubleMeal["vitamins"] = [];
  if (s.vitA >= RICH.vitA) v.push("A");
  if (s.vitD >= RICH.vitD) v.push("D");
  if (s.vitE >= RICH.vitE) v.push("E");
  if (s.vitK >= RICH.vitK) v.push("K");
  const parts = meals.flatMap((m) => mealParts(m, ctx));
  const caro = [...new Set(parts.filter((p) => p.grams >= 30).map((p) => carotenoidOf(p.name)).filter((x): x is CarotenoidKind => !!x))];
  if (!v.length && !caro.length) return null;
  return { slot, fat: s.fat, vitamins: v, carotenoids: caro, level: s.fat < FAT_MIN_G ? "low" : s.fat < FAT_CAROTENE_G ? "enough" : "good", grade: caro.length ? "C" : "B" };
}

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
const NAMES: Record<string, string> = { A: "A", D: "D", E: "E", K: "K" };

/** Подсказки по жиру для жирорастворимых витаминов и каротиноидов. */
export function fatSolubleHints(meals: Meal[], ctx: FsCtx): Hint[] {
  const by = new Map<string, Meal[]>();
  for (const m of meals) by.set(m.slot, [...(by.get(m.slot) || []), m]);
  const out: Hint[] = [];
  for (const [slot, list] of by) {
    const r = analyzeFatSoluble(slot, list, ctx);
    if (!r) continue;
    const what = [r.vitamins.length ? `витамины ${r.vitamins.map((x) => NAMES[x]).join(", ")}` : "", r.carotenoids.length ? "каротиноидные овощи и фрукты" : ""].filter(Boolean).join(" и ");
    if (r.level === "low") {
      out.push({ id: `fat-sol:${slot}`, text: `Приём «${slot}»: есть ${what}, но жира всего ${fmt(r.fat)} г. Для усвоения жирорастворимых витаминов нужен жир в этом же приёме — не меньше ≈ 3 г (витамин E), лучше 8 г и больше (β-каротин). Добавьте чайную ложку масла, сметану, орехи или авокадо.`, src: ["reboul2017e", "moran2017"] });
    } else if (r.level === "enough" && r.carotenoids.includes("beta")) {
      out.push({ id: `fat-caro:${slot}`, text: `Приём «${slot}»: есть морковь, тыква или другие источники β-каротина, жира ${fmt(r.fat)} г. Усвоение β-каротина растёт с количеством жира примерно до 8 г за приём — полторы чайных ложки масла помогут.`, src: ["moran2017"] });
    }
    if (r.level !== "good" && r.carotenoids.some((c) => c === "lycopene" || c === "beta")) {
      out.push({ id: `caro-heat:${slot}`, text: `Приём «${slot}»: каротиноиды томатов и моркови лучше усваиваются из тушёных, протёртых и нагретых продуктов, чем из сырых (в лабораторной модели пищеварения ликопин: 0,1% из сырых томатов и 1,5% из пюре; β-каротин: 4% из морковного пюре и 14% из сока). Масло при тушении помогает ещё больше.`, src: ["reboul2019", "yao2023"] });
    }
  }
  return out;
}

/** Строки по жиру для дневника: только приёмы, где есть жирорастворимые витамины. */
export function fatSolubleDay(meals: Meal[], ctx: FsCtx): FatSolubleMeal[] {
  const by = new Map<string, Meal[]>();
  for (const m of meals) by.set(m.slot, [...(by.get(m.slot) || []), m]);
  return [...by].map(([slot, list]) => analyzeFatSoluble(slot, list, ctx)).filter((x): x is FatSolubleMeal => !!x);
}
export const FAT_TEXT: Record<FatLevel, string> = { low: "жира мало — витамины усвоятся плохо", enough: "жира достаточно для витамина E, мало для β-каротина", good: "жира достаточно" };
