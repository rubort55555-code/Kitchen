// «Спросить Claude»: собираем запрос с продуктами и ограничениями, открываем Claude,
// потом разбираем ответ, который пользователь вставил обратно. Бесплатно, без ключей.
import type { Member, Product, Recipe, Rule } from "./types";
import { qtyText } from "./units";
import { dateText, daysLeft, norm, plural, uid } from "./util";
import { allCatalog } from "./catalog";
import type { CatalogItem } from "./types";

export interface AskOptions {
  who: string[];          // id людей, которые будут есть
  minutes: number | null; // ограничение по времени
  kind: string;           // завтрак / обед / ужин / любое
  count: number;          // сколько блюд предложить
  wish: string;           // пожелание своими словами
  useFirst: string[];     // продукты, которые точно нужно использовать
  weekPart?: string;      // для меню на неделю: своя просьба и свой формат ответа
  nutrition?: string[];   // пробная функция «Питание»: нормы на день для тех, кто ест
}

export function rulesText(rules: Rule[], members: Member[], who: string[], custom: CatalogItem[]): string[] {
  const lines: string[] = [];
  for (const r of rules) {
    if (r.level === "ok") continue;
    if (r.who !== "all" && !who.includes(r.who)) continue;
    let words = r.words.slice(0, 6).join(", ");
    if (r.fishType) {
      const fish = allCatalog(custom).filter((c) => c.f === r.fishType && !(r.except || []).some((e) => norm(e) === norm(c.n))).map((c) => c.n.toLowerCase());
      words = fish.join(", ") + " и любая другая белая морская рыба";
    }
    const exc = r.except && r.except.length && r.fishType ? `. Исключение — ${r.except.join(" и ")}: их можно` : "";
    const whom = r.who === "all" ? "" : ` (для: ${members.find((m) => m.id === r.who)?.name || "одного из нас"})`;
    if (r.level === "never") lines.push(`- Никогда${whom}: ${r.title.toLowerCase()} (${words})${exc}.`);
    else lines.push(`- Только немного${whom}: ${r.title.toLowerCase()} — не больше ${r.limitTbsp ?? 2} ст. л. на всё блюдо, и не как основной ингредиент.`);
  }
  for (const m of members) {
    if (!who.includes(m.id)) continue;
    if (m.allergies.length) lines.push(`- У ${m.name} аллергия: ${m.allergies.join(", ")} — не использовать совсем.`);
    if (m.dislikes.length) lines.push(`- ${m.name} не любит: ${m.dislikes.join(", ")} — не использовать.`);
  }
  return lines;
}

export function buildPrompt(o: AskOptions, products: Product[], members: Member[], rules: Rule[], basics: string[], custom: CatalogItem[]): string {
  const eaters = members.filter((m) => o.who.includes(m.id));
  // Возраст каждого — чтобы порции и блюда подходили и взрослым, и детям
  const year = new Date().getFullYear();
  const ageOf = (m: Member) => (m.body?.born ? year - m.body.born : null);
  const who = (list: Member[]) => list.map((m) => { const a = ageOf(m); return a === null ? m.name : `${m.name}, ${a} ${plural(a, "год", "года", "лет")}`; }).join("; ");
  const adults = eaters.filter((m) => (ageOf(m) ?? 18) >= 18);
  const kids = eaters.filter((m) => (ageOf(m) ?? 18) < 18);
  const whoText = !eaters.length ? "1 взрослый (я)" : [
    adults.length ? `${adults.length} ${plural(adults.length, "взрослый", "взрослых", "взрослых")} (${who(adults)})` : "",
    kids.length ? `${kids.length} ${plural(kids.length, "ребёнок", "ребёнка", "детей")} (${who(kids)}) — детям порции меньше, блюда без острого` : "",
  ].filter(Boolean).join(" и ");
  const sorted = [...products].sort((a, b) => (daysLeft(a.until) ?? 9999) - (daysLeft(b.until) ?? 9999));
  const stock = sorted.map((p) => {
    const d = daysLeft(p.until);
    const when = d === null ? "" : d < 0 ? ", срок уже прошёл — проверить" : d <= 2 ? `, годен до ${dateText(p.until)} — СРОЧНО` : `, годен до ${dateText(p.until)}`;
    return `- ${p.name} — ${qtyText(p.qty, p.unit)} (${p.place.toLowerCase()}${when})`;
  });
  const lines = [
    o.weekPart ? "Помоги составить меню для нашей семьи из того, что есть дома." : `Помоги решить, что приготовить дома. Предложи ${o.count} ${o.count === 1 ? "блюдо" : "блюда"}.`,
    `Едят: ${whoText}. Порции рассчитай на ${eaters.length || 1}.`,
    o.minutes ? `Время готовки: не больше ${o.minutes} минут.` : "",
    o.kind && o.kind !== "любое" ? `Тип блюда: ${o.kind}.` : "",
    o.wish.trim() ? `Пожелание: ${o.wish.trim()}.` : "",
    "",
    "Что есть дома (сначала то, что скоро испортится):",
    ...(stock.length ? stock : ["- (список пуст — предложи простые блюда из базовых продуктов)"]),
    o.useFirst.length ? `Обязательно используй: ${o.useFirst.join(", ")}.` : "",
    `Всегда есть: ${basics.join(", ")}.`,
    "",
    ...(o.nutrition?.length ? ["Ориентиры по питанию на день (подбирай порции и блюда с учётом этого; у каждого блюда укажи примерные ккал и белок на порцию — в поле why):", ...o.nutrition.map((l) => `- ${l}`), ""] : []),
    "Наши ограничения в питании (строго соблюдай):",
    ...rulesText(rules, members, o.who, custom),
    "",
    "Главное — использовать то, что скоро испортится. Можно 1–2 продукта, которых нет дома.",
    o.weekPart ? "Пиши простым языком, шаги короткие. Названия ингредиентов пиши так же, как в моём списке." : "Пиши простым языком, на «вы», в повелительном наклонении («нарежьте», «обжарьте»). Названия ингредиентов пиши так же, как в моём списке.",
    "",
    ...(o.weekPart ? [o.weekPart] : TECH_CARD),
  ];
  return lines.filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0)).join("\n");
}

/**
 * Каждое блюдо — технологическая карта (как рецепты в базе, tools/REWRITE.md):
 * по ней может приготовить человек, который делает это впервые.
 */
const TECH_CARD = [
  "Каждое блюдо оформи как технологическую карту — так, чтобы его приготовил человек, который делает это впервые:",
  "- Состав — всё, что идёт в блюдо, включая воду, соль, сахар, масло для жарки и смазывания формы. Количество — числом: г, мл, шт, ст. л., ч. л., щепотка; без «по вкусу». Яйца, овощи и фрукты — в шт.",
  "- Технология — по этапам («Подготовка», «Тесто», «Брожение», «Формовка», «Жарка», «Выпечка», «Сборка», «Остывание» и т. п.), не меньше двух этапов и обычно 8–15 шагов. Шаг — одно законченное действие в 1–3 предложениях.",
  "- В каждом шаге: что и сколько (если продукт идёт частями — сколько именно сейчас); как делать (размер нарезки, техника); огонь (слабый, средний, сильный) или температура и режим духовки; время диапазоном («10–12 минут»); как проверить, что этап готов (по виду, на ощупь, по запаху, по температуре); что делать, если не получилось; где важно — почему так.",
  "- Мясо, птица, рыба, фарш, яйца — безопасные температуры и признаки готовности (75 °C в толще для птицы и фарша, сок прозрачный).",
  "- minutes — честное общее время от начала до подачи, включая замачивание, брожение, маринование, запекание и остывание; active — сколько минут человек занят руками.",
  "- out — выход: вес или объём готового блюда и порции («около 900 г, 4 порции по 225 г»).",
  "- tools — вся посуда с размерами; done — как выглядит, какое на ощупь и на вкус готовое блюдо; serve — как подавать; keep — где и сколько хранить, как разогревать, можно ли замораживать.",
  "- fixes — 2–4 самые частые ошибки именно этого блюда в виде «признак → причина → как исправить»; tips — 0–2 совета (замены, как сделать вкуснее).",
  "",
  "В конце ответа обязательно дай блок JSON строго в таком виде (между ```json и ```), чтобы я вставил его в приложение. Все поля обязательны, кроме tips:",
  "```json",
  JSON.stringify({ dishes: [{
    name: "Название", minutes: 60, active: 25, servings: 2, kind: "ужин", why: "почему это блюдо",
    out: "около 600 г, 2 порции по 300 г", tools: "сковорода 26 см с крышкой, миска, нож, доска",
    ingredients: [{ name: "Молоко", amount: "200 мл" }],
    stages: [{ name: "Подготовка", steps: ["Шаг: что, сколько, как, время, как проверить"] }, { name: "Жарка", steps: ["…"] }],
    done: "как выглядит и какое на вкус готовое блюдо", serve: "как подавать", keep: "как и сколько хранить",
    fixes: ["признак → причина → как исправить"], tips: ["совет"],
  }] }),
  "```",
];

/** Ссылка, которая открывает новый чат Claude с готовым запросом. */
export function claudeUrl(prompt: string): string {
  return "https://claude.ai/new?q=" + encodeURIComponent(prompt);
}

/** Ищет в тексте ответа JSON с блюдами и превращает его в рецепты. */
export function parseAnswer(text: string): { recipes: Recipe[]; error?: string } {
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) candidates.push(m[1]);
  const braces = balanced(text);
  if (braces) candidates.push(braces);
  for (const c of candidates) {
    const data = tryJson(c);
    if (!data) continue;
    const raw: unknown[] = Array.isArray(data) ? data : (data.dishes || data.ideas || data.recipes || (data.name ? [data] : []));
    const recipes = raw.map(toRecipe).filter((r): r is Recipe => !!r);
    if (recipes.length) return { recipes };
  }
  return { recipes: [], error: candidates.length ? "Нашёл блок с данными, но не смог его прочитать. Попросите Claude: «Повтори JSON с блюдами»." : "В тексте нет блока JSON с блюдами. Скопируйте ответ Claude целиком — вместе с блоком ```json в конце." };
}

/** Все блоки JSON в ответе Claude: в ```json … ``` и просто в тексте. */
export function jsonBlocks(text: string): any[] {
  const out: any[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) { const d = tryJson(m[1]); if (d) out.push(d); }
  const b = balanced(text);
  if (b) { const d = tryJson(b); if (d) out.push(d); }
  return out;
}

function balanced(t: string): string | null {
  const s = t.indexOf("{");
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (!depth) return t.slice(s, i + 1); }
  }
  return null;
}

function tryJson(s: string): any {
  const clean = s.replace(/[“”«»]/g, '"').replace(/,\s*([}\]])/g, "$1").trim();
  try { return JSON.parse(clean); } catch { /* попробуем без «умных» кавычек */ }
  try { return JSON.parse(s.trim()); } catch { return null; }
}

function str(v: unknown): string { return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""; }

function toRecipe(x: any): Recipe | null {
  if (!x || typeof x !== "object") return null;
  const name = str(x.name || x.title);
  if (!name) return null;
  const ings = (Array.isArray(x.ingredients) ? x.ingredients : []).map((i: any) =>
    typeof i === "string" ? { name: i.replace(/\s*[—–-]\s*.*$/, "").trim(), amount: (i.match(/[—–-]\s*(.*)$/) || [])[1] || "" } : { name: str(i?.name), amount: str(i?.amount ?? i?.qty) }
  ).filter((i: any) => i.name);
  const clean = (a: unknown): string[] => (Array.isArray(a) ? a : []).map(str).filter(Boolean).map((s: string) => s.replace(/^\d+[.)]\s*/, ""));
  // Технологическая карта: этапы со своими шагами → общий список шагов и номер шага, с которого начинается этап
  let steps = clean(x.steps);
  let stages: { t: string; i: number }[] | undefined;
  if (Array.isArray(x.stages) && x.stages.some((s: any) => Array.isArray(s?.steps))) {
    steps = []; stages = [];
    for (const s of x.stages) {
      const list = clean(s?.steps);
      if (!list.length) continue;
      const title = str(s?.name || s?.title || s?.t);
      if (title) stages.push({ t: title, i: steps.length });
      steps.push(...list);
    }
    if (!stages.length) stages = undefined;
  }
  const minutes = Number(x.minutes ?? x.time);
  const servings = Number(x.servings ?? x.portions);
  const active = Number(x.active);
  const text = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean).join(", ") : str(v)) || undefined;
  const list = (v: unknown) => { const a = (Array.isArray(v) ? v : v ? [v] : []).map(str).filter(Boolean); return a.length ? a : undefined; };
  const r: Recipe = {
    id: uid(), name, ingredients: ings, steps,
    minutes: isFinite(minutes) && minutes > 0 ? Math.round(minutes) : undefined,
    servings: isFinite(servings) && servings > 0 ? Math.round(servings) : undefined,
    kind: str(x.kind || x.type) || undefined, why: str(x.why) || undefined,
    source: "claude", createdAt: Date.now(),
  };
  if (isFinite(active) && active > 0 && (!r.minutes || active <= r.minutes)) r.active = Math.round(active);
  if (stages) r.stages = stages;
  const extra = { out: text(x.out ?? x.yield), tools: text(x.tools), done: text(x.done), serve: text(x.serve), keep: text(x.keep), fixes: list(x.fixes), tips: list(x.tips) };
  for (const [k, v] of Object.entries(extra)) if (v) (r as any)[k] = v;
  return r;
}
