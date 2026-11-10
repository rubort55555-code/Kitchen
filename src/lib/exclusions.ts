// Исключения в питании: «никогда», «только немного», «можно».
// Правила применяются к продуктам, рецептам и ответам Claude.
import type { CatalogItem, Member, Recipe, Rule } from "./types";
import { allCatalog } from "./catalog";
import { norm, uid } from "./util";

export const DEFAULT_RULES: Rule[] = [
  {
    id: "r-holodets", title: "Холодец", level: "never", who: "all",
    words: ["холодец", "холодц", "студень", "студн", "заливное из мяса", "мясное заливное", "заливное из говядины",
      "заливное из свинины", "заливное из курицы", "заливное из языка", "заливное из свиных"],
  },
  {
    id: "r-whitefish", title: "Белая морская рыба", level: "never", who: "all", fishType: "white_sea",
    words: ["белая рыба", "белой рыбы", "белую рыбу", "белой рыбой"],
    except: ["камбала", "минтай"], replace: "минтай",
  },
  {
    id: "r-seeds", title: "Подсолнечные семечки", level: "little", who: "all", limitTbsp: 2,
    words: ["семечк", "семечек", "семена подсолнечника", "подсолнечные семена", "семечки подсолнечника", "подсолнечных семечек", "семян подсолнечника"],
    except: ["тыквенн", "кунжут", "льнян", "чиа"],
  },
];

/** Основа слова: «треска» → «треск», чтобы находить «трески», «треской». */
function stem(w: string): string {
  const s = norm(w);
  if (s.includes(" ")) return s.split(" ").map(stem).join(" ");
  return s.length > 3 && /[аяыиоеуюйь]$/.test(s) ? s.slice(0, -1) : s;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Короткие слова похожи на начало чужих: «мёд» — «медленно», «мак» — «макароны» и «макать», «чай» — «чайник», «кета» — «кетчуп».
 *  Поэтому после короткой основы допускаем только падежное окончание («мёдом», «рыбой») или прилагательное («медовый», «рыбный»),
 *  а два неустранимых так совпадения перечислены явно: «сырой» (не сыр) и «чайная ложка» (не чай). */
const SHORT = 4;
const ADJ = "(ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ыми|ими|ых|их|ую|юю|ом|ем|ей)";
const NOUN = "(а|я|у|ю|ы|и|е|о|ь|й|ой|ей|ом|ем|ам|ям|ах|ях|ами|ями|ов|ев)";
const ENDING = `(${NOUN}|${ADJ}|(ов|ев|н)${ADJ})?(?![а-я])`;
const FALSE_FRIENDS: Record<string, string> = {
  "сыр": "(?!(ой|ая|ое|ые|ого|ому|ым|ыми|ых|ую)(?![а-я]))",
  "чай": "(?!н[а-я]*\\s+лож)",
  "сельд": "(?!ере)", // сельдерей
  "треск": "(?!а(е|ю|л|ть))", // «корочка трескается»
};
function wordRe(w: string): RegExp {
  const st = stem(w);
  if (!st.includes(" ") && st.length <= SHORT) return new RegExp("(^|[^а-я])" + esc(st) + (FALSE_FRIENDS[st] || "") + ENDING, "i");
  // Слова внутри фразы могут иметь любые окончания: «морского окуня» = «морской окунь».
  const parts = st.split(" ").map((p) => esc(p) + (FALSE_FRIENDS[p] || "") + "[а-я]*");
  return new RegExp("(^|[^а-я])" + parts.join("\\s+"), "i");
}

export interface RuleWord { rule: Rule; word: string; re: RegExp; ex: RegExp[] }

/** Готовит список слов для поиска с учётом справочника (тип рыбы) и людей. */
let compiledMemo: { rules: Rule[]; custom: CatalogItem[]; members: Member[]; res: { words: RuleWord[] } } | null = null;
/** Правила в удобном для проверки виде. Повторный вызов с теми же настройками отдаёт готовый результат (нужно для кэша проверок). */
export function compileRules(rules: Rule[], custom: CatalogItem[], members: Member[]): { words: RuleWord[] } {
  if (compiledMemo && compiledMemo.rules === rules && compiledMemo.custom === custom && compiledMemo.members === members) return compiledMemo.res;
  const res = compileRulesNow(rules, custom, members);
  compiledMemo = { rules, custom, members, res };
  return res;
}
function compileRulesNow(rules: Rule[], custom: CatalogItem[], members: Member[]): { words: RuleWord[] } {
  const words: RuleWord[] = [];
  const all = rules.concat(memberRules(members));
  for (const r of all) {
    if (r.level === "ok") continue;
    const list = new Set(r.words.map(norm).filter(Boolean));
    if (r.fishType || r.anyFish) {
      for (const it of allCatalog(custom)) {
        if (r.anyFish ? !it.f : it.f !== r.fishType) continue;
        if ((r.except || []).some((e) => norm(e) === norm(it.n))) continue;
        // «Молоки» (рыбные) одним словом не берём: основа та же, что у молока
        for (const w of [it.n, ...(it.s || [])].map(norm)) if (!/^молок[а-я]*$/.test(w)) list.add(w);
      }
    }
    // Для рыбы исключения уже убраны из списка слов; для остальных — «тыквенные семечки» не считаются.
    const ex = r.fishType ? [] : (r.except || []).map(wordRe);
    for (const w of list) words.push({ rule: r, word: w, re: wordRe(w), ex });
  }
  return { words };
}

/** Группы аллергенов: человек пишет «молоко» — скрываем и сыр, и сметану, и сливочное масло.
 *  Состав групп — основные пищевые аллергены (ТР ТС 022/2011, п. 4.4.14): молоко, яйца, рыба, ракообразные и моллюски, орехи, арахис, соя, злаки с глютеном, кунжут.
 *  Это помощь, а не гарантия: состав готовых продуктов (соусы, колбасы, выпечка) приложение не знает. */
export interface Allergen { id: string; title: string; key: RegExp; words: string[]; except?: string[]; anyFish?: boolean }
export const ALLERGENS: Allergen[] = [
  {
    id: "milk", title: "молочное", key: /^(молок|молоч|лактоз|казеин)/,
    words: ["молоко", "молочн", "сливки", "сливок", "сливочн", "сметана", "творог", "творож", "кефир", "ряженка", "йогурт", "простокваш", "варенец", "айран", "мацони", "катык", "пахта", "сыворотк",
      "сыр", "сырок", "сырк", "сырник", "брынза", "пармезан", "моцарелла", "фета", "сулугуни", "адыгейск", "маскарпоне", "рикотта", "чеддер", "гауда", "камамбер", "халлуми", "дорблю", "горгонзол",
      "сгущенк", "сгущенное", "мороженое", "пломбир", "масло топленое", "гхи", "молочный шоколад", "бешамель"],
    except: ["кокосовое молоко", "кокосовые сливки", "миндальное молоко", "овсяное молоко", "соевое молоко", "рисовое молоко", "растительное молоко", "растительные сливки"],
  },
  { id: "egg", title: "яйца", key: /^(яйц|яиц|яичн)/, words: ["яйцо", "яйца", "яиц", "яичн", "яичниц", "желток", "желтк", "яичный белок", "белок яичный", "белки яичные", "меланж", "майонез", "меренг"] },
  { id: "fish", title: "рыба", key: /^рыб/, anyFish: true, words: ["рыба", "рыбн", "сельдь", "селедк", "анчоус", "шпрот", "килька", "икра красная", "икра черная", "икра минтая", "икра трески", "икра мойвы", "сурими", "крабовые палочки"] },
  { id: "seafood", title: "морепродукты", key: /^(морепродукт|ракообразн|моллюск)/, words: ["морепродукт", "креветк", "кальмар", "мидии", "мидий", "краб", "рак", "раки", "омар", "лангуст", "осьминог", "устриц", "гребешок", "гребешк", "морской коктейль"], except: ["крабовые палочки"] },
  { id: "nuts", title: "орехи", key: /^орех/, words: ["орех", "ореш", "миндаль", "миндал", "фундук", "кешью", "фисташк", "пекан", "макадами", "арахис", "пралине", "марципан", "ореховая паста", "нутелла"], except: ["мускатный орех", "размером с", "величиной с"] },
  { id: "peanut", title: "арахис", key: /^арахис/, words: ["арахис"] },
  { id: "soy", title: "соя", key: /^(соя|сои|сою|соев)/, words: ["соя", "сои", "сою", "соев", "тофу", "эдамаме", "мисо", "терияки"] },
  {
    id: "gluten", title: "глютен", key: /^(глютен|клейковин|пшениц|пшеничн)/,
    words: ["мука", "муки", "муке", "муку", "мукой", "пшениц", "пшеничн", "ржаной", "ржаная", "ржаное", "ячмень", "ячмен", "ячнев", "перловка", "перлов", "манка", "манная", "манной", "манную", "булгур", "кускус", "полба",
      "макароны", "макарон", "спагетти", "лапша", "вермишель", "лазанья", "пельмени", "вареники", "хлеб", "хлебц", "батон", "булка", "булочк", "багет", "лаваш", "лепешк", "тортилья", "гренки", "сухари", "сухарей", "панировочные",
      "тесто", "бисквит", "крекер", "вафли", "круассан", "пицца", "отруби", "солод", "пиво", "квас", "сейтан"],
    except: ["рисовая мука", "кукурузная мука", "гречневая мука", "миндальная мука", "кокосовая мука", "нутовая мука", "рисовая лапша", "гречневая лапша", "стеклянная лапша", "фунчоза", "безглютен", "без глютена"],
  },
  { id: "sesame", title: "кунжут", key: /^(кунжут|сезам)/, words: ["кунжут", "тахини", "тахина", "сезам"] },
];

/** Запрещён ли продукт кому-нибудь из семьи («никогда», аллергия, «не любит») — для замен: запрещённое взамен не предлагаем. */
let neverMemo: { rules: Rule[]; custom: CatalogItem[]; members: Member[]; fn: (name: string) => boolean } | null = null;
export function neverFor(s: { rules: Rule[]; customCatalog: CatalogItem[]; members: Member[] }): (name: string) => boolean {
  if (neverMemo && neverMemo.rules === s.rules && neverMemo.custom === s.customCatalog && neverMemo.members === s.members) return neverMemo.fn;
  const compiled = compileRules(s.rules, s.customCatalog, s.members);
  const who = s.members.map((m) => m.id);
  const fn = (name: string) => checkProduct(name, compiled, who)?.rule.level === "never";
  neverMemo = { rules: s.rules, custom: s.customCatalog, members: s.members, fn };
  return fn;
}

/** Аллергии и «не любит» каждого человека — тоже правила «никогда», но только для него. */
export function memberRules(members: Member[]): Rule[] {
  const out: Rule[] = [];
  for (const m of members) {
    const all = m.allergies.map(norm).filter(Boolean), d = m.dislikes.map(norm).filter(Boolean);
    // Аллергия на группу («молоко», «орехи», «рыба») — это все продукты группы, а не одно слово
    const a: string[] = [];
    const groups = new Set<Allergen>();
    for (const w of all) { const g = ALLERGENS.find((x) => x.key.test(w)); if (g) groups.add(g); else a.push(w); }
    for (const g of groups) out.push({ id: `m-a-${m.id}-${g.id}`, title: `${m.name}: аллергия (${g.title})`, level: "never", who: m.id, words: g.words, except: g.except, ...(g.anyFish ? { anyFish: true } : {}) });
    if (a.length) out.push({ id: "m-a-" + m.id, title: `${m.name}: аллергия`, level: "never", who: m.id, words: a });
    if (d.length) out.push({ id: "m-d-" + m.id, title: `${m.name}: не любит`, level: "never", who: m.id, words: d });
  }
  return out;
}

export interface Hit { rule: Rule; word: string }

/** Ищет в тексте продукты из правил. who — кто будет есть (id людей). */
export function findHits(text: string, compiled: ReturnType<typeof compileRules>, who: string[]): Hit[] {
  const t = " " + norm(text) + " ";
  const out: Hit[] = [];
  const seen = new Set<string>();
  for (const w of compiled.words) {
    if (w.rule.who !== "all" && !who.includes(w.rule.who)) continue;
    if (seen.has(w.rule.id)) continue;
    if (w.re.test(t) && !w.ex.some((re) => re.test(t))) { out.push({ rule: w.rule, word: w.word }); seen.add(w.rule.id); }
  }
  return out;
}

/** Проверка одного продукта (для склада и списка покупок). */
export function checkProduct(name: string, compiled: ReturnType<typeof compileRules>, who: string[]): Hit | null {
  return findHits(name, compiled, who)[0] || null;
}

/** Сколько это столовых ложек. null — не поняли. */
export function toTbsp(amount: string): number | null {
  const a = norm(amount);
  if (!a) return null;
  if (/по вкусу|для посып|щепот|немного|для подачи|для украш/.test(a)) return 1;
  if (/горст/.test(a)) return 3 * (leadNum(a) || 1);
  if (/стакан/.test(a)) return 16 * (leadNum(a) || 1);
  const n = leadNum(a);
  if (n === null) return null;
  if (/ст\.?\s*л|столов/.test(a)) return n;
  if (/ч\.?\s*л|чайн/.test(a)) return n / 3;
  if (/кг/.test(a)) return n * 100;
  if (/(^|[\d\s])г(р|\.|\s|$)|грам/.test(a)) return n / 10; // 1 ст. л. семечек ≈ 10 г
  return null;
}
function leadNum(a: string): number | null {
  const m = a.match(/(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?/);
  if (!m) return /половин|пол /.test(a) ? 0.5 : null;
  return Number((m[2] || m[1]).replace(",", "."));
}

export type Verdict = "ok" | "warn" | "hidden";
export interface Issue {
  rule: Rule;
  word: string;
  where: string;
  msg: string;
  /** Чем заменить (для рыбы). */
  replace?: string;
}

/** Проверка рецепта: можно ли предлагать и что сказать. */
const checkMemo = new WeakMap<object, WeakMap<Recipe, { who: string; res: { verdict: Verdict; issues: Issue[] } }>>();
/** Проверка рецепта по нашим ограничениям (с кэшем: рецептов в базе тысячи). */
export function checkRecipe(r: Recipe, compiled: ReturnType<typeof compileRules>, who: string[]): { verdict: Verdict; issues: Issue[] } {
  let byRecipe = checkMemo.get(compiled);
  if (!byRecipe) { byRecipe = new WeakMap(); checkMemo.set(compiled, byRecipe); }
  const w = who.join(",");
  const m = byRecipe.get(r);
  if (m && m.who === w) return m.res;
  const res = checkRecipeNow(r, compiled, who);
  byRecipe.set(r, { who: w, res });
  return res;
}
function checkRecipeNow(r: Recipe, compiled: ReturnType<typeof compileRules>, who: string[]): { verdict: Verdict; issues: Issue[] } {
  const issues: Issue[] = [];
  let verdict: Verdict = "ok";
  const nameHits = findHits(r.name, compiled, who);
  const seen = new Set<string>();
  const handle = (h: Hit, where: string, amount: string | null, inName: boolean) => {
    if (seen.has(h.rule.id + where)) return;
    seen.add(h.rule.id + where);
    const rule = h.rule;
    if (rule.level === "never") {
      if (rule.replace) {
        issues.push({ rule, word: h.word, where, msg: `${cap(h.word)} нельзя — можно заменить: ${rule.replace}.`, replace: rule.replace });
        if (verdict === "ok") verdict = "warn";
      } else {
        issues.push({ rule, word: h.word, where, msg: `Есть «${rule.title}» — такие блюда не предлагаем.` });
        verdict = "hidden";
      }
    } else if (rule.level === "little") {
      const lim = rule.limitTbsp ?? 2;
      const tb = amount !== null ? toTbsp(amount) : null;
      if (inName || (tb !== null && tb > lim)) {
        issues.push({ rule, word: h.word, where, msg: `${rule.title}: слишком много для нас (можно до ${lim} ст. л. на блюдо).` });
        verdict = "hidden";
      } else {
        issues.push({ rule, word: h.word, where, msg: `${rule.title}: только немного, до ${lim} ст. л. на всё блюдо.` });
      }
    }
  };
  const ingHits: { h: Hit; ing: { name: string; amount: string } }[] = [];
  for (const ing of r.ingredients) for (const h of findHits(ing.name, compiled, who)) ingHits.push({ h, ing });
  // «Немного» в названии («салат с семечками»): если в ингредиентах указано малое количество — можно;
  // если количества нет — считаем, что это основной ингредиент.
  nameHits.forEach((h) => {
    if (h.rule.level === "little" && ingHits.some((x) => x.h.rule.id === h.rule.id && toTbsp(x.ing.amount) !== null)) return;
    handle(h, "название", null, true);
  });
  ingHits.forEach(({ h, ing }) => handle(h, ing.name, ing.amount || "", false));
  // В шагах ищем только «никогда» без замены (например, «подать как холодец»)
  for (const s of r.steps) {
    for (const h of findHits(s, compiled, who)) if (h.rule.level === "never" && !h.rule.replace) handle(h, "шаги", null, false);
  }
  return { verdict, issues };
}

/** Заменяет запрещённый продукт в рецепте: «Треска» → «Минтай (вместо: треска)». */
export function applyReplace(r: Recipe, word: string, to: string): Recipe {
  const re = new RegExp(wordRe(word).source, "gi");
  const swap = (s: string) => s.replace(re, (_m, pre) => pre + to);
  return {
    ...r,
    name: cap(swap(r.name)),
    // Название ингредиента меняем целиком, а что было — пишем рядом с количеством
    ingredients: r.ingredients.map((i) => (wordRe(word).test(" " + norm(i.name)) ? { name: cap(to), amount: [i.amount, `вместо: ${i.name.toLowerCase()}`].filter(Boolean).join(" · ") } : i)),
    steps: r.steps.map(swap),
  };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function newRule(): Rule {
  return { id: "r-" + uid(), title: "Новое правило", level: "never", who: "all", words: [] };
}
