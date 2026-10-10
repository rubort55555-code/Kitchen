// «Спросить Claude»: собираем запрос с продуктами и ограничениями, открываем Claude,
// потом разбираем ответ, который пользователь вставил обратно. Бесплатно, без ключей.
import type { Member, Product, Recipe, Rule } from "./types";
import { qtyText } from "./units";
import { dateText, daysLeft, norm, uid } from "./util";
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
  const whoText = eaters.length >= 2 ? `${eaters.length} взрослых (${eaters.map((m) => m.name).join(" и ")})` : `1 взрослый (${eaters[0]?.name || "я"})`;
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
    "Наши ограничения в питании (строго соблюдай):",
    ...rulesText(rules, members, o.who, custom),
    "",
    "Главное — использовать то, что скоро испортится. Можно 1–2 продукта, которых нет дома.",
    "Пиши простым языком, шаги короткие. Названия ингредиентов пиши так же, как в моём списке.",
    "",
    ...(o.weekPart ? [o.weekPart] : [
      "В конце ответа обязательно дай блок JSON строго в таком виде (между ```json и ```), чтобы я вставил его в приложение:",
      "```json",
      '{"dishes":[{"name":"Название","minutes":30,"servings":2,"kind":"ужин","why":"почему это блюдо","ingredients":[{"name":"Молоко","amount":"200 мл"}],"steps":["Шаг 1","Шаг 2"]}]}',
      "```",
    ]),
  ];
  return lines.filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0)).join("\n");
}

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
  const steps = (Array.isArray(x.steps) ? x.steps : []).map(str).filter(Boolean).map((s: string) => s.replace(/^\d+[.)]\s*/, ""));
  const minutes = Number(x.minutes ?? x.time);
  const servings = Number(x.servings ?? x.portions);
  return {
    id: uid(), name, ingredients: ings, steps,
    minutes: isFinite(minutes) && minutes > 0 ? Math.round(minutes) : undefined,
    servings: isFinite(servings) && servings > 0 ? Math.round(servings) : undefined,
    kind: str(x.kind || x.type) || undefined, why: str(x.why) || undefined,
    source: "claude", createdAt: Date.now(),
  };
}
