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

// ---- Автоменю: что можно на какой приём пищи и как держать баланс ----
const BREAKFAST_RE = /завтрак|омлет|каша|сырник|блин|оладь|яичниц|тост|запеканк|панкейк|скрэмбл|шакшук/;

type Role = "завтрак" | "суп" | "основное" | "другое";
/** Чем рецепт может быть в меню: завтрак, суп, основное блюдо. Салаты, закуски, соусы, напитки, десерты сами по себе — не приём пищи. */
function roleOf(r: Recipe): Role {
  const kind = norm(r.kind || "");
  const k = norm((r.kind || "") + " " + r.name);
  if (kind === "суп") return "суп";
  if (kind === "основное" || kind === "обед" || kind === "ужин") return "основное";
  if (kind === "завтрак") return "завтрак";
  if (kind === "салат" || kind === "закуска" || kind === "соус" || kind === "напиток" || kind === "десерт" || kind === "гарнир" || kind === "выпечка") return BREAKFAST_RE.test(k) && kind === "выпечка" ? "завтрак" : "другое";
  // Рецепты без вида (от Claude, из старого приложения)
  if (BREAKFAST_RE.test(k)) return "завтрак";
  if (/суп|борщ|щи\b|солянк|уха\b/.test(k)) return "суп";
  if (/салат|закуск|соус|компот|морс|напиток/.test(k)) return "другое";
  return "основное";
}

/** Главный источник белка/основы — чтобы дни не повторялись («опять курица», «опять яичница»). */
function proteinOf(r: Recipe): string {
  const all = norm(r.name + " " + r.ingredients.map((i) => i.name).join(" "));
  if (/кур|индейк|утк|цыпл/.test(all)) return "птица";
  if (/говяд|свинин|баран|фарш|мяс|печен|колбас|сосиск|кролик|язык|бекон|ветчин/.test(all)) return "мясо";
  if (/минтай|камбал|лосос|скумбр|сельд|рыб|кревет|кальмар|тунец|судак|карп|щук|мойв|сайр|шпрот/.test(all)) return "рыба";
  // Яйцо и сыр как добавка (в котлетах, запеканках) белком не считаем — только если это главный продукт
  const head = norm(r.name + " " + (r.ingredients[0]?.name || ""));
  if (/яйц|яичн|омлет|творог|сырник|^сыр|брынз/.test(head)) return "яйца и творог";
  if (/фасол|чечевиц|нут|горох/.test(all)) return "бобовые";
  return "овощи и крупы";
}

function breakfastType(r: Recipe): string {
  const t = norm(r.name);
  if (/каш|овсян|манн|гречн|рисов|пшён|пшен/.test(t)) return "каша";
  if (/яйц|омлет|яичниц|скрэмбл|шакшук/.test(t)) return "яйца";
  if (/творог|сырник|запеканк/.test(t)) return "творог";
  if (/блин|оладь|панкейк|тост|гренк/.test(t)) return "мучное";
  return "другое";
}

/** Подходит ли рецепт к приёму пищи: завтрак — завтраки; обед — суп или основное; ужин — основное блюдо. */
function fitsSlot(r: Recipe, slot: Slot): boolean {
  const role = roleOf(r);
  if (slot === "завтрак") return role === "завтрак";
  if (slot === "обед") return role === "суп" || role === "основное";
  return role === "основное";
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
      return { r, score: s.urgent * 30 + s.percent * 0.4 + (r.fav ? 15 : 0) + (r.rating ? (r.rating - 3) * 8 : 0), prot: proteinOf(r), bt: breakfastType(r) };
    })
    .sort((a, b) => b.score - a.score);
  if (!ok.length) return { added: 0, noRecipes: true };
  const byId = new Map(ok.map((x) => [x.r.id, x]));
  const plan = [...planList()];
  const days = weekDays(start);
  const used = new Set(plan.filter((e) => e.date >= start && e.date <= addDays(start, 6)).map((e) => e.recipeId));
  const dayMs = 86400000;

  // Уже стоящие в меню блюда учитываем при подсчёте баланса
  const entryInfo = (e: PlanEntry) => (e.recipeId ? byId.get(e.recipeId) : undefined);
  const weekCount = (key: "prot" | "bt", v: string, slot?: Slot) =>
    plan.filter((e) => e.date >= start && e.date <= addDays(start, 6) && (!slot || e.slot === slot) && entryInfo(e)?.[key] === v).length;

  let added = 0;
  const today = ymd();
  for (const d of days) {
    if (d < today) continue;
    for (const slot of slots) {
      if (plan.some((e) => e.date === d && e.slot === slot)) continue;
      const prevDay = addDays(d, -1);
      let pool = ok.filter((x) => fitsSlot(x.r, slot));
      // Без белка (одни овощи и крупы) — не чаще раза в неделю и только на обед
      if (slot === "ужин" || weekCount("prot", "овощи и крупы") >= 1) {
        const withProtein = pool.filter((x) => x.prot !== "овощи и крупы");
        if (withProtein.length) pool = withProtein;
      }
      const eaten = (date: string, sl: Slot) => entryInfo(plan.find((e) => e.date === date && e.slot === sl) || ({} as PlanEntry));
      const sameDayLunch = slot === "ужин" ? eaten(d, "обед") : undefined;
      const prevDinner = eaten(prevDay, "ужин");
      const prevLunch = eaten(prevDay, "обед");
      const prevBreakfast = eaten(prevDay, "завтрак");
      const scoreOf = (x: (typeof ok)[number]) => {
        let sc = x.score;
        if (slot === "завтрак") {
          if (prevBreakfast?.bt === x.bt) sc -= 40;
          sc -= weekCount("bt", x.bt, "завтрак") * 12;
        } else {
          // Белок разный на обед и ужин и на соседние дни
          if (sameDayLunch && sameDayLunch.prot === x.prot && roleOf(sameDayLunch.r) !== "суп") sc -= 60;
          if (prevDinner?.prot === x.prot) sc -= 35;
          if (slot === "обед" && prevLunch?.prot === x.prot) sc -= 25;
          sc -= weekCount("prot", x.prot) * 10;
          // Не одно и то же блюдо в разных вариантах (борщ, борщ, борщ)
          const w = norm(x.r.name).split(" ")[0];
          sc -= plan.filter((e) => e.date >= start && e.date <= addDays(start, 6) && norm(e.name).split(" ")[0] === w).length * 45;
          // Рыба и птица полезны: если их на неделе мало — поднимаем
          if (x.prot === "рыба" && weekCount("prot", "рыба") < 2) sc += 25;
          // Ужин без белка (овощи и крупы) — редко: не больше одного раза в неделю
          if (slot === "ужин" && (x.prot === "овощи и крупы") && weekCount("prot", "овощи и крупы") >= 1) sc -= 60;
          // Суп на обед — через день, не два дня подряд
          if (slot === "обед" && roleOf(x.r) === "суп") sc += prevLunch && roleOf(prevLunch.r) === "суп" ? -50 : 20;
          if (slot === "обед" && roleOf(x.r) === "основное" && prevLunch && roleOf(prevLunch.r) === "основное") sc += 10;
        }
        return sc;
      };
      const best = (list: typeof ok) => list.reduce<(typeof ok)[number] | undefined>((a, x) => (!a || scoreOf(x) > scoreOf(a) ? x : a), undefined);
      let pick = best(pool.filter((x) => !used.has(x.r.id)));
      // Рецептов мало — разрешаем повтор, но не в соседние дни
      if (!pick) pick = best(pool.filter((x) => !plan.some((e) => e.recipeId === x.r.id && Math.abs(parseYmd(e.date).getTime() - parseYmd(d).getTime()) < 2 * dayMs)));
      if (!pick) continue;
      used.add(pick.r.id);
      plan.push({ id: uid(), date: d, slot, name: pick.r.name, recipeId: pick.r.id });
      added++;
    }
  }
  // Салат к основному приёму пищи: хотя бы раз в день (к обеду, если его нет — к ужину)
  const salads = st.recipes.filter((r) => norm(r.kind || "") === "салат" && !/фрукт|банан|апельсин|груш/.test(norm(r.name)) && checkRecipe(r, compiled, who).verdict === "ok")
    .map((r) => ({ r, score: recipeStatus(r, st.products, st.settings.basics, st.settings.customCatalog) }))
    // Свежие овощные салаты — чаще, тяжёлые на майонезе — реже
    .map((x) => ({ r: x.r, sc: x.score.urgent * 30 + x.score.percent * 0.4 + (x.r.fav ? 15 : 0) - (x.r.ingredients.some((i) => /майонез/i.test(i.name)) ? 25 : 0) + (x.r.ingredients.some((i) => /огур|помидор|капуст|морков|свёкл|свекл|перец|редис|зелень|укроп|салат/i.test(i.name)) ? 10 : 0) }))
    .sort((a, b) => b.sc - a.sc);
  const usedSalad = new Set(plan.map((e) => e.side?.id).filter(Boolean) as string[]);
  for (const d of days) {
    if (d < today) continue;
    const meals = plan.filter((e) => e.date === d && (e.slot === "обед" || e.slot === "ужин"));
    if (!meals.length || meals.some((e) => e.side)) continue;
    const target = meals.find((e) => e.slot === "обед") || meals[0];
    const lastWords = new Set(plan.filter((e) => e.side && e.date >= start && e.date <= addDays(start, 6)).map((e) => norm(e.side!.name).split(" ")[0]));
    const pick = salads.find((x) => !usedSalad.has(x.r.id) && !lastWords.has(norm(x.r.name).split(" ")[0])) || salads.find((x) => !usedSalad.has(x.r.id));
    if (!pick) break;
    usedSalad.add(pick.r.id);
    target.side = { id: pick.r.id, name: pick.r.name };
    added++;
  }
  save(plan);
  return { added, noRecipes: false };
}

/** Рецепты, которые стоят в меню на эти дни (для списка покупок). */
export function recipesInPlan(days: string[]): Recipe[] {
  const st = getState();
  const ids = new Set(planList().filter((e) => days.includes(e.date) && !e.done).flatMap((e) => [e.recipeId, e.side?.id]).filter(Boolean));
  return st.recipes.filter((r) => ids.has(r.id));
}

/** Дополнение к запросу Claude: просим меню на неделю в особом JSON. */
export function weekPromptPart(days: string[], slots: Slot[]): string {
  const list = days.map((d) => `${dayShort(d)} ${parseYmd(d).getDate()}.${String(parseYmd(d).getMonth() + 1).padStart(2, "0")}`).join(", ");
  return [
    `Составь меню на ${days.length} ${days.length === 1 ? "день" : days.length < 5 ? "дня" : "дней"} (${list}): ${slots.join(", ")}.`,
    "Блюда не должны повторяться чаще двух раз за неделю. Остатки можно использовать на следующий день.",
    "Рацион должен быть сбалансированным: на обед и ужин — полноценное основное блюдо или суп с белком (мясо, птица, рыба, яйца, творог, бобовые), белок чередуй по дням; салат — только как дополнение к основному блюду, не вместо него.",
    "Если для блюда не хватает 1–2 продуктов, это нормально — их докупят.",
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
