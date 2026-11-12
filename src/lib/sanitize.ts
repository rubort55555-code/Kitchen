// Проверка и починка данных из копии и из базы телефона.
// Битая запись не должна ломать приложение: неподходящее выбрасываем или заменяем значением по умолчанию.
import type { Ingredient, LogEntry, Meal, Member, PlanEntry, Product, Reason, Recipe, Rule, Settings, ShopItem } from "./types";
import { PLACES, SLOTS, UNITS } from "./types";

const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const fin = (v: unknown): v is number => typeof v === "number" && isFinite(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter(str) : []);
const objs = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter(obj) : []);
const REASONS: Reason[] = ["bought", "eaten", "cooked", "spoiled", "thrown", "adjust"];

export function cleanProducts(v: unknown): Product[] {
  return objs(v).filter((p) => str(p.id) && str(p.name) && fin(p.qty) && p.qty >= 0).map((p) => ({
    ...p,
    unit: UNITS.includes(p.unit) ? p.unit : "шт",
    place: PLACES.includes(p.place) ? p.place : "Холодильник",
    initialQty: fin(p.initialQty) && p.initialQty > 0 ? p.initialQty : p.qty || 1,
    price: fin(p.price) && p.price >= 0 ? p.price : 0,
    bought: str(p.bought) ? p.bought : new Date().toISOString().slice(0, 10),
    until: str(p.until) ? p.until : null,
    createdAt: fin(p.createdAt) ? p.createdAt : Date.now(),
  }) as Product);
}

export function cleanLog(v: unknown): LogEntry[] {
  return objs(v).filter((e) => str(e.id) && fin(e.t) && str(e.name) && REASONS.includes(e.reason)).map((e) => ({
    ...e, qty: fin(e.qty) ? e.qty : 0, rub: fin(e.rub) ? e.rub : 0, unit: UNITS.includes(e.unit) ? e.unit : "шт",
  }) as LogEntry);
}

export function cleanRecipes(v: unknown): Recipe[] {
  return objs(v).filter((r) => str(r.id) && str(r.name)).map((r) => ({
    ...r,
    ingredients: objs(r.ingredients).filter((i) => str(i.name)).map((i) => ({ name: i.name, amount: str(i.amount) ? i.amount : "" }) as Ingredient),
    steps: strs(r.steps),
    source: ["claude", "old", "manual", "base"].includes(r.source) ? r.source : "manual",
    createdAt: fin(r.createdAt) ? r.createdAt : Date.now(),
  }) as Recipe);
}

export function cleanMeals(v: unknown): Meal[] {
  return objs(v).filter((m) => str(m.id) && str(m.date) && str(m.name)).map((m) => {
    const n: Record<string, number> = {};
    if (obj(m.n)) for (const [k, x] of Object.entries(m.n)) if (fin(x)) n[k] = x;
    return { ...m, t: fin(m.t) ? m.t : 0, slot: SLOTS.includes(m.slot) ? m.slot : "перекус", n } as Meal;
  });
}

function cleanMembers(v: unknown): Member[] | null {
  const list = objs(v).filter((m) => str(m.id) && str(m.name)).map((m) => ({ ...m, allergies: strs(m.allergies), dislikes: strs(m.dislikes), body: obj(m.body) ? m.body : undefined }) as Member);
  return list.length ? list : null;
}

/** Настройки: всё, что не того вида, заменяется значением по умолчанию. */
export function cleanSettings(raw: unknown, base: Settings): Settings {
  const s: Record<string, any> = { ...base };
  if (!obj(raw)) return s as Settings;
  for (const [k, v] of Object.entries(raw)) {
    if (k === "__proto__" || k === "constructor" || v === undefined || v === null) continue;
    const def = (base as any)[k];
    if (Array.isArray(def)) { if (Array.isArray(v)) s[k] = v; }
    else if (obj(def)) { if (obj(v)) s[k] = v; }
    else if (typeof def === "number") { if (fin(v)) s[k] = v; }
    else s[k] = v;
  }
  s.members = cleanMembers(s.members) || base.members;
  s.rules = objs(s.rules).filter((r) => str(r.id) && str(r.title)).map((r) => ({ ...r, words: strs(r.words), except: r.except === undefined ? undefined : strs(r.except), who: str(r.who) ? r.who : "all", level: ["never", "little", "ok"].includes(r.level) ? r.level : "never" }) as Rule);
  s.basics = strs(s.basics);
  s.tipsSeen = strs(s.tipsSeen);
  s.planSlots = strs(s.planSlots).filter((x) => SLOTS.includes(x as any));
  if (!s.planSlots.length) s.planSlots = base.planSlots;
  s.shop = objs(s.shop).filter((x) => str(x.id) && str(x.name)).map((x) => ({ ...x, amount: str(x.amount) ? x.amount : "", done: !!x.done, createdAt: fin(x.createdAt) ? x.createdAt : 0 }) as ShopItem);
  s.plan = objs(s.plan).filter((x) => str(x.id) && str(x.date) && SLOTS.includes(x.slot) && str(x.name)) as PlanEntry[];
  s.minStock = objs(s.minStock).filter((x) => str(x.name) && fin(x.qty) && UNITS.includes(x.unit));
  s.customCatalog = objs(s.customCatalog).filter((x) => str(x.n) && str(x.c) && UNITS.includes(x.u) && PLACES.includes(x.p) && Array.isArray(x.d)).map((x) => ({ ...x, e: str(x.e) ? x.e : "🛒", s: x.s === undefined ? undefined : strs(x.s) }));
  for (const k of ["receiptMap", "water", "measures", "barcodes", "consent", "beta"]) if (s[k] !== undefined && !obj(s[k])) delete s[k];
  if (s.scanLog !== undefined && !Array.isArray(s.scanLog)) delete s.scanLog;
  if (s.measures) for (const [who, list] of Object.entries(s.measures)) if (!Array.isArray(list)) delete s.measures[who];
  return s as Settings;
}
