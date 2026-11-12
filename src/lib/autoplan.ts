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
import { autoGarnishes, garnishClass, garnishNeed, isGarnish, type GClass } from "./garnish";
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
  /** Хватает ли продуктов дома на блюдо (почти всё есть). Если таких блюд на место хватает для разнообразия, берём только их. */
  ready?: (r: Recipe) => boolean;
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
  /** Гарниры к уже стоявшим в меню блюдам, у которых гарнира не было: id блюда меню → гарнир. */
  garnishes: Record<string, { id: string; name: string }>;
  /** Сколько мест заполнено. */
  filled: number;
  /** Нет подходящих блюд на какие-то места. */
  empty: number;
}

interface Cand { r: Recipe; per: Vec; prot: string; bonus: number; gclass?: GClass | null }
const NK = (k: string) => k as NutrientKey;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const q = (x: number) => Math.round(x * 2) / 2; // «равноценность»: отклонения меньше полупроцента не различаем
const qc = (x: number) => Math.round(x / 3) * 3; // для пределов и микроэлементов грубее: суммарное отклонение меньше 3 процентных пунктов — равноценно, тогда решает разнообразие

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
  for (let it = 0; it < 12; it++) {
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
  const info = (r: Recipe): Cand | null => { const n = recipeNutrition(r); return n ? { r, per: n.perServing as Vec, prot: proteinOf(r), bonus: inp.bonus ? inp.bonus(r) : 0, gclass: isGarnish(r) ? garnishClass(r) : undefined } : null; };

  const okRecipes = inp.recipes.filter((r) => inp.allowed(r));
  const cache = new Map<string, Cand | null>();
  const cand = (r: Recipe) => { if (!cache.has(r.id)) cache.set(r.id, info(r)); return cache.get(r.id) || null; };
  const byId = (id: string | undefined) => { const r = id ? inp.recipes.find((x) => x.id === id) : undefined; return r ? cand(r) : null; };
  const poolFor = (slot: Slot) => {
    const all = okRecipes.filter((r) => !isGarnish(r) && fitsSlot(r, slot)).map(cand).filter((c): c is Cand => !!c);
    if (!inp.ready) return all;
    // Блюда из того, что есть дома: берём только их, если хватает на меню без повторов (каждое блюдо — не больше двух раз)
    const have = all.filter((c) => inp.ready!(c.r));
    return have.length * 2 >= days.length + 2 && have.length >= 4 ? have : all;
  };
  const pools = new Map(slots.map((s) => [s, poolFor(s)]));
  const sidePool = okRecipes.filter((r) => norm(r.kind || "") === "салат" && !/фрукт|банан|апельсин|груш/.test(norm(r.name))).map(cand).filter((c): c is Cand => !!c);
  const garnishPool = okRecipes.filter(isGarnish).map(cand).filter((c): c is Cand => !!c);
  const optMemo = new Map<string, Cand[]>();
  const optionsFor = (main: Cand) => { let o = optMemo.get(main.r.id); if (!o) { const ok = new Set(autoGarnishes(main.r, garnishPool.map((c) => c.r)).map((r) => r.id)); o = garnishPool.filter((g) => ok.has(g.r.id)); optMemo.set(main.r.id, o); } return o; };

  // Место в меню: блюдо (стоящее или подбираемое) и гарнир к нему. Гарнир подбираем, если блюду он нужен и пользователь его не ставил.
  interface Spot { day: string; slot: Slot; fixed?: PlanEntry; main?: Cand; garnish?: Cand | null; gFree: boolean }
  const spots: Spot[] = [];
  for (const d of days) for (const s of slots) {
    const e = inp.fixed.find((x) => x.date === d && x.slot === s);
    const main = e ? byId(e.recipeId) : null;
    const need = main ? garnishNeed(main.r, s) : "none";
    spots.push({ day: d, slot: s, fixed: e, main: main || undefined, garnish: e?.garnish ? byId(e.garnish.id) : null, gFree: !!e && !e.garnish && (need === "required" || need === "default") });
  }
  const empty = spots.filter((s) => !s.fixed);
  // Салат дня: ставим, если у дня нет салата в уже стоящих блюдах и есть обед или ужин
  const sideOf = new Map<string, Cand | null>();
  const sideFree = (d: string) => !inp.fixed.some((e) => e.date === d && e.side) && slots.some((s) => s === "обед" || s === "ужин");
  const sideOptional = days.filter(sideFree);
  const fixedSide = (d: string): Cand | null => byId(inp.fixed.find((x) => x.date === d && x.side)?.side?.id);
  let emptyCount = 0;

  // Гарнир подбирается для места, когда ему нужен гарнир по умолчанию или обязательно
  const setGarnish = (s: Spot, c: Cand | null) => { s.garnish = c; };
  const needMemo = new Map<string, string>();
  const needOf = (c: Cand, slot: Slot) => { const k = c.r.id + slot; let n = needMemo.get(k); if (!n) { n = garnishNeed(c.r, slot); needMemo.set(k, n); } return n; };
  // Гарнир подбираем только там, где он нужен по умолчанию или обязателен; к блюду с крахмалом внутри (плов, паста, жаркое с картошкой) сам не ставится — человек может выбрать овощи вручную
  const wantGarnish = (s: Spot) => !!s.main && (s.gFree || !s.fixed) && ["required", "default"].includes(needOf(s.main, s.slot));
  // Один гарнир не больше трёх раз за период — жёсткое правило, пока есть из чего выбрать
  const gCount = (id: string, except?: Spot) => spots.reduce((n, x) => n + (x !== except && x.garnish?.r.id === id ? 1 : 0), 0);
  const pickGarnish = (s: Spot) => { const o = s.main ? optionsFor(s.main) : []; const free = o.filter((g) => gCount(g.r.id, s) < 3); const l = free.length ? free : o; return l.length ? pickRand(l) : null; };
  const randomGarnish = pickGarnish;

  // Нормы человека по микроэлементам: только те, по которым в рецептах вообще есть данные
  const anyData = new Set<string>();
  [...pools.values()].flat().concat(sidePool, garnishPool).forEach((c) => { for (const k in c.per) if ((c.per[NK(k)] || 0) > 0) anyData.add(k); });
  const norms = new Map(people.map((p) => [p.id, micros(p.body).filter((m) => anyData.has(m.key) && m.key !== "na").map((m) => ({ key: m.key, amount: m.amount })).concat(anyData.has("fiber") ? [{ key: "fiber", amount: p.plan.fiber }] : [])]));

  // Блюдо вместе с гарниром: порция общая
  const withGarnish = (main: Cand, g: Cand | null | undefined): Cand => {
    if (!g) return main;
    const per: Vec = { ...main.per };
    for (const k in g.per) per[NK(k)] = (per[NK(k)] || 0) + (g.per[NK(k)] || 0);
    return { ...main, per };
  };
  const dayCache = new Map<string, { portions: number[]; vec: Vec }>();
  function dayState(d: string, person: Person) {
    const mains: Cand[] = [], ids: string[] = [], keys: string[] = [];
    for (const s of spots.filter((x) => x.day === d)) {
      if (!s.main) continue;
      mains.push(withGarnish(s.main, s.garnish)); keys.push(s.main.r.id + "+" + (s.garnish?.r.id || "")); ids.push(s.fixed?.id || s.slot);
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
    const gCounts = new Map<string, number>();
    let fish = 0, mainsLD = 0;
    for (const d of days) {
      const lunch = spots.find((s) => s.day === d && s.slot === "обед"), dinner = spots.find((s) => s.day === d && s.slot === "ужин");
      const lc = lunch?.main, dc = dinner?.main;
      if (lc && dc && lc.prot === dc.prot && lc.prot !== "овощи и крупы") variety++;
      if (lunch?.garnish && dinner?.garnish && lunch.garnish.gclass === dinner.garnish.gclass) variety++; // один и тот же гарнир в обед и ужин
    }
    for (const s of spots) {
      if (!s.main) continue;
      counts.set(s.main.r.id, (counts.get(s.main.r.id) || 0) + 1);
      home += s.main.bonus + (s.garnish?.bonus || 0);
      if (s.slot === "обед" || s.slot === "ужин") { mainsLD++; if (s.main.prot === "рыба") fish++; }
      if (s.garnish) gCounts.set(s.garnish.r.id, (gCounts.get(s.garnish.r.id) || 0) + 1);
    }
    for (const n of counts.values()) if (n > 2) variety += n - 2;
    for (const n of gCounts.values()) if (n > 3) variety += n - 3; // один гарнир не больше трёх раз за период
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
    return [notOk, q(pen2), viol, qc(pen3), qc(pen4), variety, -home];
  }
  const less = (a: Key, b: Key) => { for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; };
  const same = (a: Key, b: Key) => a.every((v, i) => v === b[i]);

  function pickRand<T>(l: T[]): T { return l[Math.floor(rnd() * l.length)]; }
  // Блюдо не больше двух раз за период — жёсткое правило (стоящие в меню блюда тоже считаются)
  const countOf = (id: string) => spots.reduce((n, s) => n + (s.main?.r.id === id ? 1 : 0), 0);
  const canPlace = (s: Spot, c: Cand) => countOf(c.r.id) - (s.main?.r.id === c.r.id ? 1 : 0) < 2;
  const place = (s: Spot, c: Cand | undefined) => { s.main = c; setGarnish(s, c && wantGarnish({ ...s, main: c }) ? randomGarnish({ ...s, main: c }) : null); };

  const run = (iterations: number) => {
    for (const s of empty) {
      s.main = undefined; s.garnish = null;
      const pool = (pools.get(s.slot) || []).filter((c) => canPlace(s, c));
      place(s, pool.length ? pickRand(pool) : undefined);
    }
    for (const s of spots) if (s.fixed && s.gFree) setGarnish(s, randomGarnish(s));
    for (const d of sideOptional) sideOf.set(d, sidePool.length ? pickRand(sidePool) : null);
    let cur = evaluate();
    const movable = empty.filter((s) => (pools.get(s.slot) || []).length);
    // Места, где гарнир можно менять: считаем на ходу, потому что блюда на местах меняются
    const garnSpots = () => spots.filter((s) => s.main && wantGarnish(s) && optionsFor(s.main).length > 1);
    for (let it = 0; it < iterations && (movable.length || sideOptional.length || spots.length); it++) {
      const r = rnd();
      if (r < 0.3) {
        const gl = garnSpots();
        if (!gl.length) continue;
        const s = pickRand(gl), old = s.garnish;
        setGarnish(s, pickGarnish(s));
        const k = evaluate();
        if (less(k, cur) || same(k, cur)) cur = k; else setGarnish(s, old ?? null);
      } else if (sideOptional.length && (!movable.length || r < 0.45)) {
        const d = pickRand(sideOptional), old = sideOf.get(d) || null;
        const nv = rnd() < 0.1 ? null : pickRand(sidePool);
        sideOf.set(d, nv);
        const k = evaluate();
        if (less(k, cur) || same(k, cur)) cur = k; else sideOf.set(d, old);
      } else if (movable.length) {
        const s = pickRand(movable), oldMain = s.main, oldG = s.garnish;
        if (rnd() < 0.25 && movable.length > 1) {
          // Обмен блюдами (вместе с гарнирами) между двумя местами одного приёма пищи в разные дни
          const cands = movable.filter((x) => x !== s && x.slot === s.slot && x.day !== s.day);
          if (!cands.length) continue;
          const t = pickRand(cands);
          const tm = t.main, tg = t.garnish;
          s.main = tm; s.garnish = tg ?? null; t.main = oldMain; t.garnish = oldG ?? null;
          const k = evaluate();
          if (less(k, cur) || same(k, cur)) cur = k; else { s.main = oldMain; s.garnish = oldG ?? null; t.main = tm; t.garnish = tg ?? null; }
          continue;
        }
        const c = pickRand(pools.get(s.slot)!);
        if (!canPlace(s, c)) continue;
        place(s, c);
        const k = evaluate();
        if (less(k, cur) || same(k, cur)) cur = k; else { s.main = oldMain; s.garnish = oldG ?? null; }
      }
    }
    return cur;
  };
  const snapshot = () => ({ picks: empty.map((s) => [s.main, s.garnish] as const), fixedG: spots.filter((s) => s.fixed && s.gFree).map((s) => s.garnish), sides: new Map(sideOf) });
  let best: { key: Key; snap: ReturnType<typeof snapshot> } | null = null;
  const restarts = 4, per = Math.ceil((inp.iterations ?? 12000) / restarts);
  for (let r = 0; r < restarts; r++) {
    const k = run(per);
    if (!best || less(k, best.key)) best = { key: k, snap: snapshot() };
  }
  empty.forEach((s, i) => { s.main = best!.snap.picks[i][0]; s.garnish = best!.snap.picks[i][1] ?? null; });
  spots.filter((s) => s.fixed && s.gFree).forEach((s, i) => { s.garnish = best!.snap.fixedG[i] ?? null; });
  sideOf.clear(); best!.snap.sides.forEach((v, k) => sideOf.set(k, v));

  // Доводка разнообразия: рыбы меньше двух раз — пробуем поставить рыбное блюдо на ужин вместо другого, если это не ухудшает уровни 1–4 (калории, пределы, витамины)
  const fishCount = () => spots.filter((x) => (x.slot === "обед" || x.slot === "ужин") && x.main?.prot === "рыба").length;
  let curKey = evaluate();
  for (let guard = 0; guard < 4 && fishCount() < 2; guard++) {
    let improved = false;
    for (const s of empty.filter((x) => (x.slot === "ужин" || x.slot === "обед") && x.main?.prot !== "рыба")) {
      for (const c of (pools.get(s.slot) || []).filter((x) => x.prot === "рыба" && canPlace(s, x))) {
        const oldMain = s.main, oldG = s.garnish;
        place(s, c);
        const k = evaluate();
        // Уровни 1–4 не должны стать хуже (сравнение по порядку), а разнообразие — лучше
        // (небольшое отклонение по калориям — до 1 пункта штрафа и до 3 пунктов по витаминам — считаем равноценным)
        if (k[0] <= curKey[0] && k[1] <= curKey[1] + 1 && k[2] <= curKey[2] && k[3] <= curKey[3] && k[4] <= curKey[4] + 3 && k[5] < curKey[5]) { curKey = k; improved = true; break; }
        s.main = oldMain; s.garnish = oldG ?? null;
      }
      if (improved) break;
    }
    if (!improved) break;
  }

  // Результат
  const added: PlanEntry[] = [];
  const garnishes: Record<string, { id: string; name: string }> = {};
  for (const s of empty) {
    if (!s.main) { emptyCount++; continue; }
    const e: PlanEntry = { id: uid(), date: s.day, slot: s.slot, name: s.main.r.name, recipeId: s.main.r.id, ...(s.garnish ? { garnish: { id: s.garnish.r.id, name: s.garnish.r.name } } : {}) };
    s.fixed = e; // дальше день считается вместе с ним
    added.push(e);
  }
  for (const s of spots) if (s.fixed && s.gFree && s.garnish) garnishes[s.fixed.id] = { id: s.garnish.r.id, name: s.garnish.r.name };
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
  return { added, portions, garnishes, filled: added.length, empty: emptyCount };
}
