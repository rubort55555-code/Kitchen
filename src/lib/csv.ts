// Выгрузка в CSV (для Excel/Numbers): разделитель «;», с BOM, чтобы русский не ломался.
import type { LogEntry, Product } from "./types";
import { REASON_TEXT } from "./types";

const cell = (v: unknown): string => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const date = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const toCsv = (rows: unknown[][]) => "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";

export function productsCsv(products: Product[]): string {
  return toCsv([
    ["Название", "Осталось", "Единица", "Место", "Куплено", "Годен до", "Цена за всё, ₽", "Было при покупке"],
    ...products.map((p) => [p.name, num(p.qty), p.unit, p.place, p.bought, p.until || "", num(p.price), num(p.initialQty)]),
  ]);
}

export function logCsv(log: LogEntry[]): string {
  return toCsv([
    ["Дата", "Продукт", "Причина", "Количество", "Единица", "Сумма, ₽", "Место", "Блюдо"],
    ...[...log].sort((a, b) => a.t - b.t).map((e) => [date(e.t), e.name, REASON_TEXT[e.reason], num(e.qty), e.unit, num(e.rub), e.place || "", e.dish || ""]),
  ]);
}

/** Цены: каждая покупка с ценой за кг/л/шт. */
export function pricesCsv(log: LogEntry[]): string {
  return toCsv([
    ["Дата", "Продукт", "Количество", "Единица", "Заплатили, ₽", "Цена за кг/л/шт, ₽"],
    ...[...log].filter((e) => e.reason === "bought" && e.qty > 0).sort((a, b) => a.t - b.t).map((e) => {
      const big = e.unit === "г" || e.unit === "мл" ? 1000 : 1;
      const per = (e.rub / e.qty) * big;
      return [date(e.t), e.name, num(e.qty), e.unit, num(e.rub), num(per)];
    }),
  ]);
}
