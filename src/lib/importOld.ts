// Перенос данных из страницы «Что приготовить» (копия данных в формате той страницы).
import type { LogEntry, Place, Product, Reason, Recipe, Settings, Unit } from "./types";
import { PLACES, UNITS } from "./types";
import { norm, uid, ymd } from "./util";
import { BACKUP_APP, type Backup } from "./store";

const OLD_APP = "chto-prigotovit";

export type Parsed = { kind: "new"; backup: Backup } | { kind: "old"; backup: Backup; counts: { products: number; log: number; recipes: number } };

/** Узнаёт копию: новую (этого приложения) или старую (со страницы «Что приготовить»). */
export function parseBackupText(text: string, base: Settings): Parsed | null {
  let o: any;
  try { o = JSON.parse(text.trim()); } catch { return null; }
  if (o && o.app === BACKUP_APP && Array.isArray(o.products)) {
    return { kind: "new", backup: { ...o, log: o.log || [], recipes: o.recipes || [], settings: { ...base, ...(o.settings || {}) } } };
  }
  if (o && o.app === OLD_APP && o.state && Array.isArray(o.state.items)) return { kind: "old", ...convertOld(o.state, base) };
  return null;
}

const unitOf = (u: unknown): Unit => (UNITS.includes(u as Unit) ? (u as Unit) : "шт");
const placeOf = (p: unknown): Place => (PLACES.includes(p as Place) ? (p as Place) : "Холодильник");
const n = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

function convertOld(st: any, base: Settings): { backup: Backup; counts: { products: number; log: number; recipes: number } } {
  const products: Product[] = [];
  for (const it of st.items as any[]) {
    if (!it || typeof it.name !== "string") continue;
    const amount = n(it.amount), left = n(it.left);
    const qty = left ?? amount ?? 1;
    const until = typeof it.ud === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.ud) ? it.ud : n(it.until) ? ymd(new Date(it.until)) : null;
    products.push({
      id: typeof it.id === "string" ? it.id : uid(), name: it.name.trim(), qty, initialQty: Math.max(qty, amount ?? qty),
      unit: unitOf(it.unit), place: placeOf(it.place), bought: ymd(), until, price: n(it.price) ?? 0, opened: null, createdAt: Date.now(),
    });
  }
  const R: Record<string, Reason> = { b: "bought", e: "eaten", t: "spoiled", c: "cooked" };
  const log: LogEntry[] = (Array.isArray(st.log) ? st.log : []).filter((x: any) => x && R[x.k] && typeof x.n === "string").map((x: any) => {
    const e: LogEntry = { id: typeof x.i === "string" ? x.i : uid(), t: n(x.t) ?? Date.now(), name: x.n, reason: R[x.k], qty: n(x.q) ?? 0, unit: unitOf(x.u), rub: n(x.r) ?? 0 };
    if (typeof x.d === "string") e.dish = x.d;
    return e;
  });
  const recipes: Recipe[] = (Array.isArray(st.fav) ? st.fav : []).filter((f: any) => f && typeof f.name === "string").map((f: any) => ({
    id: uid(), name: f.name, minutes: n(f.minutes) ?? undefined, servings: n(f.servings) ?? undefined,
    ingredients: (Array.isArray(f.ingredients) ? f.ingredients : []).filter((i: any) => i && i.name).map((i: any) => ({ name: String(i.name), amount: String(i.amount ?? "") })),
    steps: (Array.isArray(f.steps) ? f.steps : []).map(String), why: typeof f.why === "string" ? f.why : undefined,
    source: "old" as const, fav: true, createdAt: n(f.t) ?? Date.now(),
  }));
  const lastBuy: Settings["lastBuy"] = { ...base.lastBuy };
  if (st.hist && typeof st.hist === "object") {
    for (const [k, h] of Object.entries<any>(st.hist)) {
      if (!h) continue;
      lastBuy[norm(k)] = { name: h.name || k, price: n(h.price) ?? 0, qty: n(h.amount) ?? 1, unit: unitOf(h.unit), place: placeOf(h.place), n: n(h.n) ?? 1, t: n(h.t) ?? 0 };
    }
  }
  const settings: Settings = { ...base, lastBuy };
  if (Array.isArray(st.family) && st.family.length === 2) {
    settings.members = base.members.map((m, i) => ({ ...m, name: (st.family[i] && typeof st.family[i].name === "string" && st.family[i].name.trim()) || m.name }));
  }
  return {
    backup: { app: BACKUP_APP, v: 1, at: new Date().toISOString(), products, log, recipes, settings },
    counts: { products: products.length, log: log.length, recipes: recipes.length },
  };
}
