// Единицы измерения и пересчёт: 500 г + 1 кг = 1,5 кг.
import type { Unit } from "./types";
import { num } from "./util";

type Base = "g" | "ml" | "pcs" | "pack";
const BASE: Record<Unit, [Base, number]> = {
  г: ["g", 1], кг: ["g", 1000], мл: ["ml", 1], л: ["ml", 1000], шт: ["pcs", 1], уп: ["pack", 1],
};

export function sameKind(a: Unit, b: Unit): boolean {
  return BASE[a][0] === BASE[b][0];
}

/** Переводит количество из одной единицы в другую (если они одного рода). */
export function convert(qty: number, from: Unit, to: Unit): number | null {
  if (!sameKind(from, to)) return null;
  return (qty * BASE[from][1]) / BASE[to][1];
}

/** Складывает количества: результат в «красивой» единице. */
export function addQty(a: number, ua: Unit, b: number, ub: Unit): { qty: number; unit: Unit } | null {
  const c = convert(b, ub, ua);
  if (c === null) return null;
  return pretty(a + c, ua);
}

/** 1500 г → 1,5 кг; 0,3 кг → 300 г. */
export function pretty(qty: number, unit: Unit): { qty: number; unit: Unit } {
  if (unit === "г" && qty >= 1000) return { qty: qty / 1000, unit: "кг" };
  if (unit === "мл" && qty >= 1000) return { qty: qty / 1000, unit: "л" };
  if (unit === "кг" && qty > 0 && qty < 1) return { qty: Math.round(qty * 1000), unit: "г" };
  if (unit === "л" && qty > 0 && qty < 1) return { qty: Math.round(qty * 1000), unit: "мл" };
  return { qty, unit };
}

export function qtyText(qty: number, unit: Unit): string {
  const p = pretty(qty, unit);
  return num(p.qty, p.unit === "кг" || p.unit === "л" ? 2 : 1) + " " + p.unit;
}

/** Шаг для кнопок «+/−» в зависимости от единицы. */
export function stepFor(unit: Unit): number {
  return unit === "г" || unit === "мл" ? 100 : unit === "кг" || unit === "л" ? 0.5 : 1;
}

/** Быстрые варианты количества для формы добавления. */
export function quickAmounts(unit: Unit): number[] {
  switch (unit) {
    case "г": return [100, 200, 300, 500];
    case "мл": return [200, 500, 900];
    case "кг": return [0.5, 1, 1.5, 2];
    case "л": return [0.5, 0.9, 1, 1.5];
    case "уп": return [1, 2];
    default: return [1, 2, 6, 10];
  }
}
