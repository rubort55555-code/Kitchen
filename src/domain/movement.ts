// Сущность «Движение продукта»: запись журнала «куплено / съедено / приготовлено / пропало / выброшено / исправлено».
// Из журнала строится статистика «сколько съели и сколько пропало — в количестве и рублях».
import { roundQty, roundRub, type Place, type Product, type Unit } from "./product";

/** Причина изменения количества — основа статистики «съедено / пропало / осталось». */
export type Reason = "bought" | "eaten" | "cooked" | "spoiled" | "thrown" | "adjust";
export const REASONS: Reason[] = ["bought", "eaten", "cooked", "spoiled", "thrown", "adjust"];

export const REASON_TEXT: Record<Reason, string> = {
  bought: "Куплено",
  eaten: "Съедено",
  cooked: "Приготовлено",
  spoiled: "Пропало",
  thrown: "Выброшено",
  adjust: "Исправлено",
};

export interface LogEntry {
  id: string;
  t: number;
  productId?: string;
  name: string;
  reason: Reason;
  qty: number;
  unit: Unit;
  /** Стоимость этого количества, ₽. */
  rub: number;
  place?: Place;
  dish?: string;
}

/** Запись о движении продукта. Количество — до тысячных, деньги — до копеек. id и время — снаружи. */
export function movement(p: Product, reason: Reason, qty: number, rub: number, at: { id: string; now: number }, dish?: string): LogEntry {
  const e: LogEntry = { id: at.id, t: at.now, productId: p.id, name: p.name, reason, qty: roundQty(qty), unit: p.unit, rub: roundRub(rub), place: p.place };
  if (dish) e.dish = dish;
  return e;
}

/**
 * Цену продукта исправили — исправляем и его записи «Куплено».
 * Иначе в статистике «съедено» по новой цене окажется больше, чем «куплено» по старой. Возвращает только изменённые записи.
 */
export function repriceBought(log: LogEntry[], p: Product): LogEntry[] {
  return log.filter((e) => e.productId === p.id && e.reason === "bought").map((e) => ({ ...e, rub: roundRub(p.price) }));
}
