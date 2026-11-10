// Сочетания продуктов и усвоение нутриентов: кофеин. Железо — в iron.ts, цинк, кальций, магний — в minerals.ts, жирорастворимые витамины — в fatsoluble.ts.
// Правила опираются на опубликованные работы (список — SOURCES; обзор и ссылки — literature/nutrient-interactions/).
// Это подсказки к рациону, а не расчёт биодоступности: в справочнике состава нет данных о гемовом железе, фитатах и дубильных веществах.
import type { Meal } from "./types";

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
  shkembi2021ca: { id: "shkembi2021ca", cite: "Shkembi B., Huppertz T. Calcium absorption from food products: food matrix effects. Nutrients, 2021 (CC BY 4.0)" },
  shkembi2021zn: { id: "shkembi2021zn", cite: "Shkembi B., Huppertz T. Influence of dairy products on bioavailability of zinc from other food products: a review of complementarity at a meal level. Nutrients, 2021 (CC BY 4.0)" },
  groeber2015: { id: "groeber2015", cite: "Gröber U., Schmidt J., Kisters K. Magnesium in prevention and therapy. Nutrients, 2015 (CC BY 4.0)" },
  maares2020: { id: "maares2020", cite: "Maares M., Haase H. A guide to human zinc absorption: general overview and recent advances of in vitro intestinal models. Nutrients, 2020 (CC BY 4.0)" },
  reboul2017e: { id: "reboul2017e", cite: "Reboul E. Vitamin E bioavailability: mechanisms of intestinal absorption in the spotlight. Antioxidants, 2017 (CC BY 4.0)" },
  reboul2019: { id: "reboul2019", cite: "Reboul E. Mechanisms of carotenoid intestinal absorption: where do we stand? Nutrients, 2019 (CC BY 4.0)" },
  reboul2013: { id: "reboul2013", cite: "Reboul E. Absorption of vitamin A and carotenoids by the enterocyte: focus on transport proteins. Nutrients, 2013 (CC BY 3.0)" },
  bohn2017: { id: "bohn2017", cite: "Bohn T. и др. Host-related factors explaining interindividual variability of carotenoid bioavailability and tissue concentrations in humans. Mol Nutr Food Res, 2017 (CC BY 4.0)" },
  moran2017: { id: "moran2017", cite: "Moran N.E. и др. Closer to clarity on the effect of lipid consumption on fat-soluble vitamin and carotenoid absorption. Am J Clin Nutr, 2017 (комментарий к работе White W.S. и др.; только реферат)" },
  deng2024: { id: "deng2024", cite: "Deng J. и др. Efficacy of vitamin C with Fe supplementation in patients with iron deficiency anemia: a systematic review and meta-analysis. Blood Vessels Thromb Hemost, 2024 (10 РКИ, n = 1782: гемоглобин +0,14 г/дл, клинически малозначимо)" },
  nyakundi2026: { id: "nyakundi2026", cite: "Nyakundi P.N. и др. Does consuming ascorbate-rich fruits and fruit juices with meals improve iron bioavailability? Am J Clin Nutr, 2026 (15 РКИ, n = 1381: ферритин и гемоглобин растут, на всасывание железа эффекта почти нет)" },
  loganathan2023: { id: "loganathan2023", cite: "Loganathan V. и др. Treatment efficacy of vitamin C or ascorbate given as co-intervention with iron for anemia: a systematic review and meta-analysis. Clin Nutr ESPEN, 2023 (n = 905: значимой разницы нет, качество доказательств очень низкое)" },
  hallstrom2013: { id: "hallstrom2013", cite: "Hallström H. и др. Long-term coffee consumption in relation to fracture risk and bone mineral density in women. Am J Epidemiol, 2013 (когорта, 61 433 женщины, 22 года: переломы не чаще; при ≥4 чашках плотность кости на 2–4% ниже)" },
  hallstrom2014: { id: "hallstrom2014", cite: "Hallström H. и др. Coffee consumption and risk of fracture in the Cohort of Swedish Men (COSM). PLoS ONE, 2014 (42 978 мужчин: связи с переломами нет)" },
  yuan2019: { id: "yuan2019", cite: "Yuan S., Larsson S.C. Associations of smoking and alcohol and coffee intake with fracture and bone mineral density: a Mendelian randomization study. Calcif Tissue Int, 2019 (UK Biobank, 53 184 случая переломов, 426 824 человека: связи кофе с переломами и плотностью нет)" },
  hansen2000: { id: "hansen2000", cite: "Hansen S.A. и др. Association of fractures with caffeine and alcohol in postmenopausal women: the Iowa Women's Health Study. Public Health Nutr, 2000 (34 703 женщины: слабое повышение риска при самом высоком потреблении кофеина, зависит от кости)" },
  dai2015: { id: "dai2015", cite: "Dai Z. и др. Caffeine, coffee and tea in relation to risk of hip fracture in the Singapore Chinese Health Study. FASEB J, 2015 (63 257 человек: ≥3 чашек в день — риск перелома бедра выше; 2 чашки у женщин — ниже; тезисы конференции)" },
  abioye2020: { id: "abioye2020", cite: "Abioye A.I. и др. Calcium intake and iron status in human studies: a systematic review and dose-response meta-analysis of randomized trials and crossover studies. J Nutr, 2020 (в одном приёме пищи кальций снижает всасывание железа на ≈5,6 п.п.; на гемоглобин эффекта нет, ферритин снижается умеренно)" },
  grinder2004: { id: "grinder2004", cite: "Grinder-Pedersen L. и др. Calcium from milk or calcium-fortified foods does not inhibit nonheme-iron absorption from a whole diet consumed over a 4-d period. Am J Clin Nutr, 2004 (рандомизированное перекрёстное, 14 женщин)" },
  hennigar2015: { id: "hennigar2015", cite: "Hennigar S.R. и др. Consumption of a calcium and vitamin D-fortified food product does not affect iron status during initial military training. Br J Nutr, 2015 (РКИ, 152 человека, 2000 мг кальция в день, 9 недель)" },
  ali2026: { id: "ali2026", cite: "Ali N.B. и др. Effect of calcium supplementation in pregnancy on maternal anemia and iron status: secondary analyses of two randomized trials in India and Tanzania. Am J Clin Nutr, 2026 (два РКИ, ≈11 000 в каждом; 500 против 1500 мг кальция — разницы по гемоглобину и анемии нет, кальций принимали отдельно от железа)" },
  belserrat2014: { id: "belserrat2014", cite: "Bel-Serrat S. и др. Factors that affect zinc bioavailability and losses in adult and elderly populations. Nutr Rev, 2014 (систематический обзор 87 работ; при молярном отношении фитат:цинк > 15 усвоение цинка снижается до 45% от контроля)" },
  niklewicz2024: { id: "niklewicz2024", cite: "Niklewicz A. и др. A systematic review and meta-analysis of functional vitamin B12 status among adult vegans. Nutr Bull, 2024 (мета-анализ 17 исследований: у веганов ниже B12 в крови и выше гомоцистеин; добавки улучшают все показатели)" },
  neufingerl2021: { id: "neufingerl2021", cite: "Neufingerl N., Eilander A. Nutrient intake and status in adults consuming plant-based diets compared to meat-eaters: a systematic review. Nutrients, 2022 (141 исследование: потребление и статус B12 ниже при растительном питании, у веганов самые низкие)" },
  pawlak2013: { id: "pawlak2013", cite: "Pawlak R. и др. How prevalent is vitamin B12 deficiency among vegetarians? Nutr Rev, 2013 (обзор 18 работ с точными маркерами: дефицит у вегетарианцев в любых группах, у веганов чаще)" },
  efsa2015: { id: "efsa2015", cite: "EFSA Panel on Dietetic Products, Nutrition and Allergies. Scientific opinion on the safety of caffeine. EFSA Journal, 2015" },
};

/**
 * Вес доказательств: чем крупнее и строже исследование, тем больше ему доверяем.
 * A — регуляторное заключение или мета-анализ/РКИ с n ≥ 1000; B — РКИ n ≥ 100, мета-анализ многих малых исследований или большое наблюдательное (n ≥ 10 000);
 * C — небольшие контролируемые исследования (n < 100), обзоры, мнения; D — механизм (клетки, модели), баз данных.
 */
export type Design = "regulatory" | "meta-small" | "meta-rct" | "rct" | "cohort" | "small-trial" | "review" | "mechanism";
export type Level = "A" | "B" | "C" | "D";
export interface Evidence { design: Design; n?: number }
export function levelOf(e: Evidence): Level {
  const n = e.n ?? 0;
  switch (e.design) {
    case "regulatory": return "A";
    case "meta-rct": case "rct": return n >= 1000 ? "A" : n >= 100 ? "B" : "C";
    case "meta-small": return "B"; // мета-анализ многих небольших контролируемых исследований
    case "cohort": return n >= 10000 ? "B" : "C";
    case "small-trial": case "review": return "C";
    default: return "D";
  }
}
export const EVIDENCE: Record<string, Evidence> = {
  heffernan2017: { design: "meta-rct", n: 315 }, // изотопные приёмы пищи; долгие испытания n = 118
  deng2024: { design: "meta-rct", n: 1782 },
  nyakundi2026: { design: "meta-rct", n: 1381 },
  loganathan2023: { design: "meta-rct", n: 905 },
  milman2020: { design: "review" }, chondrou2024: { design: "review" }, piskin2022: { design: "review" },
  prentice2017: { design: "review" }, weaver2025: { design: "review" }, shkembi2021ca: { design: "review" }, shkembi2021zn: { design: "review" },
  groeber2015: { design: "review" }, bohn2017: { design: "review" }, moran2017: { design: "review" },
  white2017: { design: "small-trial", n: 29 }, yao2023: { design: "small-trial" },
  massey1984: { design: "small-trial" }, bergman1990: { design: "small-trial" }, kynast1994: { design: "small-trial" },
  decarli2018: { design: "cohort" }, dahdouh2019: { design: "mechanism" }, maares2020: { design: "mechanism" },
  reboul2017e: { design: "mechanism" }, reboul2019: { design: "mechanism" }, reboul2013: { design: "mechanism" },
  hallstrom2013: { design: "cohort", n: 61433 }, hallstrom2014: { design: "cohort", n: 42978 }, yuan2019: { design: "cohort", n: 426824 },
  hansen2000: { design: "cohort", n: 34703 }, dai2015: { design: "cohort", n: 63257 },
  abioye2020: { design: "meta-small" }, belserrat2014: { design: "meta-small" },
  grinder2004: { design: "rct", n: 14 }, hennigar2015: { design: "rct", n: 152 }, ali2026: { design: "rct", n: 19000 },
  niklewicz2024: { design: "meta-small" }, neufingerl2021: { design: "meta-small" }, pawlak2013: { design: "review" },
  efsa2015: { design: "regulatory" },
};
export const sourceLevel = (id: string): Level => levelOf(EVIDENCE[id] ?? { design: "mechanism" });
const RANK: Record<Level, number> = { A: 0, B: 1, C: 2, D: 3 };
/** Самый сильный уровень среди источников подсказки. */
export const hintLevel = (src: string[]): Level => src.map(sourceLevel).sort((a, b) => RANK[a] - RANK[b])[0] ?? "D";

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
  // Кофеин
  const total = caffeineOf(meals);
  if (total > opts.caffeineLimit) out.push({ id: "caf-limit", text: `Кофеина ${Math.round(total)} мг — выше суточного предела ${opts.caffeineLimit} мг. Предел: взрослым 400 мг, при беременности и кормлении 200 мг.`, src: ["efsa2015"] });
  const single = Math.max(0, ...meals.map((m) => m.caffeine || 0));
  if (single > CAFFEINE_SINGLE) out.push({ id: "caf-single", text: `В одной записи ${Math.round(single)} мг кофеина — больше 200 мг за раз, чего лучше не превышать.`, src: ["efsa2015"] });
  if (total >= 400) out.push({ id: "caf-mineral", text: "Кофеин на несколько часов увеличивает выведение магния, кальция и натрия с мочой. Эффект небольшой (единицы миллиграммов в сутки). В крупных когортах (десятки тысяч человек) кофе не повышал риск переломов; при ≥4 чашках плотность кости была на 2–4% ниже. Внимательнее быть при малом кальции в рационе.", src: ["hallstrom2013", "hallstrom2014", "yuan2019", "massey1984", "bergman1990", "kynast1994"] });
  return out;
}
