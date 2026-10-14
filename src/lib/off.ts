// Поиск товара по штрихкоду в Open Food Facts — открытой бесплатной базе товаров.
// Данные: © участники Open Food Facts, лицензия ODbL (https://world.openfoodfacts.org).
// Нужен интернет в момент поиска. Найденное запоминается в телефоне (настройки → barcodes),
// поэтому повторный скан того же товара работает и без интернета.
import type { CatalogItem, Unit } from "./types";
import { findCatalog } from "./catalog";
import { cap, norm } from "./util";

export const OFF_SITE = "https://world.openfoodfacts.org";
export const OFF_CREDIT = "© участники Open Food Facts, лицензия ODbL";

/** Пищевая ценность на 100 г (или 100 мл), как указано на упаковке. */
export interface Per100 { kcal?: number; p?: number; f?: number; c?: number; fiber?: number; sugar?: number; salt?: number }

export interface OffProduct {
  code: string;
  /** Название с упаковки (по-русски, если есть). */
  title: string;
  brand?: string;
  /** Вес/объём упаковки, если удалось разобрать. */
  qty?: number;
  unit?: Unit;
  quantityText?: string;
  per100?: Per100;
  /** Категории Open Food Facts, например «en:dairies». */
  cats?: string[];
}

const UNIT_MAP: [RegExp, Unit, number][] = [
  [/^(кг|kg)$/i, "кг", 1], [/^(г|гр|g|gr)$/i, "г", 1], [/^(мг|mg)$/i, "г", 0.001],
  [/^(л|l|lt|ltr)$/i, "л", 1], [/^(мл|ml)$/i, "мл", 1], [/^(cl)$/i, "мл", 10], [/^(дл|dl)$/i, "мл", 100],
  [/^(шт|pcs|pc|x)$/i, "шт", 1], [/^(уп|pack)$/i, "уп", 1],
];

/** «930 мл», «0,9 л», «6 x 330 ml», «10 шт.» → количество и единица. */
export function parseQuantity(s: string | undefined | null): { qty: number; unit: Unit } | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/,/g, ".").replace(/\s+/g, " ").trim();
  // «6 x 330 ml»
  const mult = t.match(/^(\d+)\s*[x×х*]\s*(\d+(?:\.\d+)?)\s*([a-zа-я]+)\.?/i);
  if (mult) {
    const u = unitOf(mult[3]);
    if (u) return { qty: round(+mult[1] * +mult[2] * u[1]), unit: u[0] };
  }
  const m = t.match(/(\d+(?:\.\d+)?)\s*([a-zа-я]+)\.?/i);
  if (!m) return null;
  const u = unitOf(m[2]);
  if (!u) return null;
  const q = round(+m[1] * u[1]);
  return q > 0 ? { qty: q, unit: u[0] } : null;
}
function unitOf(w: string): [Unit, number] | null {
  for (const [re, u, k] of UNIT_MAP) if (re.test(w)) return [u, k];
  return null;
}
const round = (n: number) => Math.round(n * 1000) / 1000;

const numOr = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? parseFloat(v.replace(",", ".")) : typeof v === "number" ? v : NaN;
  return isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : undefined;
};

/** Разбирает ответ API (v2) в понятный вид. null — товара нет в базе. */
export function fromOff(code: string, json: any): OffProduct | null {
  const p = json?.product;
  if (!p || json.status === 0) return null;
  const title = String(p.product_name_ru || p.generic_name_ru || p.product_name || p.generic_name || "").replace(/\s+/g, " ").trim();
  const brand = String(p.brands || "").split(",")[0].trim() || undefined;
  if (!title && !brand) return null;
  const n = p.nutriments || {};
  let kcal = numOr(n["energy-kcal_100g"]);
  if (kcal === undefined && numOr(n["energy_100g"]) !== undefined) kcal = Math.round(numOr(n["energy_100g"])! / 4.184);
  const per100: Per100 = {
    kcal, p: numOr(n.proteins_100g), f: numOr(n.fat_100g), c: numOr(n.carbohydrates_100g),
    fiber: numOr(n.fiber_100g), sugar: numOr(n.sugars_100g), salt: numOr(n.salt_100g),
  };
  for (const k of Object.keys(per100) as (keyof Per100)[]) if (per100[k] === undefined) delete per100[k];
  let q = parseQuantity(p.quantity);
  if (!q && p.product_quantity) {
    const u = String(p.product_quantity_unit || "g");
    q = parseQuantity(`${p.product_quantity} ${u}`);
  }
  return {
    code,
    title: title || brand!,
    brand,
    qty: q?.qty, unit: q?.unit,
    quantityText: p.quantity ? String(p.quantity) : undefined,
    per100: Object.keys(per100).length ? per100 : undefined,
    cats: Array.isArray(p.categories_tags) ? p.categories_tags.slice(0, 12) : undefined,
  };
}

const FIELDS = "code,product_name,product_name_ru,generic_name,generic_name_ru,brands,quantity,product_quantity,product_quantity_unit,nutriments,categories_tags";
const memo = new Map<string, OffProduct | null>();

export type LookupResult = { ok: true; product: OffProduct | null } | { ok: false; why: "offline" | "busy" | "error" };

/** Ищет товар в Open Food Facts. Не больше одного запроса на код за сеанс. */
export async function lookupOff(code: string, fetchFn: typeof fetch = fetch): Promise<LookupResult> {
  if (memo.has(code)) return { ok: true, product: memo.get(code)! };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, why: "offline" };
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 12000);
  try {
    const res = await fetchFn(`${OFF_SITE}/api/v2/product/${code}.json?fields=${FIELDS}&lc=ru`, { signal: ctl?.signal });
    if (res.status === 429 || res.status === 503) return { ok: false, why: "busy" };
    if (res.status === 404) { memo.set(code, null); return { ok: true, product: null }; }
    if (!res.ok) return { ok: false, why: "error" };
    const prod = fromOff(code, await res.json());
    memo.set(code, prod);
    return { ok: true, product: prod };
  } catch {
    return { ok: false, why: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Ссылка на страницу товара (там же можно добавить или исправить товар). */
export const offPage = (code: string) => `${OFF_SITE}/product/${code}`;

/** Короткая строка КБЖУ: «58 ккал · Б 3 · Ж 3,2 · У 4,7». */
export function per100Text(p?: Per100): string {
  if (!p) return "";
  const f = (n: number) => String(n).replace(".", ",");
  const parts: string[] = [];
  if (p.kcal !== undefined) parts.push(`${f(p.kcal)} ккал`);
  if (p.p !== undefined) parts.push(`Б ${f(p.p)}`);
  if (p.f !== undefined) parts.push(`Ж ${f(p.f)}`);
  if (p.c !== undefined) parts.push(`У ${f(p.c)}`);
  return parts.join(" · ");
}

/**
 * Как назвать товар в приложении: продукт из справочника («Молоко»), если он узнаётся по первым словам
 * названия, иначе — название с упаковки без марки и процентов. Марку убираем, чтобы
 * «Сметана Простоквашино» не стала «Простоквашей».
 */
export function nameFor(p: OffProduct, custom: CatalogItem[] = []): { name: string; cat: CatalogItem | null } {
  const clean = (x: string) => x.replace(/[«»"“”]/g, " ").replace(/\d+([.,]\d+)?\s*(%|г|гр|кг|мл|л|шт)\.?(?![а-яёa-z])/gi, " ").replace(/\s+/g, " ").trim();
  let t = clean(p.brand ? p.title.replace(new RegExp(p.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ") : p.title);
  // Если без марки осталось что-то невнятное («Zero») — оставляем название целиком
  if (t.length < 6 || (!/[а-яё]/i.test(t) && /[а-яё]/i.test(p.title))) t = clean(p.title);
  if (t.length < 4) t = p.title;
  const words = t.split(" ").filter(Boolean);
  const first = norm(words[0] || "").slice(0, 4);
  const fits = (c: CatalogItem | null) => !!c && first.length >= 3 && [c.n, ...(c.s || [])].some((x) => norm(x).split(/\s+/).some((w) => w.slice(0, 4) === first));
  for (const k of [words.length, 3, 2, 1]) {
    if (k > words.length || k < 1) continue;
    const c = findCatalog(words.slice(0, k).join(" "), custom);
    if (fits(c)) return { name: c!.n, cat: c };
  }
  const name = cap((t || p.title).slice(0, 48).trim());
  return { name, cat: null };
}
