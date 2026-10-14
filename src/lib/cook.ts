// «Приготовили»: что списать со склада для рецепта и сколько стоит блюдо и порция.
// Здесь только расчёт (без записи в базу) — запись делает applyCook в store.ts.
import { substitutes } from "./subs";
import type { Product, Recipe, Settings, Unit } from "./types";
import { findCatalog } from "./catalog";
import { keyOf, keysFor, covers } from "./match";
import { convert } from "./units";
import { daysLeft, norm, toNum } from "./util";

export interface Need { qty: number; unit: Unit }

/** Сколько граммов в одной штуке — чтобы «2 помидора» превращались в килограммы на складе. */
const PIECE_G: Record<string, number> = {
  "помидоры": 120, "огурцы": 120, "картофель": 100, "морковь": 100, "лук репчатый": 100, "свекла": 200,
  "яблоки": 150, "бананы": 120, "апельсины": 200, "груши": 150, "лимон": 100, "кабачок": 300,
  "йогурт": 125, "сосиски": 50, "баклажан": 250, "перец болгарский": 150, "чеснок": 40, "капуста пекинская": 600, "авокадо": 200, "киви": 80,
};

function pieceG(name: string): number | null {
  const c = findCatalog(name);
  return c ? PIECE_G[norm(c.n)] ?? null : null;
}

const toG = (q: number, u: Unit) => (u === "г" || u === "мл" ? q : u === "кг" || u === "л" ? q * 1000 : null);
const fromG = (g: number, u: Unit) => (u === "г" || u === "мл" ? g : u === "кг" || u === "л" ? g / 1000 : null);

/** Перевод количества между единицами. Граммы и миллилитры считаем 1:1 (ложки, стаканы), штуки — по таблице весов. */
export function conv(q: number, from: Unit, to: Unit, name: string): number | null {
  if (from === to) return q;
  const c = convert(q, from, to);
  if (c !== null) return c;
  const g = toG(q, from);
  if (g !== null) {
    const r = fromG(g, to);
    if (r !== null) return r;
    const w = pieceG(name);
    return to === "шт" && w ? g / w : null;
  }
  if (from === "шт") {
    const w = pieceG(name);
    return w ? fromG(q * w, to) : null;
  }
  return null;
}

const FREE_RE = /щепот|по вкусу|кончик|для подач|для посып|для украш|немного|капл/;

/** Разбирает количество из рецепта: «200 г», «2 ст. л.», «3 зубчика», «0,5 уп». "free" — не списываем (щепотка, по вкусу). */
export function parseNeed(amount: string): Need | "free" | null {
  const a = norm(amount);
  if (!a) return null;
  if (FREE_RE.test(a)) return "free";
  const m = a.match(/^(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(.*)$/);
  if (!m) return /половин/.test(a) ? { qty: 0.5, unit: "шт" } : null;
  const n = toNum(m[2] ?? m[1]);
  if (n === null) return null;
  const w = m[3].replace(/[.,]/g, "").trim();
  if (w === "") return { qty: n, unit: "шт" };
  if (/^ст ?л$|^столов[а-я]*/.test(w) || /^ложк[а-я]*$/.test(w)) return { qty: n * 15, unit: "мл" };
  if (/^ч ?л$|^чайн[а-я]*/.test(w)) return { qty: n * 5, unit: "мл" };
  if (/^стакан[а-я]*$/.test(w)) return { qty: n * 200, unit: "мл" };
  if (/^горст[а-я]*$/.test(w)) return { qty: n * 45, unit: "г" };
  if (/^зубчик[а-я]*$/.test(w)) return { qty: n / 10, unit: "шт" };
  if (/^ломтик[а-я]*$/.test(w)) return { qty: n / 15, unit: "шт" };
  if (/^стебл[а-я]*$/.test(w)) return { qty: n / 10, unit: "уп" };
  if (/^пучо?к[а-я]*$|^пучк[а-я]*$/.test(w)) return { qty: n, unit: "уп" };
  if (/^(кг|килограмм[а-я]*)$/.test(w)) return { qty: n, unit: "кг" };
  if (/^(г|гр|грамм[а-я]*)$/.test(w)) return { qty: n, unit: "г" };
  if (/^(мл|миллилитр[а-я]*)$/.test(w)) return { qty: n, unit: "мл" };
  if (/^(л|литр[а-я]*)$/.test(w)) return { qty: n, unit: "л" };
  if (/^(уп|упак[а-я]*|пач[а-я]*)$/.test(w)) return { qty: n, unit: "уп" };
  if (/^(шт|штук[а-я]*|банк[а-я]*)$/.test(w)) return { qty: n, unit: "шт" };
  return null;
}

export interface CookTake { productId: string; name: string; take: number; unit: Unit; have: number; rub: number; until: string | null }

export interface CookRow {
  /** Номер ингредиента в рецепте — по нему хранятся правки на экране. */
  key: string;
  name: string;
  /** Количество из рецепта с учётом порций, как написано. */
  amount: string;
  /** Единица, в которой показываем и правим количество. */
  unit: Unit | null;
  /** Сколько нужно (в unit). */
  qty: number;
  on: boolean;
  takes: CookTake[];
  /** Не хватило дома (в unit); 0 — хватило. */
  short: number;
  noStock: boolean;
  /** Не смогли понять количество или перевести единицы — нужно вписать самому. */
  manual: boolean;
  /** Стоимость этой строки (со склада + оценка того, чего нет дома). */
  rub: number;
  /** Часть цены — оценка по прошлым покупкам или неизвестна. */
  estimated: boolean;
}

export interface CookPlan { rows: CookRow[]; skipped: string[]; cost: number; estimated: boolean }
export interface Override { on?: boolean; qty?: number }

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const byUntil = (a: Product, b: Product) => (daysLeft(a.until) ?? 99999) - (daysLeft(b.until) ?? 99999);

/** Цена за единицу по последней покупке; null — не знаем. */
function lastUnitPrice(name: string, settings: Settings): { per: number; unit: Unit } | null {
  const c = findCatalog(name, settings.customCatalog);
  const lb = settings.lastBuy[norm(name)] || (c ? settings.lastBuy[norm(c.n)] : undefined);
  return lb && lb.qty > 0 ? { per: lb.price / lb.qty, unit: lb.unit } : null;
}

/** Считает, что и сколько списать при приготовлении рецепта на servings порций. */
export function planCook(r: Recipe, servings: number, products: Product[], settings: Settings, ov: Record<string, Override> = {}): CookPlan {
  const factor = servings > 0 && r.servings ? servings / r.servings : 1;
  const basicKeys = new Set(settings.basics.map((b) => keyOf(b, settings.customCatalog)));
  const used = new Map<string, number>();
  const rows: CookRow[] = [];
  const skipped: string[] = [];

  r.ingredients.forEach((ing, idx) => {
    const key = String(idx);
    const k = keyOf(ing.name, settings.customCatalog);
    if (keysFor(ing.name, settings.customCatalog).some((x) => basicKeys.has(x)) || /^вода|^соль/.test(norm(ing.name))) { skipped.push(ing.name); return; }
    const parsed = parseNeed(ing.amount);
    if (parsed === "free") { skipped.push(ing.name); return; }

    let stock = products.filter((p) => covers(p.name, k, settings.customCatalog)).sort(byUntil);
    // Нужного нет дома — берём замену, если она есть (сметана → йогурт)
    if (!stock.length) {
      for (const s of substitutes(ing.name, settings.customCatalog)) {
        const sk = keyOf(s, settings.customCatalog);
        const f = products.filter((p) => covers(p.name, sk, settings.customCatalog)).sort(byUntil);
        if (f.length) { stock = f; break; }
      }
    }
    const o = ov[key] || {};
    const unit: Unit | null = stock[0]?.unit ?? parsed?.unit ?? null;
    let need: Need | null = parsed ? { qty: round3(parsed.qty * factor), unit: parsed.unit } : null;
    if (o.qty !== undefined && unit) need = { qty: o.qty, unit };

    const takes: CookTake[] = [];
    let manual = false, short = 0, rub = 0, estimated = false;
    if (need && stock.length) {
      let rem = need.qty;
      for (const p of stock) {
        const avail = p.qty - (used.get(p.id) || 0);
        if (avail <= 1e-9) continue;
        const availNeed = conv(avail, p.unit, need.unit, p.name);
        if (availNeed === null) { manual = true; break; }
        const takeNeed = Math.min(rem, availNeed);
        const takeP = round3(takeNeed >= availNeed ? avail : conv(takeNeed, need.unit, p.unit, p.name)!);
        if (takeP <= 0) continue;
        used.set(p.id, (used.get(p.id) || 0) + takeP);
        const value = p.initialQty ? (p.price * takeP) / p.initialQty : 0;
        takes.push({ productId: p.id, name: p.name, take: takeP, unit: p.unit, have: p.qty, rub: value, until: p.until });
        rub += value;
        rem -= takeNeed;
        if (rem <= 1e-9) { rem = 0; break; }
      }
      if (!manual && rem > 1e-9) short = rem;
    } else if (need) {
      short = need.qty; // дома нет совсем
    } else {
      manual = true;
    }

    // Чего не хватает дома — оцениваем по последней цене покупки
    if (need && !manual && short > 0) {
      const lp = lastUnitPrice(ing.name, settings);
      const inLb = lp ? conv(short, need.unit, lp.unit, ing.name) : null;
      if (lp && inLb !== null) rub += lp.per * inLb;
      estimated = true;
    }
    if (manual) estimated = true;

    const shortInUnit = short > 0 && need && unit ? conv(short, need.unit, unit, ing.name) ?? 0 : 0;
    const qty = need && unit ? conv(need.qty, need.unit, unit, ing.name) ?? 0 : 0;
    // Галочка «использовали»: по умолчанию стоит везде, где поняли количество. Если дома нет — списывать нечего, но в стоимость блюда войдёт.
    const on = o.on !== undefined ? o.on : !manual;
    rows.push({
      key, name: ing.name, amount: ing.amount, unit, qty: round3(qty), on, takes, short: round3(shortInUnit),
      noStock: stock.length === 0, manual, rub, estimated,
    });
  });

  const active = rows.filter((x) => x.on);
  return {
    rows, skipped,
    cost: active.reduce((s, x) => s + x.rub, 0),
    estimated: active.some((x) => x.estimated),
  };
}
