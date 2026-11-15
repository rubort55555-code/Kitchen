// Сущность «Продукт дома»: что лежит в холодильнике, морозилке или шкафу, сколько и почём.
import { addDays, daysLeft } from "./date";

export type Place = "Холодильник" | "Морозилка" | "Шкаф";
export const PLACES: Place[] = ["Холодильник", "Морозилка", "Шкаф"];

export type Unit = "г" | "кг" | "мл" | "л" | "шт" | "уп";
export const UNITS: Unit[] = ["шт", "г", "кг", "мл", "л", "уп"];

/** Продукт, который лежит дома. */
export interface Product {
  id: string;
  name: string;
  /** Количество, которое осталось сейчас. */
  qty: number;
  /** Сколько было при покупке — нужно, чтобы считать стоимость остатка. Не меньше qty. */
  initialQty: number;
  unit: Unit;
  place: Place;
  /** Дата покупки, ГГГГ-ММ-ДД. */
  bought: string;
  /** Годен до, ГГГГ-ММ-ДД; null — срок не важен (соль, крупы). */
  until: string | null;
  /** Цена за всё купленное количество, ₽. Не меньше 0. */
  price: number;
  /** Дата вскрытия упаковки, если вскрыта. */
  opened?: string | null;
  /** Штрихкод, если продукт добавлен сканированием. */
  barcode?: string;
  createdAt: number;
}

/** Количество — с точностью до тысячных (0,001 кг = 1 г). */
export const roundQty = (n: number): number => Math.round(n * 1000) / 1000;
/** Деньги — с точностью до копеек. */
export const roundRub = (n: number): number => Math.round(n * 100) / 100;

/** Что известно о новом продукте (из формы, чека или штрихкода). */
export interface NewProductData {
  name: string; qty: number; unit: Unit; place: Place; until: string | null; price: number;
  /** Дата покупки; нет — сегодня. */
  bought?: string;
  barcode?: string;
}

/** Новый продукт. id, время и сегодняшняя дата — снаружи. */
export function createProduct(d: NewProductData, at: { id: string; now: number; today: string }): Product {
  const p: Product = {
    id: at.id, name: d.name.trim(), qty: d.qty, initialQty: d.qty, unit: d.unit, place: d.place,
    bought: d.bought || at.today, until: d.until, price: Math.max(0, d.price), opened: null, createdAt: at.now,
  };
  if (d.barcode) p.barcode = d.barcode;
  return p;
}

/** Сколько стоит qty этого продукта по цене покупки. */
export function costOf(p: Product, qty: number): number {
  return p.initialQty ? (p.price * qty) / p.initialQty : 0;
}

/** Стоимость того, что осталось. */
export const valueOf = (p: Product): number => costOf(p, p.qty);

export interface Taken {
  /** Продукт после списания; null — продукт закончился и уходит из списка. */
  left: Product | null;
  /** Сколько взяли на самом деле: не больше, чем было. */
  taken: number;
  /** Стоимость взятого, ₽. */
  rub: number;
}

/** Взять часть продукта (съели, приготовили, выбросили). Больше, чем есть, взять нельзя; закончившийся продукт исчезает. */
export function takeProduct(p: Product, qty: number): Taken {
  const taken = Math.min(Math.max(0, qty), p.qty);
  const rest = roundQty(p.qty - taken);
  return { left: rest <= 0 ? null : { ...p, qty: rest }, taken, rub: costOf(p, taken) };
}

/**
 * Правка продукта вручную. Если количество стало больше купленного — «купленное» растёт вместе с ним
 * (иначе стоимость остатка оказалась бы больше цены покупки). qtyDelta — на сколько изменилось количество.
 */
export function editProduct(p: Product, patch: Partial<Product>): { product: Product; qtyDelta: number } {
  const product = { ...p, ...patch };
  const qtyDelta = patch.qty !== undefined && patch.qty !== p.qty ? product.qty - p.qty : 0;
  if (qtyDelta && product.qty > product.initialQty) product.initialQty = product.qty;
  return { product, qtyDelta };
}

/**
 * Вскрыли упаковку сегодня. openDays — сколько дней хранится вскрытым (из справочника; нет — срок не меняется).
 * Срок только сокращается: если до конца прежнего срока меньше, чем openDays, остаётся прежний.
 */
export function openProduct(p: Product, today: string, openDays?: number): Product {
  let until = p.until;
  if (openDays) {
    const byOpen = addDays(today, openDays);
    if (!until || daysLeft(byOpen, today)! < (daysLeft(until, today) ?? 99999)) until = byOpen;
  }
  return { ...p, opened: today, until };
}
