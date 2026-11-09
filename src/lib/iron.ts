// Железо: что усиливает и что мешает усвоению в приёме пищи. Этап 1 программы биодоступности
// (literature/nutrient-interactions/COVERAGE.md). Это качественная оценка «лучше / обычно / хуже», а не расчёт процента:
// опубликованные алгоритмы (Hallberg и Hulthén, 2000; Reddy и др., 2000) закрыты, расходятся между собой и
// недооценивают усвоение (Beard и др., 2007; De Carli и др., 2018), поэтому точных коэффициентов в приложении нет.
//
// Степень надёжности разметки (A–D, см. COVERAGE.md):
//   B — направление эффекта подтверждено обзорами и исследованиями на людях (мясо, рыба, яйца, молочное, чай/кофе/какао, бобовые);
//   C — общая категория продукта без точных данных (крупы, хлеб, орехи, овощи, фрукты);
//   D — данных нет: продукт не учитывается.
import type { CatalogItem, Meal, Recipe } from "./types";
import { findCatalog } from "./catalog";
import { gramsOf } from "./recipeNutrition";
import type { Hint } from "./interactions";
import { sumMeals } from "./diary";

export type IronFlag = "alcohol" | "meat" | "fish" | "organ" | "egg" | "dairy" | "legume" | "soy" | "nuts" | "grain" | "polyphenol";
export type Grade = "B" | "C" | "D";
export interface FoodIron { flags: IronFlag[]; grade: Grade; via: "name" | "category" | "none" }

const w = (src: string) => new RegExp("(?<![а-яё])(" + src + ")", "i");
// Слова — начала русских слов; перед словом не должно быть буквы, чтобы «сыр» не находился в «пастернак»
const RULES: { flag: IronFlag; re: RegExp; grade: Grade }[] = [
  { flag: "organ", re: w("печен|почк|сердц|язык|субпродукт|лёгк|легк|рубец"), grade: "B" },
  { flag: "meat", re: w("говя|свин|баран|телят|кролик|кури|кура(?![а-яё])|индейк|утк|утка|гус|мяс|фарш|ветчин|колбас|сосиск|бекон|грудин|окорок|шея|вырезк|стейк|котлет|тефтел|пельмен|голубц|азу(?![а-яё])|донер|манты(?![а-яё])|самс|чебурек|хинкал|беляш|фаршир|тушёнк|тушенк|фрикадел|биточ|шницел|бифштекс|люля|рёбрышк|ребрышк|гуляш|бефстроган|паштет|цыплён|цыплен|медальон|купат|лангет|зраз|шашлык|кебаб|шаурм|гамбургер|сардельк|буженин|карбонад|холодец|тефтел"), grade: "B" },
  { flag: "fish", re: w("рыб|лосос|форел|сёмг|семг|сельд|скумбр|треск|минта|хек(?![а-яё])|тунец|тунц|сардин|кальмар|креветк|мидии|мидий|морепрод|краб|карп|щук|судак|окун|горбуш|кета(?![а-яё])|шпрот|сайр|иваси|анчоус|икр|кильк|салак|шпроты"), grade: "B" },
  { flag: "egg", re: w("яйц|яичн|омлет"), grade: "B" },
  { flag: "dairy", re: w("молок|молоч|сыр(?![а-яё])|сыра(?![а-яё])|сыры(?![а-яё])|сырн|сырок|сырк|творог|творож|кефир|йогурт|ряженк|сливк|сметан|брынз|моцарел|пармезан|рикотт|простокваш|сгущ"), grade: "B" },
  { flag: "soy", re: w("со[ея]в|тофу|соя(?![а-яё])|темпе"), grade: "B" },
  { flag: "legume", re: w("фасол|чечевиц|нут(?![а-яё])|горох|горош|маш(?![а-яё])|бобы|бобов|хумус"), grade: "B" },
  { flag: "polyphenol", re: w("чай|чая(?![а-яё])|кофе|какао|шоколад|матча|мате(?![а-яё])"), grade: "B" },
  // Алкоголь по обзору Milman (2020) повышает усвоение железа, но в оценке и подсказках не используется: рекомендовать алкоголь нельзя
  { flag: "alcohol", re: w("вино|вина(?![а-яё])|пиво|водк|коньяк|виски|ликёр|ликер|вермут|шампанск|портвейн|херес|саке(?![а-яё])|самогон|абсент|настойк|наливк|асти(?![а-яё])|каберне|игристое|ром(?![а-яё])|джин(?![а-яё])|текил"), grade: "B" },
  { flag: "nuts", re: w("орех|миндал|фундук|кешью|фисташ|арахис|семеч|кунжут|тахин|лён|льня|лен(?![а-яё])|чиа|мак(?![а-яё])|подсолнеч[а-я]* семен|семена"), grade: "C" },
  { flag: "grain", re: w("цельнозерн|отруб|овсян|овёс|ржан|гречк|гречнев|пшено|булгур|перловк|ячмен|пшениц|мюсли|гранол|хлопья|кукуруз"), grade: "C" },
];

// Категории справочника, где без названия понятно, что это
const CATEGORY: Record<string, { flags: IronFlag[]; grade: Grade }> = {
  "Мясо": { flags: ["meat"], grade: "B" },
  "Птица": { flags: ["meat"], grade: "B" },
  "Рыба": { flags: ["fish"], grade: "B" },
  "Молочное": { flags: ["dairy"], grade: "B" },
  "Яйца": { flags: ["egg"], grade: "B" },
  "Орехи и семечки": { flags: ["nuts"], grade: "C" },
  "Крупы": { flags: ["grain"], grade: "C" },
  "Хлеб": { flags: ["grain"], grade: "C" },
  "Овощи": { flags: [], grade: "C" },
  "Фрукты": { flags: [], grade: "C" },
  "Зелень": { flags: [], grade: "C" },
  // Специи кладут граммами: на железо заметно не влияют (степень C: вывод по количеству, исследований нет)
  "Специи": { flags: [], grade: "C" },
};
// Продукты, не влияющие на усвоение железа заметно: масла, сахар, соль, сладости, соки, специи, соусы (граммы или чистые жиры и сахара).
// Степень C: «не влияет» — вывод по составу (нет ни железа, ни веществ, меняющих его усвоение), отдельных исследований нет.
const NEUTRAL = w("масл|сахар|соль(?![а-яё])|соли(?![а-яё])|уксус|сода(?![а-яё])|крахмал|разрыхл|желатин|мёд(?![а-яё])|мед(?![а-яё])|варень|джем|конфет|мармелад|пастил|сироп|лимонн[а-я]* кислот|сок(?![а-яё])|сока(?![а-яё])|соки(?![а-яё])|нектар|морс|компот|лимонад|квас|вода(?![а-яё])|воды(?![а-яё])|воду(?![а-яё])|лёд(?![а-яё])|специ|перец|лавров|паприк|карри|зира|корица|ванил|гвоздик|кориандр|имбир|куркум|мускат|шафран|орегано|базилик|тимьян|розмарин|укроп|петрушк|кетчуп|майонез|горчиц|хрен(?![а-яё])|соус|оливк|каперс|мука(?![а-яё])|муку(?![а-яё])|муки(?![а-яё])|сухар|панировк|дрожж|кокос|сливочн[а-я]* масл|топлён|жир(?![а-яё])|сало(?![а-яё])|мороженое|пломбир|сорбет|халва|шоколадн[а-я]* паст|зефир|печень[а-я]* песочн");
// Масло сливочное и подобное — молочные жиры без кальция и белка: на железо не влияют
const NOT_DAIRY = w("масл");

/** Железные свойства продукта по названию (без учёта количества). */
export function foodIron(name: string, cat?: CatalogItem | null): FoodIron {
  const flags = new Set<IronFlag>();
  let grade: Grade = "D";
  let via: FoodIron["via"] = "none";
  const bump = (g: Grade) => { if (grade === "D" || (grade === "C" && g === "B")) grade = g; };
  for (const r of RULES) {
    if (r.flag === "dairy" && NOT_DAIRY.test(name)) continue;
    if (r.re.test(name)) { flags.add(r.flag); bump(r.grade); via = "name"; }
  }
  const c = cat === undefined ? findCatalog(name) : cat;
  const cc = c ? CATEGORY[c.c] : undefined;
  if (cc) {
    let applied = false;
    for (const f of cc.flags) {
      if (f === "dairy" && NOT_DAIRY.test(name)) continue;
      flags.add(f); applied = true;
    }
    if (via === "none") via = "category";
    // Категория без флагов (овощи, фрукты) или исключение (сливочное масло): влияния на железо нет, но продукт учтён
    bump(applied || cc.flags.length === 0 ? cc.grade : "C");
  }
  if (flags.has("organ")) flags.add("meat");
  // Явно нейтральный продукт без других признаков: влияния на железо нет, но он учтён
  if (!flags.size && NEUTRAL.test(name)) { grade = grade === "D" ? "C" : grade; via = via === "none" ? "name" : via; }
  return { flags: [...flags], grade, via };
}

export interface IronContext { recipes: Recipe[] }
interface Part { name: string; grams: number; food: FoodIron }

/** Состав приёма пищи по продуктам, насколько он известен: из рецепта, из продукта справочника, из напитка. */
export function mealParts(m: Meal, ctx: IronContext): Part[] {
  if (m.recipeId) {
    const r = ctx.recipes.find((x) => x.id === m.recipeId);
    if (!r) return [];
    const eaten = m.servings ?? 1;
    const frac = eaten / Math.max(1, r.servings || 2);
    return r.ingredients.map((i) => ({ name: i.name, grams: (gramsOf(i) || 0) * frac, food: foodIron(i.name) }));
  }
  const g = m.qty?.match(/^(\d+(?:[.,]\d+)?)\s*(г|мл)/);
  const grams = g ? Number(g[1].replace(",", ".")) : 0;
  return [{ name: m.name, grams, food: foodIron(m.name) }];
}

export type IronLevel = "better" | "usual" | "worse";
export interface IronMeal {
  slot: string;
  /** Железа в приёме, мг. */
  mg: number;
  level: IronLevel;
  /** Что усиливает усвоение, что мешает — словами. */
  enhancers: string[];
  inhibitors: string[];
  /** Наихудшая степень надёжности среди учтённых факторов (A–D; для железа — не выше B). */
  grade: Grade;
  /** Доля веса приёма, для которой удалось определить продукты (0–1); без неё оценка неполная. */
  known: number;
}

// Пороги — эвристика приложения (степень C). Источник направления эффекта указан в SOURCES (interactions.ts).
export const IRON_MIN_MG = 1.5; // меньше — приём пищи не оцениваем: железа мало, вывод бессмысленен
export const MEAT_ENHANCER_G = 50; // 50 г мяса, рыбы или птицы в приёме заметно усиливают усвоение негемового железа (Piskin и др., 2022)
export const VITC_ENHANCER_MG = 50; // витамин C ≥ 50 мг в приёме; эффект зависит от дозы
export const CALCIUM_INHIBITOR_MG = 300; // кальций ≥ 300 мг в приёме (в исследовании 500 мг снижали усвоение с 10,2% до 4,8%)
export const PHYTATE_INHIBITOR_G = 30; // бобовые, орехи, цельные крупы ≥ 30 г сырого веса в приёме

/** Оценка приёма пищи (одного или нескольких блюд одного слота) по железу. null — железа слишком мало. */
export function analyzeIron(slot: string, meals: Meal[], ctx: IronContext): IronMeal | null {
  const s = sumMeals(meals);
  const mg = s.fe;
  if (mg < IRON_MIN_MG) return null;
  const parts = meals.flatMap((m) => mealParts(m, ctx));
  const totalG = parts.reduce((a, p) => a + p.grams, 0);
  const knownG = parts.filter((p) => p.food.grade !== "D").reduce((a, p) => a + p.grams, 0);
  const sum = (flag: IronFlag) => parts.filter((p) => p.food.flags.includes(flag)).reduce((a, p) => a + p.grams, 0);
  const has = (flag: IronFlag) => parts.some((p) => p.food.flags.includes(flag));
  const meatG = sum("meat") + sum("fish");
  const enh: string[] = [], inh: string[] = [];
  let grade: Grade = "B";
  if (meatG >= MEAT_ENHANCER_G) enh.push("мясо или рыба");
  if (s.vitC >= VITC_ENHANCER_MG) enh.push("витамин C");
  // Напитки с кофеином и полифенолами в том же приёме
  const poly = has("polyphenol") || meals.some((m) => (m.caffeine || 0) > 0 && /чай|кофе|эспрессо|какао/i.test(m.name));
  if (poly) inh.push("чай, кофе или какао");
  if (s.ca >= CALCIUM_INHIBITOR_MG) { inh.push("кальций (молочное)"); grade = "C"; }
  if (sum("legume") + sum("soy") + sum("nuts") + sum("grain") >= PHYTATE_INHIBITOR_G) { inh.push("фитаты (бобовые, орехи, цельные крупы)"); grade = "C"; }
  // Яйца и молочный белок тоже мешают (Hallberg и Hulthén, 2000; Milman, 2020), но слабо и без порога — в итоговый уровень не входят
  // Усилители и помехи не сокращают друг друга: чай рядом с мясом всё равно снижает усвоение — поэтому «смешанный» приём = «обычное»
  const level: IronLevel = enh.length && !inh.length ? "better" : inh.length && !enh.length ? "worse" : "usual";
  return {
    slot, mg, level, enhancers: enh, inhibitors: inh, grade,
    known: totalG ? Math.min(1, knownG / totalG) : parts.length ? 1 : 0,
  };
}

const fmt = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
export const LEVEL_TEXT: Record<IronLevel, string> = { better: "усвоится лучше обычного", usual: "усвоение обычное", worse: "усвоится хуже обычного" };

/** Подсказки по железу на день: только там, где есть что улучшить или о чём предупредить. */
export function ironHints(meals: Meal[], ctx: IronContext): Hint[] {
  const bySlot = new Map<string, Meal[]>();
  for (const m of meals) bySlot.set(m.slot, [...(bySlot.get(m.slot) || []), m]);
  const out: Hint[] = [];
  for (const [slot, list] of bySlot) {
    const r = analyzeIron(slot, list, ctx);
    if (!r) continue;
    const head = `Приём «${slot}»: железа ${fmt(r.mg)} мг`;
    if (r.inhibitors.some((x) => x.startsWith("чай"))) out.push({ id: `iron-tea:${slot}`, text: `${head}. Чай, кофе или какао в этом же приёме снижают усвоение железа (полифенолы, дубильные вещества) — даже если есть мясо. Лучше пить между приёмами пищи.`, src: ["milman2020", "piskin2022"] });
    if (r.inhibitors.some((x) => x.startsWith("кальций"))) out.push({ id: `iron-ca:${slot}`, text: `${head}. Много кальция (молочное) в одном приёме с железом снижает его усвоение. Молочное лучше отдельно от мяса, печени и бобовых.`, src: ["milman2020", "piskin2022"] });
    if (r.inhibitors.some((x) => x.startsWith("фитаты"))) out.push({ id: `iron-phytate:${slot}`, text: `${head}. Бобовые, орехи и цельные крупы содержат фитаты, которые снижают усвоение железа и цинка. Помогают замачивание, проращивание, ферментация (закваска) и витамин C рядом.`, src: ["chondrou2024", "dahdouh2019"] });
    if (!r.enhancers.length && !r.inhibitors.length) out.push({ id: `iron-c:${slot}`, text: `${head}, но без витамина C и мяса. Свежий перец, цитрусовые, квашеная капуста или зелень рядом помогут усвоению растительного железа.`, src: ["heffernan2017", "piskin2022"] });
  }
  return out;
}

/** Оценки по всем приёмам дня — для отдельной строки «Железо» в дневнике. */
export function ironDay(meals: Meal[], ctx: IronContext): IronMeal[] {
  const bySlot = new Map<string, Meal[]>();
  for (const m of meals) bySlot.set(m.slot, [...(bySlot.get(m.slot) || []), m]);
  return [...bySlot].map(([slot, list]) => analyzeIron(slot, list, ctx)).filter((x): x is IronMeal => !!x);
}
