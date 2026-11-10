// Автоподбор меню под нормы (этап 2 плана): без интернета и без внешнего ИИ — случайный старт и улучшение заменами.
// Порядок приоритетов (выше важнее; нижний уровень не может ухудшить верхний, поэтому ключи сравниваются по порядку):
//  1) запреты — блюда берутся только из разрешённых (allowed);
//  2) калории дня ±5% цели, белок не ниже нормы, жиры и углеводы ±10% — порции основных блюд подбираются под каждого человека;
//  3) пределы «не больше» в среднем за неделю (натрий, насыщенные жиры, холестерин, сахара);
//  4) витамины, минералы и клетчатка не ниже 90% нормы в среднем за неделю (там, где в рецептах есть данные);
//  5) разнообразие: блюдо не больше двух раз, рыба не реже двух раз, белок не повторяется в обед и ужин;
//  6) продукты дома и сроки (bonus) — выбирают только между равноценными вариантами.
import type { PlanEntry, Recipe, Slot } from "./types";
import { recipeNutrition, type NutrientKey } from "./recipeNutrition";
import { micros, type BodyProfile, type Plan } from "./nutrition";
import { fitsSlot, proteinOf } from "./plan";
import { norm, uid } from "./util";
import { KCAL_TOL, FAT_CARB_TOL, MICRO_MIN, PORTION_MAX, PORTION_MIN, PORTION_STEP, snapPortion } from "./menucheck";

type Vec = Partial<Record<NutrientKey, number>>;
export interface Person { id: string; plan: Plan; body: BodyProfile }
export interface AutoInput {
  recipes: Recipe[];
  /** Разрешено ли блюдо всем, кто ест (аллергии, исключения). */
  allowed: (r: Recipe) => boolean;
  /** Бонус за продукты дома и сроки: используется только при равенстве по приоритетам 1–5. */
  bonus?: (r: Recipe) => number;
  days: string[];
  slots: Slot[];
  /** Уже стоящие в меню блюда: места не меняем, но порции подбираем. */
  fixed: PlanEntry[];
  people: Person[];
  iterations?: number;
  seed?: number;
}
export interface AutoResult {
  /** Новые блюда меню. */
  added: PlanEntry[];
  /** id блюда меню (новых и стоявших) → id человека → порции. */
  portions: Record<string, Record<string, number>>;
  /** Сколько мест заполнено. */
  filled: number;
  /** Нет подходящих блюд на какие-то места. */
  empty: number;
}

interface Cand { r: Recipe; per: Vec; prot: string; bonus: number }
const NK = (k: string) => k as NutrientKey;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const q = (x: number) => Math.round(x * 2) / 2; // «равноценность»: отклонения меньше полупроцента не различаем

/** Подбор порций основных блюд одного дня одного человека (только числа). Возвращает порции и вектор дня. */
function fitDayNum(mains: Cand[], extras: Cand[], p: Person): { portions: number[]; vec: Vec } {
  const T = p.plan.kcal;
  const fixed = extras.reduce((s, c) => s + (c.per.kcal || 0), 0);
  const base = mains.reduce((s, c) => s + (c.per.kcal || 0), 0);
  const p0 = snapPortion(base > 0 ? (T - fixed) / base : 1);
  const x = mains.map(() => p0);
  const kcal = () => fixed + mains.reduce((s, c, i) => s + x[i] * (c.per.kcal || 0), 0);
  const prot = () => extras.reduce((s, c) => s + (c.per.protein || 0), 0) + mains.reduce((s, c, i) => s + x[i] * (c.per.protein || 0), 0);
  const cost = () => Math.abs(kcal() - T) + Math.max(0, p.plan.protein - prot()) * 2 + x.reduce((s, v) => s + Math.abs(v - p0), 0) * 3;
  for (let it = 0; it < 40; it++) {
    let best = cost(), mi = -1, mv = 0;
    for (let i = 0; i < mains.length; i++) for (const d of [-PORTION_STEP, PORTION_STEP]) {
      const nv = x[i] + d;
      if (nv < PORTION_MIN || nv > PORTION_MAX) continue;
      const old = x[i]; x[i] = nv; const c = cost(); x[i] = old;
      if (c < best - 1e-9) { best = c; mi = i; mv = nv; }
    }
    if (mi < 0) break;
    x[mi] = mv;
  }
  const vec: Vec = {};
  const add = (c: Cand, k: number) => { for (const key in c.per) vec[NK(key)] = (vec[NK(key)] || 0) + (c.per[NK(key)] || 0) * k; };
  mains.forEach((c, i) => add(c, x[i]));
  extras.forEach((c) => add(c, 1));
  return { portions: x, vec };
}

export function autoPlan(inp: AutoInput): AutoResult {
  const { people, days, slots } = inp;
  const rnd = mulberry(inp.seed ?? 7);
  const info = (r: Recipe): Cand | null => { const n = recipeNutrition(r); return n ? { r, per: n.perServing as Vec, prot: proteinOf(r), bonus: inp.bonus ? inp.bonus(r) : 0 } : null; };

  const okRecipes = inp.recipes.filter((r) => inp.allowed(r));
  const cache = new Map<string, Cand | null>();
  const cand = (r: Recipe) => { if (!cache.has(r.id)) cache.set(r.id, info(r)); return cache.get(r.id) || null; };
  const poolFor = (slot: Slot) => okRecipes.filter((r) => fitsSlot(r, slot)).map(cand).filter((c): c is Cand => !!c);
  const pools = new Map(slots.map((s) => [s, poolFor(s)]));
  const sidePool = okRecipes.filter((r) => norm(r.kind || "") === "салат" && !/фрукт|банан|апельсин|груш/.test(norm(r.name))).map(cand).filter((c): c is Cand => !!c);

  // Места дней: существующее блюдо или пустое место
  interface Spot { day: string; slot: Slot; fixed?: PlanEntry; pick?: Cand }
  const spots: Spot[] = [];
  for (const d of days) for (const s of slots) {
    const e = inp.fixed.find((x) => x.date === d && x.slot === s);
    spots.push({ day: d, slot: s, fixed: e });
  }
  // Салат дня: ставим, если у дня нет салата в уже стоящих блюдах и есть обед или ужин
  const sideOf = new Map<string, Cand | null>();
  const sideFree = (d: string) => !inp.fixed.some((e) => e.date === d && e.side) && slots.some((s) => s === "обед" || s === "ужин");
  const sideOptional = days.filter(sideFree);
  const empty = spots.filter((s) => !s.fixed);
  let emptyCount = 0;

  const keyOfFixed = (e: PlanEntry) => {
    const r = inp.recipes.find((x) => x.id === e.recipeId);
    return r ? cand(r) : null;
  };
  const fixedSide = (d: string): Cand | null => {
    const e = inp.fixed.find((x) => x.date === d && x.side);
    const r = e?.side ? inp.recipes.find((x) => x.id === e.side!.id) : undefined;
    return r ? cand(r) : null;
  };

  // Нормы человека по микроэлементам: только те, по которым в рецептах вообще есть данные
  const anyData = new Set<string>();
  [...pools.values()].flat().concat(sidePool).forEach((c) => { for (const k in c.per) if ((c.per[NK(k)] || 0) > 0) anyData.add(k); });
  const norms = new Map(people.map((p) => [p.id, micros(p.body).filter((m) => anyData.has(m.key) && m.key !== "na").map((m) => ({ key: m.key, amount: m.amount })).concat(anyData.has("fiber") ? [{ key: "fiber", amount: p.plan.fiber }] : [])]));

  const dayCache = new Map<string, { portions: number[]; vec: Vec }>();
  function dayState(d: string, person: Person) {
    const mains: Cand[] = [], ids: string[] = [], keys: string[] = [];
    for (const s of spots.filter((x) => x.day === d)) {
      const c = s.fixed ? keyOfFixed(s.fixed) : s.pick || null;
      if (c) { mains.push(c); keys.push(c.r.id); ids.push(s.fixed?.id || s.slot); }
    }
    const side = fixedSide(d) || sideOf.get(d) || null;
    const extras = side ? [side] : [];
    const key = person.id + "|" + keys.join(",") + "|" + (side?.r.id || "");
    let v = dayCache.get(key);
    if (!v) { v = fitDayNum(mains, extras, person); dayCache.set(key, v); }
    return { mains, ids, v, side };
  }

  type Key = number[];
  function evaluate(): Key {
    let notOk = 0, pen2 = 0, viol = 0, pen3 = 0, pen4 = 0, variety = 0, home = 0;
    const counts = new Map<string, number>();
    let fish = 0, mainsLD = 0;
    for (const d of days) {
      const lunch = spots.find((s) => s.day === d && s.slot === "обед"), dinner = spots.find((s) => s.day === d && s.slot === "ужин");
      const lc = lunch ? (lunch.fixed ? keyOfFixed(lunch.fixed) : lunch.pick) : null, dc = dinner ? (dinner.fixed ? keyOfFixed(dinner.fixed) : dinner.pick) : null;
      if (lc && dc && lc.prot === dc.prot && lc.prot !== "овощи и крупы") variety++;
    }
    for (const s of spots) {
      const c = s.fixed ? keyOfFixed(s.fixed) : s.pick;
      if (!c) continue;
      counts.set(c.r.id, (counts.get(c.r.id) || 0) + 1);
      home += c.bonus;
      if (s.slot !== "завтрак") { mainsLD++; if (c.prot === "рыба") fish++; }
    }
    for (const n of counts.values()) if (n > 2) variety += n - 2;
    if (mainsLD >= 6 && fish < 2) variety += 2 - fish;
    for (const p of people) {
      const sum: Vec = {};
      let dd = 0;
      for (const d of days) {
        const { mains, v } = dayState(d, p);
        if (!mains.length) continue;
        dd++;
        const kc = v.vec.kcal || 0, pr = v.vec.protein || 0, ft = v.vec.fat || 0, cb = v.vec.carbs || 0;
        const dk = Math.max(0, Math.abs(kc - p.plan.kcal) / p.plan.kcal - KCAL_TOL);
        const dp = Math.max(0, (p.plan.protein - pr) / p.plan.protein);
        const df = Math.max(0, Math.abs(ft - p.plan.fat) / p.plan.fat - FAT_CARB_TOL);
        const dc = Math.max(0, Math.abs(cb - p.plan.carbs) / p.plan.carbs - FAT_CARB_TOL);
        if (dk > 0 || dp > 0 || df > 0 || dc > 0) notOk++;
        pen2 += 100 * (2 * dk + dp + 0.5 * df + 0.5 * dc);
        for (const k in v.vec) sum[NK(k)] = (sum[NK(k)] || 0) + (v.vec[NK(k)] || 0);
      }
      if (!dd) continue;
      const avg = (k: string) => (sum[NK(k)] || 0) / dd;
      const lim: [string, number][] = [["na", p.plan.naMax], ["satFat", p.plan.satFatMax], ["chol", p.plan.cholMax], ["sugar", p.plan.sugarMax * 2.5]];
      for (const [k, L] of lim) { const o = Math.max(0, avg(k) / L - 1); if (o > 0) { viol++; pen3 += 100 * o; } }
      for (const m of norms.get(p.id) || []) pen4 += 100 * Math.max(0, MICRO_MIN - avg(m.key) / m.amount);
    }
    return [notOk, q(pen2), viol, q(pen3), q(pen4), variety, -home];
  }
  const less = (a: Key, b: Key) => { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; };
  const same = (a: Key, b: Key) => a.every((v, i) => v === b[i]);

  const pickRand = <T,>(l: T[]) => l[Math.floor(rnd() * l.length)];
  // Блюдо не больше двух раз за период — жёсткое правило (стоящие в меню блюда тоже считаются)
  const countOf = (id: string) => spots.reduce((n, s) => n + ((s.fixed ? s.fixed.recipeId : s.pick?.r.id) === id ? 1 : 0), 0);
  const canPlace = (s: Spot, c: Cand) => countOf(c.r.id) - ((s.pick?.r.id === c.r.id) ? 1 : 0) < 2;
  const run = (iterations: number) => {
    for (const s of empty) {
      s.pick = undefined;
      const pool = (pools.get(s.slot) || []).filter((c) => canPlace(s, c));
      s.pick = pool.length ? pickRand(pool) : undefined;
    }
    for (const d of sideOptional) sideOf.set(d, sidePool.length ? pickRand(sidePool) : null);
    let cur = evaluate();
    const movable = empty.filter((s) => (pools.get(s.slot) || []).length);
    for (let it = 0; it < iterations && (movable.length || sideOptional.length); it++) {
      const side = sideOptional.length && (!movable.length || rnd() < 0.2);
      if (side) {
        const d = pickRand(sideOptional), old = sideOf.get(d) || null;
        const nv = rnd() < 0.1 ? null : pickRand(sidePool);
        sideOf.set(d, nv);
        const k = evaluate();
        if (less(k, cur) || same(k, cur)) cur = k; else sideOf.set(d, old);
      } else {
        const s = pickRand(movable), old = s.pick;
        if (rnd() < 0.25 && movable.length > 1) {
          // Обмен блюдами между двумя местами одного приёма пищи в разные дни
          const t = pickRand(movable.filter((x) => x !== s && x.slot === s.slot && x.day !== s.day));
          if (!t) continue;
          const to = t.pick; s.pick = to; t.pick = old;
          const k = evaluate();
          if (less(k, cur) || same(k, cur)) cur = k; else { s.pick = old; t.pick = to; }
          continue;
        }
        const c = pickRand(pools.get(s.slot)!);
        if (!canPlace(s, c)) continue;
        s.pick = c;
        const k = evaluate();
        if (less(k, cur) || same(k, cur)) cur = k; else s.pick = old;
      }
    }
    return cur;
  };
  const snapshot = () => ({ picks: empty.map((s) => s.pick), sides: new Map(sideOf) });
  let best: { key: Key; snap: ReturnType<typeof snapshot> } | null = null;
  const restarts = 4, per = Math.ceil((inp.iterations ?? 20000) / restarts);
  for (let r = 0; r < restarts; r++) {
    const k = run(per);
    if (!best || less(k, best.key)) best = { key: k, snap: snapshot() };
  }
  empty.forEach((s, i) => { s.pick = best!.snap.picks[i]; });
  sideOf.clear(); best!.snap.sides.forEach((v, k) => sideOf.set(k, v));

  // Результат
  const added: PlanEntry[] = [];
  for (const s of empty) {
    if (!s.pick) { emptyCount++; continue; }
    const e: PlanEntry = { id: uid(), date: s.day, slot: s.slot, name: s.pick.r.name, recipeId: s.pick.r.id };
    s.fixed = e; // дальше день считается вместе с ним
    added.push(e);
  }
  for (const d of sideOptional) {
    const side = sideOf.get(d);
    if (!side) continue;
    const target = added.find((e) => e.date === d && e.slot === "обед") || added.find((e) => e.date === d && e.slot === "ужин");
    if (target) target.side = { id: side.r.id, name: side.r.name };
  }
  const portions: Record<string, Record<string, number>> = {};
  for (const d of days) for (const p of people) {
    const { ids, mains, v } = dayState(d, p);
    const dayEntries = [...inp.fixed, ...added].filter((e) => e.date === d && e.recipeId);
    mains.forEach((c, i) => {
      const e = dayEntries.find((x) => x.recipeId === c.r.id && (x.id === ids[i] || ids[i] === x.slot));
      if (e) (portions[e.id] ||= {})[p.id] = v.portions[i];
    });
  }
  return { added, portions, filled: added.length, empty: emptyCount };
}
