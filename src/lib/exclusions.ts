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
function wordRe(w: string): RegExp {
  // Слова внутри фразы могут иметь любые окончания: «морского окуня» = «морской окунь».
  const parts = stem(w).split(" ").map((p) => esc(p) + "[а-я]*");
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
    if (r.fishType) {
      for (const it of allCatalog(custom)) {
        if (it.f !== r.fishType) continue;
        if ((r.except || []).some((e) => norm(e) === norm(it.n))) continue;
        list.add(norm(it.n));
        (it.s || []).forEach((s) => list.add(norm(s)));
      }
    }
    // Для рыбы исключения уже убраны из списка слов; для остальных — «тыквенные семечки» не считаются.
    const ex = r.fishType ? [] : (r.except || []).map(wordRe);
    for (const w of list) words.push({ rule: r, word: w, re: wordRe(w), ex });
  }
  return { words };
}

/** Аллергии и «не любит» каждого человека — тоже правила «никогда», но только для него. */
export function memberRules(members: Member[]): Rule[] {
  const out: Rule[] = [];
  for (const m of members) {
    const a = m.allergies.map(norm).filter(Boolean), d = m.dislikes.map(norm).filter(Boolean);
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
