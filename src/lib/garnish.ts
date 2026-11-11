// Гарниры к основным блюдам: когда нужен и какие подходят. Чистая логика.
// Правила: к супам, завтракам, салатам гарнир не нужен; к жареному мясу, птице, рыбе и котлетам — обязателен; к остальным основным блюдам — по умолчанию,
// кроме тех, где крахмал уже есть в самом блюде (плов, пельмени, тушёная картошка): там только овощной гарнир и по желанию.
import type { Recipe, Slot } from "./types";
import { gramsOf } from "./recipeNutrition";
import { norm } from "./util";

export type GClass = "рис" | "гречка" | "макароны" | "картофель" | "булгур" | "кускус" | "пшено" | "перловка" | "полента" | "овощи" | "бобовые";
/** «Настоящие» гарниры — крупы, картофель, макароны, полента. Овощи и бобовые — дополнение: сами подбираются только если больше ничего нет, но в выборе доступны. */
export const STARCHY: GClass[] = ["рис", "гречка", "макароны", "картофель", "булгур", "кускус", "пшено", "перловка", "полента"];
export const isGarnish = (r: Recipe) => norm(r.kind || "") === "гарнир";

const w = (src: string) => new RegExp("(?<![а-яё])(" + src + ")", "i");
const CLASSES: [GClass, RegExp][] = [
  ["рис", w("рис")],
  ["гречка", w("гречк|гречнев")],
  ["макароны", w("макарон|спагетти|вермишел|лапш|паста")],
  ["картофель", w("картоф|картошк|пюре")],
  ["булгур", w("булгур")],
  ["кускус", w("кускус")],
  ["пшено", w("пшён|пшен")],
  ["перловка", w("перлов")],
  ["полента", w("полент")],
  ["бобовые", w("чечевиц|фасоль(?! стручк)|нут|горох")],
  ["овощи", w("овощ|брокколи|капуст|кабач|морков|стручков|свёкл|свекл|тыкв|баклажан|перц")],
];
/** Вид гарнира по названию; null — не определён. */
export function garnishClass(r: Recipe): GClass | null {
  const n = r.name;
  return CLASSES.find(([, re]) => re.test(n))?.[0] ?? null;
}

export type Need = "none" | "optional" | "default" | "required";
export type MainKind = "complete" | "fish" | "fried" | "other";

const POTATO = w("картоф|картошк");
const GRAIN = w("рис|макарон|вермишел|лапш|гречк|гречнев|булгур|пшен|пшён|перлов|кускус|спагетти|пенне|феттучине|фузилли|тальятелле|лингвини|ньокк");
const COMPLETE_NAME = w("пенне|феттучине|фузилли|тальятелле|лингвини|ньокки|с рисом|с гречк|с макарон|с булгур|с пшен|с кускус|с перловк|плов|пельмен|вареник|пицц|лазань|голубц|запеканк|рагу|жаркое|хинкали|манты|чебурек|ризотто|паста|спагетти|макарон|каша|оладь|блин|сырник|пирог|пирожк|картоф|картошк|кулебяк|чахохбили|долм|фаршированн|пюре|лобио|рамен|ботвинь");
const FRIED = w("жарен|жарк|отбивн|котлет|шницель|бифштекс|стейк|эскалоп|медальон|гриль|тефтел|биточк|купат|шашлык|на сковороде|сосиск|печень|печён|крылья|окорочк|лангет|зразы|наггетс|кляр|табака");
const FISH = w("минтай|камбал|лосос|скумбр|сельд|рыб|судак|карп|щук|мойв|сайр|треск|форел|горбуш|сёмг|семг|кревет|кальмар|мидии|тунец");

/** Сколько крахмалистого в одной порции блюда, г (сырого): картофель отдельно от круп и макарон. */
function starchPerServing(r: Recipe): { potato: number; grain: number } {
  const k = Math.max(1, r.servings || 2);
  let potato = 0, grain = 0;
  for (const i of r.ingredients) {
    const g = gramsOf(i) || 0;
    if (POTATO.test(i.name)) potato += g; else if (GRAIN.test(i.name)) grain += g;
  }
  return { potato: potato / k, grain: grain / k };
}
function isMainRole(r: Recipe, slot: Slot): boolean {
  if (slot === "завтрак") return false;
  const kind = norm(r.kind || "");
  return kind === "основное" || kind === "обед" || kind === "ужин";
}

const kindMemo = new WeakMap<Recipe, MainKind>();
/** Какого вида основное блюдо с точки зрения гарнира (результат запоминается: расчёт состава дорогой). */
export function mainKind(r: Recipe): MainKind {
  let k = kindMemo.get(r);
  if (!k) { k = mainKindNow(r); kindMemo.set(r, k); }
  return k;
}
function mainKindNow(r: Recipe): MainKind {
  const head = r.name + " " + (r.tags || []).join(" ");
  const st = starchPerServing(r);
  if (COMPLETE_NAME.test(r.name) || st.potato >= 120 || st.grain >= 45) return "complete";
  if (FISH.test(r.name)) return "fish";
  if (FRIED.test(head)) return "fried";
  return "other";
}

/** Нужен ли гарнир: none — нет (суп, завтрак, салат и т. п.); required — обязателен (жареное, птица, рыба, котлеты); default — по умолчанию; optional — по желанию (в блюде уже есть крахмал). */
export function garnishNeed(r: Recipe, slot: Slot): Need {
  if (isGarnish(r) || !isMainRole(r, slot)) return "none";
  const k = mainKind(r);
  if (k === "complete") return "optional";
  if (k === "fried" || k === "fish") return "required";
  return "default";
}

const ALL: GClass[] = ["рис", "гречка", "макароны", "картофель", "булгур", "кускус", "пшено", "перловка", "полента", "овощи", "бобовые"];
const FIT: Record<MainKind, GClass[]> = {
  complete: ["овощи"],
  fish: ["рис", "картофель", "кускус", "булгур", "полента", "овощи"],
  fried: ALL.filter((c) => c !== "кускус"),
  other: ALL,
};

/** Подходит ли гарнир к основному блюду. */
export function garnishFits(main: Recipe, g: Recipe): boolean {
  if (!isGarnish(g)) return false;
  const c = garnishClass(g);
  return !!c && FIT[mainKind(main)].includes(c);
}

/** Гарниры из списка, подходящие к блюду. */
export const suitableGarnishes = (main: Recipe, recipes: Recipe[]) => recipes.filter((g) => garnishFits(main, g));

export const isStarchy = (g: Recipe) => STARCHY.includes(garnishClass(g) as GClass);
/** Что подставлять само (автоподбор меню, «Заполнить»): подходящие «настоящие» гарниры; овощные — только если крахмалистых к блюду нет. */
export function autoGarnishes(main: Recipe, recipes: Recipe[]): Recipe[] {
  const all = suitableGarnishes(main, recipes);
  const starchy = all.filter(isStarchy);
  return starchy.length ? starchy : all;
}

/** Порядок гарниров в выборе: крупы, картофель и макароны выше овощных; внутри группы сверху те, для которых продукты есть дома (сначала спасающие продукты с истекающим сроком, потом по доле имеющегося), затем по названию. */
export function orderByHome<T extends { g: Recipe; s: { urgent: number; percent: number } }>(rows: T[]): T[] {
  // Сначала крупы, картофель, макароны; потом овощные гарниры. Внутри группы — что есть дома
  const grp = (r: Recipe) => (isStarchy(r) ? 0 : 1);
  return [...rows].sort((a, b) => grp(a.g) - grp(b.g) || b.s.urgent - a.s.urgent || b.s.percent - a.s.percent || a.g.name.localeCompare(b.g.name, "ru"));
}
