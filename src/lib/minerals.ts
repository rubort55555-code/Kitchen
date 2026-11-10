// Цинк, кальций, магний: что мешает усвоению в приёме пищи (этап 2 программы биодоступности, literature/nutrient-interactions/COVERAGE.md).
// Как и для железа, это качественная оценка и подсказки, а не расчёт процента: модель усвоения цинка (Miller и др., 2013) требует
// точных данных о фитате и белке, которых в справочнике состава нет, а её коэффициенты в найденных открытых работах не приведены.
// Степень надёжности: B — направление эффекта подтверждено обзорами и исследованиями на людях; C — типичный признак по категории или аналогии.
import type { Meal, Recipe } from "./types";
import { mealParts, type Grade, type IronFlag } from "./iron";
import type { Hint } from "./interactions";
import { sumMeals } from "./diary";

/** Оксалаты: кальций шпината и ревеня усваивается на 5–9% (Shkembi и Huppertz, 2021 — обзор «Calcium absorption from food products»). */
const OXALATE_B = /(?<![а-яё])(шпинат|ревен)/i;
// Щавель и мангольд богаты оксалатами по общим сведениям; в прочитанных работах прямых данных нет — степень C
const OXALATE_C = /(?<![а-яё])(щавел|мангольд|свекольн[а-я]* ботв|ботв[аы] свёкл)/i;
export function oxalateOf(name: string): Grade {
  return OXALATE_B.test(name) ? "B" : OXALATE_C.test(name) ? "C" : "D";
}

export const MINERAL_MIN_MG = { zn: 1.5, ca: 100 };
export const OXALATE_G = 50; // грамм шпината или ревеня в приёме, начиная с которых отмечаем
export const PHYTATE_G = 30; // бобовые, соя, орехи, цельные крупы (сырой вес) — как для железа
export const CALCIUM_CAP_MG = 500; // выше — отдача падает: до ~200 мг за приём усвоение пропорционально, дальше — «убывающая отдача»
export const CALCIUM_SPLIT_MG = 500;
export const ZN_CA_MG = 300; // кальций ≥ 300 мг вместе с фитатными продуктами — дополнительная помеха цинку (эвристика)

export interface MineralCtx { recipes: Recipe[] }
const PHYTATE_FLAGS: IronFlag[] = ["legume", "soy", "nuts", "grain"];

interface MealView { slot: string; list: Meal[]; ca: number; zn: number; fe: number; phytateG: number; oxalateG: number; dairy: boolean }
function view(slot: string, list: Meal[], ctx: MineralCtx): MealView {
  const s = sumMeals(list);
  const parts = list.flatMap((m) => mealParts(m, ctx));
  return {
    slot, list, ca: s.ca, zn: s.zn, fe: s.fe,
    phytateG: parts.filter((p) => p.food.flags.some((f) => PHYTATE_FLAGS.includes(f))).reduce((a, p) => a + p.grams, 0),
    oxalateG: parts.filter((p) => oxalateOf(p.name) !== "D").reduce((a, p) => a + p.grams, 0),
    dairy: parts.some((p) => p.food.flags.includes("dairy")),
  };
}
const bySlot = (meals: Meal[]) => { const m = new Map<string, Meal[]>(); for (const x of meals) m.set(x.slot, [...(m.get(x.slot) || []), x]); return m; };

export type CaQuality = "good" | "mixed" | "poor";
export interface CalciumMeal { slot: string; mg: number; quality: CaQuality; oxalate: boolean; phytate: boolean; dairy: boolean; tooMuch: boolean }
/** Оценка кальция в приёме: молочное — хороший источник, шпинат и ревень — плохой, фитаты мешают. null — кальция мало. */
export function analyzeCalcium(slot: string, meals: Meal[], ctx: MineralCtx): CalciumMeal | null {
  const v = view(slot, meals, ctx);
  if (v.ca < MINERAL_MIN_MG.ca) return null;
  const oxalate = v.oxalateG >= OXALATE_G, phytate = v.phytateG >= PHYTATE_G;
  const quality: CaQuality = (oxalate || phytate) && !v.dairy ? "poor" : oxalate || phytate ? "mixed" : "good";
  return { slot, mg: v.ca, quality, oxalate, phytate, dairy: v.dairy, tooMuch: v.ca >= CALCIUM_CAP_MG };
}

export type ZincLevel = "usual" | "worse";
export interface ZincMeal { slot: string; mg: number; level: ZincLevel; inhibitors: string[]; grade: Grade }
/** Оценка цинка в приёме: фитаты (и кальций вместе с ними) снижают усвоение. null — цинка мало. */
export function analyzeZinc(slot: string, meals: Meal[], ctx: MineralCtx): ZincMeal | null {
  const v = view(slot, meals, ctx);
  if (v.zn < MINERAL_MIN_MG.zn) return null;
  const inh: string[] = [];
  let grade: Grade = "B";
  if (v.phytateG >= PHYTATE_G) { inh.push("фитаты (бобовые, орехи, цельные крупы)"); grade = "C"; if (v.ca >= ZN_CA_MG) inh.push("кальций вместе с фитатами"); }
  return { slot, mg: v.zn, level: inh.length ? "worse" : "usual", inhibitors: inh, grade };
}

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
export const CA_TEXT: Record<CaQuality, string> = { good: "кальций усваивается хорошо", mixed: "кальций усваивается хуже из-за продуктов рядом", poor: "кальций усваивается плохо" };

/** Подсказки по кальцию, цинку и магнию на день. */
export function mineralHints(meals: Meal[], ctx: MineralCtx): Hint[] {
  const out: Hint[] = [];
  for (const [slot, list] of bySlot(meals)) {
    const v = view(slot, list, ctx);
    const ca = analyzeCalcium(slot, list, ctx);
    if (ca?.oxalate) out.push({ id: `ca-oxalate:${slot}`, text: `Приём «${slot}»: есть шпинат или ревень (оксалаты). Кальций из них усваивается на 5–9%, из молока — 26–45%. Не считайте их основным источником кальция.`, src: ["shkembi2021ca"] });
    if (ca?.tooMuch) out.push({ id: `ca-split:${slot}`, text: `Приём «${slot}»: кальция ${fmt(ca.mg)} мг сразу. До ≈ 200 мг за приём усвоение растёт пропорционально, выше — отдача падает. Лучше распределить молочное на несколько приёмов в день.`, src: ["shkembi2021ca"] });
    const zn = analyzeZinc(slot, list, ctx);
    if (zn?.inhibitors.some((x) => x.startsWith("кальций"))) out.push({ id: `zn-ca-phytate:${slot}`, text: `Приём «${slot}»: цинка ${fmt(zn.mg)} мг, но много фитатов и кальция одновременно — это может снижать усвоение цинка. Помогают замачивание, проращивание и закваска (фитаты распадаются).`, src: ["shkembi2021zn", "chondrou2024"] });
    else if (zn?.inhibitors.length && v.fe < 1.5) out.push({ id: `zn-phytate:${slot}`, text: `Приём «${slot}»: цинка ${fmt(zn.mg)} мг, но бобовые, орехи или цельные крупы содержат фитаты — они связывают цинк. Помогают замачивание, проращивание и закваска.`, src: ["chondrou2024", "shkembi2021zn"] });
  }
  return out;
}

/** Строки дневника по кальцию. */
export function calciumDay(meals: Meal[], ctx: MineralCtx): CalciumMeal[] {
  return [...bySlot(meals)].map(([slot, list]) => analyzeCalcium(slot, list, ctx)).filter((x): x is CalciumMeal => !!x);
}
