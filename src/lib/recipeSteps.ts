// Технологическая карта на экране: этапы, продукты для шага, вес «штук» и «ложек» в граммах.
import type { Ingredient, Recipe } from "./types";
import { norm } from "./util";
import { gramsOf, unitKey } from "./recipeNutrition";

/** Название этапа, к которому относится шаг (или null). */
export function stageOf(r: Recipe, step: number): string | null {
  let t: string | null = null;
  for (const s of r.stages || []) if (s.i <= step) t = s.t;
  return t;
}

/** Продукты, которые упоминаются в шаге (по основе слова: «куриные бёдра» — «бёдра», «бедра»). */
export function stepIngredients(r: Recipe, text: string): Ingredient[] {
  const t = norm(text);
  return r.ingredients.filter((i) => {
    const words = norm(i.name).split(/[^а-яa-z]+/).filter((w) => w.length > 2);
    return words.some((w) => t.includes(w.slice(0, Math.max(3, w.length - 2))));
  });
}

/** «≈100 г» для количеств в штуках, ложках, зубчиках; пусто для граммов, литров и «по вкусу». */
export function weightHint(i: Ingredient): string {
  const u = unitKey((i.amount || "").replace(/^[\d.,\/–\- ]+/, ""));
  if (["г", "кг", "мл", "л", ""].includes(u)) return "";
  const g = gramsOf(i);
  if (!g || g < 1) return "";
  return `≈${g >= 100 ? Math.round(g / 10) * 10 : Math.round(g)} г`;
}
