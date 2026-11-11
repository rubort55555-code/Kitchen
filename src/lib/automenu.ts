// Автоподбор меню под нормы: берёт данные из хранилища, вызывает autoplan и записывает результат в меню.
import type { PlanEntry, Slot } from "./types";
import { getState, setSettings } from "./store";
import { autoPlan, type Person } from "./autoplan";
import { checkRecipe, compileRules, neverFor } from "./exclusions";
import { recipeStatus } from "./match";
import { cuisineOf } from "./cuisine";
import { planFor } from "./nutrition";
import { hasHighOxalate, oxalateAvoided } from "./conditions";
import { fitsSlot, planList, weekDays } from "./plan";
import { ymd } from "./util";

export interface AutoMenuResult { added: number; empty: number; people: number; noPeople: boolean; noRecipes: boolean }

/** Люди, для которых можно считать нормы. */
export function peopleWithPlan(): Person[] {
  return getState().settings.members.flatMap((m) => {
    const plan = m.body ? planFor(m.body) : null;
    return plan && m.body ? [{ id: m.id, plan, body: m.body }] : [];
  });
}

/** Заполняет пустые места меню блюдами под нормы всех, кто ест, и подбирает порции каждому. only — только один день. */
export function autoMenu(start: string, slots: Slot[], only?: string): AutoMenuResult {
  const st = getState();
  const people = peopleWithPlan();
  if (!people.length) return { added: 0, empty: 0, people: 0, noPeople: true, noRecipes: false };
  const today = ymd();
  const days = (only ? [only] : weekDays(start)).filter((d) => d >= today);
  const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
  const who = st.settings.members.map((m) => m.id);
  const cuis = st.settings.planCuisine || "";
  // Мочекаменная болезнь с кальций-оксалатными или неизвестными камнями: блюда с шпинатом, щавелем, ревенём, мангольдом и миндалём не ставим
  const avoidOx = people.some((x) => x.plan.uro && oxalateAvoided(x.plan.uro.stone));
  const allowed = (r: (typeof st.recipes)[number]) =>
    checkRecipe(r, compiled, who).verdict === "ok" && !(avoidOx && hasHighOxalate(r.ingredients.map((i) => i.name))) && (!cuis || !(fitsSlot(r, "обед") || fitsSlot(r, "ужин")) || cuisineOf(r) === cuis);
  const bonus = (r: (typeof st.recipes)[number]) => {
    const s = recipeStatus(r, st.products, st.settings.basics, st.settings.customCatalog, neverFor(st.settings));
    return s.urgent * 30 + s.percent * 0.4 + (r.fav ? 15 : 0) + (r.rating ? (r.rating - 3) * 8 : 0);
  };
  const plan = planList();
  const fixed = plan.filter((e) => days.includes(e.date) && e.recipeId);
  if (!st.recipes.some(allowed)) return { added: 0, empty: 0, people: people.length, noPeople: false, noRecipes: true };
  const res = autoPlan({ recipes: st.recipes, allowed, bonus, days, slots, fixed, people });
  const next: PlanEntry[] = plan.map((e) => {
    const p = res.portions[e.id], g = res.garnishes[e.id];
    return p || g ? { ...e, ...(p ? { portions: { ...(e.portions || {}), ...p } } : {}), ...(g ? { garnish: g } : {}) } : e;
  });
  for (const e of res.added) next.push({ ...e, portions: res.portions[e.id] });
  setSettings({ plan: next });
  return { added: res.filled, empty: res.empty, people: people.length, noPeople: false, noRecipes: false };
}
