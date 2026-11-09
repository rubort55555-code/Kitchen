// Сочетания продуктов и усвоение нутриентов: жирорастворимые витамины и кофеин. Железо — в iron.ts.
// Правила опираются на опубликованные работы (список — SOURCES; обзор и ссылки — literature/nutrient-interactions/).
// Это подсказки к рациону, а не расчёт биодоступности: в справочнике состава нет данных о гемовом железе, фитатах и дубильных веществах.
import type { Meal, MealSlot } from "./types";
import { sumMeals } from "./diary";

export interface Source { id: string; cite: string }
export const SOURCES: Record<string, Source> = {
  heffernan2017: { id: "heffernan2017", cite: "Heffernan A. и др. The regulation of dietary iron bioavailability by vitamin C: a systematic review and meta-analysis. Proc Nutr Soc, 2017" },
  milman2020: { id: "milman2020", cite: "Milman N. A review of nutrients and compounds which promote or inhibit intestinal iron absorption. J Nutr Metab, 2020" },
  chondrou2024: { id: "chondrou2024", cite: "Chondrou T. и др. Dietary phytic acid, dephytinization, and phytase supplementation alter trace element bioavailability. Nutrients, 2024" },
  white2017: { id: "white2017", cite: "White W.S. и др. (обсуждение: Moran N.E. и др., Am J Clin Nutr, 2017) Lipid mass and absorption of fat-soluble vitamins and carotenoids from raw vegetables" },
  yao2023: { id: "yao2023", cite: "Yao Y. и др. Effects of dietary fat type and emulsification on carotenoid absorption: a randomized crossover trial. Am J Clin Nutr, 2023" },
  massey1984: { id: "massey1984", cite: "Massey L.K., Wise K.J. The effect of dietary caffeine on urinary excretion of calcium, magnesium, sodium and potassium in healthy young females. Nutr Res, 1984" },
  bergman1990: { id: "bergman1990", cite: "Bergman E.A. и др. Effects of dietary caffeine on renal handling of minerals in adult women. Life Sci, 1990" },
  kynast1994: { id: "kynast1994", cite: "Kynast-Gales S.A., Massey L.K. Effect of caffeine on circadian excretion of urinary calcium and magnesium. J Am Coll Nutr, 1994" },
  piskin2022: { id: "piskin2022", cite: "Piskin E. и др. Iron absorption: factors, limitations, and improvement methods. ACS Omega, 2022 (CC BY 4.0)" },
  decarli2018: { id: "decarli2018", cite: "De Carli E. и др. Dietary iron bioavailability: agreement between estimation methods and association with serum ferritin concentrations in women of childbearing age. Nutrients, 2018 (CC BY 4.0)" },
  dahdouh2019: { id: "dahdouh2019", cite: "Dahdouh S. и др. Development of the FAO/INFOODS/IZINCG global food composition database for phytate. J Food Compost Anal, 2019 (CC BY 4.0)" },
  prentice2017: { id: "prentice2017", cite: "Prentice A.M. и др. Dietary strategies for improving iron status: balancing safety and efficacy. Nutr Rev, 2017 (CC BY 4.0)" },
  weaver2025: { id: "weaver2025", cite: "Weaver C. и др. Perspective: framework for developing prediction equations for estimating the absorption and bioavailability of nutrients from foods. Adv Nutr, 2025 (CC BY 4.0)" },
  efsa2015: { id: "efsa2015", cite: "EFSA Panel on Dietetic Products, Nutrition and Allergies. Scientific opinion on the safety of caffeine. EFSA Journal, 2015" },
};

/** Типичное содержание кофеина в порции напитка (зависит от крепости и способа приготовления; ориентир). */
export interface Drink { key: string; name: string; ml: number; caffeine: number; kcal: number }
export const DRINKS: Drink[] = [
  { key: "espresso", name: "Эспрессо", ml: 30, caffeine: 63, kcal: 2 },
  { key: "coffee", name: "Кофе заварной, американо", ml: 200, caffeine: 95, kcal: 2 },
  { key: "instant", name: "Кофе растворимый", ml: 200, caffeine: 60, kcal: 2 },
  { key: "blackTea", name: "Чай чёрный", ml: 200, caffeine: 47, kcal: 1 },
  { key: "greenTea", name: "Чай зелёный", ml: 200, caffeine: 28, kcal: 1 },
  { key: "cola", name: "Кола", ml: 330, caffeine: 32, kcal: 139 },
  { key: "energy", name: "Энергетик", ml: 250, caffeine: 80, kcal: 112 },
  { key: "cocoa", name: "Какао на воде", ml: 200, caffeine: 10, kcal: 20 },
];

/** Предел кофеина в сутки, мг: взрослым 400, при беременности и кормлении 200 (EFSA, 2015); за один раз — 200. */
export const caffeineLimit = (pregnantOrLactating: boolean) => (pregnantOrLactating ? 200 : 400);
export const CAFFEINE_SINGLE = 200;

export const caffeineOf = (meals: Meal[]) => meals.reduce((s, m) => s + (m.caffeine || 0), 0);

export interface Hint { id: string; text: string; src: string[] }

/** Подсказки по сочетаниям на основе записей одного дня. Порог ниже — не истина в последней инстанции, а повод обратить внимание. */
export function interactionHints(meals: Meal[], opts: { caffeineLimit: number } = { caffeineLimit: 400 }): Hint[] {
  const out: Hint[] = [];
  const bySlot = new Map<MealSlot, Meal[]>();
  for (const m of meals) bySlot.set(m.slot, [...(bySlot.get(m.slot) || []), m]);
  for (const [slot, list] of bySlot) {
    const s = sumMeals(list);
    // Жирорастворимые витамины и каротиноиды — с жиром
    if ((s.vitA >= 300 || s.vitE >= 4 || s.vitK >= 60) && s.fat < 5) {
      out.push({ id: "fat-sol:" + slot, text: `В приёме «${slot}» много витаминов A, E или K, но почти нет жира. С чайной ложкой масла, сметаной или орехами они усвоятся лучше.`, src: ["white2017", "yao2023"] });
    }
  }
  // Кофеин
  const total = caffeineOf(meals);
  if (total > opts.caffeineLimit) out.push({ id: "caf-limit", text: `Кофеина ${Math.round(total)} мг — выше суточного предела ${opts.caffeineLimit} мг. Предел: взрослым 400 мг, при беременности и кормлении 200 мг.`, src: ["efsa2015"] });
  const single = Math.max(0, ...meals.map((m) => m.caffeine || 0));
  if (single > CAFFEINE_SINGLE) out.push({ id: "caf-single", text: `В одной записи ${Math.round(single)} мг кофеина — больше 200 мг за раз, чего лучше не превышать.`, src: ["efsa2015"] });
  if (total >= 300) out.push({ id: "caf-mineral", text: "Кофеин на несколько часов увеличивает выведение магния, кальция и натрия с мочой. Эффект небольшой (в исследованиях — единицы миллиграммов в сутки), но при большом количестве кофе следите за магнием и кальцием в рационе.", src: ["massey1984", "bergman1990", "kynast1994"] });
  return out;
}
