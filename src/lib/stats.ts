// Подсчёты для главной: съедено / пропало за месяц (полная статистика — на этапе 3).
import type { LogEntry } from "./types";

export interface Summary { bought: number; eaten: number; lost: number; lostPct: number; lostCount: number }

export function monthStart(d = new Date()): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function summary(log: LogEntry[], from: number, to = Infinity): Summary {
  let bought = 0, eaten = 0, lost = 0, lostCount = 0;
  for (const e of log) {
    if (e.t < from || e.t >= to) continue;
    if (e.reason === "bought") bought += e.rub;
    else if (e.reason === "eaten" || e.reason === "cooked") eaten += e.rub;
    else if (e.reason === "spoiled" || e.reason === "thrown") { lost += e.rub; lostCount++; }
  }
  const used = eaten + lost;
  return { bought, eaten, lost, lostCount, lostPct: used > 0 ? Math.round((lost / used) * 100) : 0 };
}

// ---------- полная статистика ----------
import { findCatalog } from "./catalog";
import { norm, plural, rub } from "./util";
import type { Product } from "./types";

export type Period = "week" | "month" | "year";
export const PERIOD_TEXT: Record<Period, string> = { week: "Неделя", month: "Месяц", year: "Год" };

export function periodStart(p: Period, now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (p === "week") d.setDate(d.getDate() - 6);
  else if (p === "month") d.setDate(1);
  else { d.setMonth(0); d.setDate(1); }
  return d.getTime();
}
export const periodDays = (p: Period, now = new Date()) => Math.max(1, Math.round((now.getTime() - periodStart(p, now)) / 86400000) + 1);

/** Сумма количеств по журналу: вес (кг), объём (л) и штуки отдельно, чтобы не смешивать разное. */
export interface Amount { kg: number; l: number; pcs: number }
export function addAmount(a: Amount, qty: number, unit: string) {
  if (unit === "г") a.kg += qty / 1000; else if (unit === "кг") a.kg += qty;
  else if (unit === "мл") a.l += qty / 1000; else if (unit === "л") a.l += qty;
  else a.pcs += qty;
}
export function amountText(a: Amount): string {
  const parts: string[] = [];
  const f = (v: number) => (Math.round(v * 10) / 10).toString().replace(".", ",");
  if (a.kg > 0.0499) parts.push(`${f(a.kg)} кг`);
  if (a.l > 0.0499) parts.push(`${f(a.l)} л`);
  if (a.pcs > 0) parts.push(`${f(a.pcs)} шт`);
  return parts.join(" + ") || "—";
}

export interface Totals { rub: number; amount: Amount; n: number }
const zero = (): Totals => ({ rub: 0, amount: { kg: 0, l: 0, pcs: 0 }, n: 0 });
const put = (t: Totals, e: LogEntry) => { t.rub += e.rub; addAmount(t.amount, e.qty, e.unit); t.n++; };

export interface Report {
  bought: Totals; eaten: Totals; lost: Totals; left: { rub: number; n: number };
  lostPct: number;
  topLost: { name: string; rub: number; amount: Amount; n: number }[];
  byPlace: { place: string; rub: number }[];
  byCategory: { cat: string; eaten: number; lost: number }[];
}

export function report(log: LogEntry[], products: Product[], from: number, to = Infinity): Report {
  const bought = zero(), eaten = zero(), lost = zero();
  const top = new Map<string, { name: string; rub: number; amount: Amount; n: number }>();
  const cat = new Map<string, { eaten: number; lost: number }>();
  const place = new Map<string, number>();
  for (const e of log) {
    if (e.t < from || e.t >= to) continue;
    const c = findCatalog(e.name)?.c || "Другое";
    if (e.reason === "bought") put(bought, e);
    else if (e.reason === "eaten" || e.reason === "cooked") { put(eaten, e); const x = cat.get(c) || { eaten: 0, lost: 0 }; x.eaten += e.rub; cat.set(c, x); }
    else if (e.reason === "spoiled" || e.reason === "thrown") {
      put(lost, e);
      const k = norm(e.name); const t = top.get(k) || { name: e.name, rub: 0, amount: { kg: 0, l: 0, pcs: 0 }, n: 0 };
      t.rub += e.rub; t.n++; addAmount(t.amount, e.qty, e.unit); top.set(k, t);
      const x = cat.get(c) || { eaten: 0, lost: 0 }; x.lost += e.rub; cat.set(c, x);
      if (e.place) place.set(e.place, (place.get(e.place) || 0) + e.rub);
    }
  }
  const used = eaten.rub + lost.rub;
  return {
    bought, eaten, lost,
    left: { rub: products.reduce((s, p) => s + (p.initialQty ? (p.price * p.qty) / p.initialQty : 0), 0), n: products.length },
    lostPct: used > 0 ? Math.round((lost.rub / used) * 100) : 0,
    topLost: Array.from(top.values()).sort((a, b) => b.rub - a.rub).slice(0, 5),
    byPlace: Array.from(place, ([p, r]) => ({ place: p, rub: r })).sort((a, b) => b.rub - a.rub),
    byCategory: Array.from(cat, ([c, v]) => ({ cat: c, ...v })).sort((a, b) => b.eaten + b.lost - (a.eaten + a.lost)).slice(0, 6),
  };
}

export interface MonthRow { label: string; bought: number; lost: number; pct: number }
const MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
/** Последние n месяцев: расходы и потери. */
export function byMonth(log: LogEntry[], n = 6, now = new Date()): MonthRow[] {
  const out: MonthRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const a = new Date(now.getFullYear(), now.getMonth() - i, 1).getTime();
    const b = new Date(now.getFullYear(), now.getMonth() - i + 1, 1).getTime();
    const s = summary(log, a, b);
    out.push({ label: MON[new Date(a).getMonth()], bought: s.bought, lost: s.lost, pct: s.lostPct });
  }
  return out;
}

export interface PriceRow { name: string; unit: "кг" | "л" | "шт"; last: number; avg: number; changePct: number; n: number }
/** Цена за кг / л / штуку по покупкам и её изменение (последняя покупка против средней за прошлые). */
export function priceTrends(log: LogEntry[]): PriceRow[] {
  const by = new Map<string, { name: string; unit: "кг" | "л" | "шт"; list: { t: number; p: number }[] }>();
  for (const e of log) {
    if (e.reason !== "bought" || e.rub <= 0 || e.qty <= 0) continue;
    let unit: "кг" | "л" | "шт"; let q = e.qty;
    if (e.unit === "г") { unit = "кг"; q /= 1000; } else if (e.unit === "кг") unit = "кг";
    else if (e.unit === "мл") { unit = "л"; q /= 1000; } else if (e.unit === "л") unit = "л"; else unit = "шт";
    const k = norm(e.name) + unit;
    const x = by.get(k) || { name: e.name, unit, list: [] };
    x.list.push({ t: e.t, p: e.rub / q }); by.set(k, x);
  }
  const out: PriceRow[] = [];
  for (const x of by.values()) {
    if (x.list.length < 2) continue;
    x.list.sort((a, b) => a.t - b.t);
    const last = x.list[x.list.length - 1].p;
    const prev = x.list.slice(0, -1);
    const avg = prev.reduce((s, y) => s + y.p, 0) / prev.length;
    out.push({ name: x.name, unit: x.unit, last, avg, changePct: avg ? Math.round(((last - avg) / avg) * 100) : 0, n: x.list.length });
  }
  return out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/** Находки по правилам: тексты из шаблонов, без ИИ. */
export function insights(log: LogEntry[], rep: Report, days: number): string[] {
  const out: string[] = [];
  const since = Date.now() - 120 * 86400000;
  const per = new Map<string, { name: string; buys: number; lost: number; cat: string }>();
  for (const e of log) {
    if (e.t < since) continue;
    const k = norm(e.name);
    const x = per.get(k) || { name: e.name, buys: 0, lost: 0, cat: findCatalog(e.name)?.c || "" };
    if (e.reason === "bought") x.buys++;
    else if (e.reason === "spoiled" || e.reason === "thrown") x.lost++;
    per.set(k, x);
  }
  const items = Array.from(per.values()).filter((x) => x.buys >= 3 && x.lost > 0).map((x) => ({ ...x, share: Math.min(1, x.lost / x.buys) })).sort((a, b) => b.share - a.share);
  for (const x of items) {
    if (out.length >= 3) break;
    const pct = Math.round(x.share * 100);
    if (x.cat === "Зелень" && x.share >= 0.4) out.push(`${x.name} пропадает в ${pct}% случаев — попробуйте замораживать.`);
    else if (/хлеб|батон|булк/i.test(x.name) && x.share >= 0.3) out.push(`${x.name} вы покупаете чаще, чем успеваете съесть.`);
    else if (x.share >= 0.4) out.push(`${x.name} пропадает в ${Math.min(x.lost, x.buys)} из ${x.buys} ${plural(x.buys, "покупки", "покупок", "покупок")} — берите упаковку поменьше.`);
  }
  if (rep.lost.rub >= 100) {
    const year = Math.round((rep.lost.rub / days) * 365);
    out.push(`За этот период выброшено продуктов на ${rub(rep.lost.rub)} — при таком темпе это ${rub(year)} в год.`);
  } else if (rep.eaten.rub > 0) out.push("Потерь почти нет — так держать! 👏");
  const tr = priceTrends(log).filter((p) => p.changePct >= 15 && p.n >= 3)[0];
  if (tr) out.push(`${tr.name} подорожал(а) на ${tr.changePct}%: сейчас ${rub(tr.last)} за ${tr.unit}, обычно ${rub(tr.avg)}.`);
  return out;
}
