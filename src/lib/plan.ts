// Меню на неделю: дни, приёмы пищи, автозаполнение из своих рецептов, запрос к Claude.
import type { PlanEntry, Recipe, Slot } from "./types";
import { SLOTS } from "./types";
import { getState, saveRecipes, setSettings } from "./store";
import { compileRules, checkRecipe } from "./exclusions";
import { recipeStatus } from "./match";
import { addDays, norm, parseYmd, uid, ymd } from "./util";
import { parseAnswer } from "./claude";

const DAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const DAY_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/** Понедельник недели, в которую входит дата. */
export function weekStart(d: string = ymd()): string {
  const dt = parseYmd(d);
  const shift = (dt.getDay() + 6) % 7;
  return addDays(d, -shift);
}
export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));
export function dayTitle(d: string): string {
  const dt = parseYmd(d);
  const today = ymd();
  const rel = d === today ? "Сегодня" : d === addDays(today, 1) ? "Завтра" : DAY_LONG[dt.getDay()][0].toUpperCase() + DAY_LONG[dt.getDay()].slice(1);
  return `${rel}, ${dt.getDate()} ${MON[dt.getMonth()]}`;
}
export const dayShort = (d: string) => DAY_SHORT[parseYmd(d).getDay()];

export const planList = (): PlanEntry[] => getState().settings.plan || [];
const save = (plan: PlanEntry[]) => setSettings({ plan });

export function entriesFor(date: string, plan = planList()): PlanEntry[] {
  return plan.filter((e) => e.date === date).sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
}

export function addEntry(date: string, slot: Slot, name: string, recipeId?: string) {
  save([...planList().filter((e) => !(e.date === date && e.slot === slot)), { id: uid(), date, slot, name: name.trim(), recipeId }]);
}
export const removeEntry = (id: string) => save(planList().filter((e) => e.id !== id));
export const toggleDone = (id: string) => save(planList().map((e) => (e.id === id ? { ...e, done: !e.done } : e)));
export const restorePlan = (p: PlanEntry[]) => save(p);
/** Убрать старые записи (старше 4 недель), чтобы список не рос бесконечно. */
export function pruneOld() {
  const lim = addDays(weekStart(), -28);
  const p = planList();
  if (p.some((e) => e.date < lim)) save(p.filter((e) => e.date >= lim));
}

/** Подходит ли рецепт к приёму пищи. */
function fitsSlot(r: Recipe, slot: Slot): boolean {
  const k = norm((r.kind || "") + " " + r.name);
  const breakfast = /завтрак|омлет|каша|сырник|блин|оладь|яичниц|тост|запеканк/.test(k);
  if (slot === "завтрак") return breakfast;
  return !breakfast || /обед|ужин/.test(k);
}

/**
 * Заполняет пустые места недели своими рецептами (без интернета).
 * Сначала — блюда, которые спасают продукты и для которых почти всё есть; без повторов.
 */
export function autoFill(start: string, slots: Slot[]): { added: number; noRecipes: boolean } {
  const st = getState();
  const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
  const who = st.settings.members.map((m) => m.id);
  const ok = st.recipes
    .filter((r) => checkRecipe(r, compiled, who).verdict === "ok")
    .map((r) => {
      const s = recipeStatus(r, st.products, st.settings.basics, st.settings.customCatalog);
      return { r, score: s.urgent * 30 + s.percent + (r.fav ? 15 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  if (!ok.length) return { added: 0, noRecipes: true };
  const plan = [...planList()];
  const used = new Set(plan.filter((e) => e.date >= start && e.date <= addDays(start, 6)).map((e) => e.recipeId));
  let added = 0;
  const today = ymd();
  for (const d of weekDays(start)) {
    if (d < today) continue;
    for (const slot of slots) {
      if (plan.some((e) => e.date === d && e.slot === slot)) continue;
      let pick = ok.find((x) => fitsSlot(x.r, slot) && !used.has(x.r.id));
      // Рецептов мало — разрешаем повтор, но не в соседние дни
      if (!pick) pick = ok.find((x) => fitsSlot(x.r, slot) && !plan.some((e) => e.recipeId === x.r.id && Math.abs(parseYmd(e.date).getTime() - parseYmd(d).getTime()) < 2 * 86400000));
      if (!pick) continue;
      used.add(pick.r.id);
      plan.push({ id: uid(), date: d, slot, name: pick.r.name, recipeId: pick.r.id });
      added++;
    }
  }
  save(plan);
  return { added, noRecipes: false };
}

/** Рецепты, которые стоят в меню на эти дни (для списка покупок). */
export function recipesInPlan(days: string[]): Recipe[] {
  const st = getState();
  const ids = new Set(planList().filter((e) => days.includes(e.date) && !e.done && e.recipeId).map((e) => e.recipeId));
  return st.recipes.filter((r) => ids.has(r.id));
}

/** Дополнение к запросу Claude: просим меню на неделю в особом JSON. */
export function weekPromptPart(days: string[], slots: Slot[]): string {
  const list = days.map((d) => `${dayShort(d)} ${parseYmd(d).getDate()}.${String(parseYmd(d).getMonth() + 1).padStart(2, "0")}`).join(", ");
  return [
    `Составь меню на ${days.length} ${days.length === 1 ? "день" : days.length < 5 ? "дня" : "дней"} (${list}): ${slots.join(", ")}.`,
    "Блюда не должны повторяться чаще двух раз за неделю. Остатки можно использовать на следующий день.",
    "Сначала используй то, что скоро испортится; в конце недели — то, что хранится долго.",
    "В конце дай блок JSON строго в таком виде (между ```json и ```):",
    "```json",
    '{"week":[{"day":1,"slot":"ужин","name":"Название","minutes":30,"servings":2,"kind":"ужин","ingredients":[{"name":"Молоко","amount":"200 мл"}],"steps":["Шаг 1"]}]}',
    "```",
    `Где day — номер дня от 1 до ${days.length}, slot — ${slots.map((s) => `"${s}"`).join(" или ")}.`,
  ].join("\n");
}

/** Разбирает ответ Claude с меню на неделю: сохраняет рецепты и ставит их в дни. */
export function applyWeekAnswer(text: string, days: string[], slots: Slot[], who: string[]): { placed: number; skipped: string[]; error?: string } {
  const data = extractWeek(text);
  if (!data) {
    // Может, Claude ответил обычным списком блюд — раскладываем по дням по порядку
    const p = parseAnswer(text);
    if (!p.recipes.length) return { placed: 0, skipped: [], error: p.error || "В ответе нет меню. Скопируйте ответ Claude целиком." };
    return place(p.recipes.map((r, i) => ({ r, day: Math.floor(i / slots.length), slot: slots[i % slots.length] })), days, who);
  }
  return place(data, days, who);
}

function extractWeek(text: string): { r: Recipe; day: number; slot: Slot }[] | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  const cands: string[] = [];
  while ((m = fence.exec(text))) cands.push(m[1]);
  const i = text.indexOf('{"week"');
  if (i >= 0) cands.push(text.slice(i));
  for (const c of cands) {
    let o: any = null;
    try { o = JSON.parse(c.replace(/,\s*([}\]])/g, "$1").trim()); } catch { continue; }
    if (!o || !Array.isArray(o.week)) continue;
    const out: { r: Recipe; day: number; slot: Slot }[] = [];
    for (const x of o.week) {
      const rec = parseAnswer(JSON.stringify({ dishes: [x] })).recipes[0];
      if (!rec) continue;
      const day = Math.max(0, Math.round(Number(x.day) || 1) - 1);
      const slot = (SLOTS.find((s) => norm(String(x.slot || "")).startsWith(s.slice(0, 3))) || "ужин") as Slot;
      out.push({ r: rec, day, slot });
    }
    if (out.length) return out;
  }
  return null;
}

function place(items: { r: Recipe; day: number; slot: Slot }[], days: string[], who: string[]) {
  const st = getState();
  const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
  const skipped: string[] = [];
  const keep: Recipe[] = [];
  let plan = [...planList()];
  let placed = 0;
  // Одинаковые блюда (остатки на следующий день) — один рецепт
  const byName = new Map<string, Recipe>();
  for (const it of items) {
    if (it.day >= days.length) continue;
    const c = checkRecipe(it.r, compiled, who);
    if (c.verdict === "hidden") { skipped.push(it.r.name); continue; }
    const key = norm(it.r.name);
    let rec = byName.get(key) || st.recipes.find((x) => norm(x.name) === key);
    if (!rec) { rec = it.r; keep.push(rec); }
    byName.set(key, rec);
    const date = days[it.day];
    plan = plan.filter((e) => !(e.date === date && e.slot === it.slot));
    plan.push({ id: uid(), date, slot: it.slot, name: rec.name, recipeId: rec.id });
    placed++;
  }
  if (keep.length) saveRecipes(keep);
  save(plan);
  return { placed, skipped: Array.from(new Set(skipped)) };
}
