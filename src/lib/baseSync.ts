// Обновление встроенной базы рецептов: новые рецепты добавляются, исправленные в базе — обновляются у всех,
// но только если человек сам их не менял (тогда остаётся его версия). Удалённые рецепты не возвращаются.
import type { Recipe } from "./types";

/** Поля рецепта, которые приходят из базы. Избранное, оценка, фото, заметка и история — личные, их не трогаем. */
const KEYS = ["name", "kind", "minutes", "servings", "tags", "ingredients", "steps", "cuisine", "active", "tools", "serve", "keep", "tips", "stages", "out", "done", "fixes"] as const;

/** Подпись содержимого рецепта: по ней видно, менялся ли рецепт. */
export function recipeSig(r: Recipe): string {
  const t = JSON.stringify(KEYS.map((k) => r[k] ?? null));
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36) + "-" + t.length;
}

/**
 * base — часть базы с сайта; have — рецепты в телефоне; seen — все рецепты, когда-либо добавленные из базы;
 * sigs — подпись каждого рецепта в том виде, в каком его последний раз положили из базы (меняется здесь же).
 */
export function mergeBase(base: Recipe[], have: Map<string, Recipe>, seen: Set<string>, sigs: Record<string, string>): { add: Recipe[]; update: Recipe[] } {
  const add: Recipe[] = [], update: Recipe[] = [];
  for (const r of base) {
    const s = recipeSig(r);
    const mine = have.get(r.id);
    if (!mine) {
      if (!seen.has(r.id)) { add.push({ ...r, createdAt: 0 }); sigs[r.id] = s; }
      continue;
    }
    if (mine.source !== "base" || sigs[r.id] === s) continue;
    const ms = recipeSig(mine);
    if (ms === s) { sigs[r.id] = s; continue; }
    // Рецепт в телефоне такой же, каким пришёл из базы в прошлый раз, — значит, человек его не менял.
    // Подписи нет (рецепт пришёл до этой функции) — рецепт из базы и через редактор не правился
    // (правка в редакторе делает его «своим», source: manual), значит, тоже обновляем.
    if (sigs[r.id] ? ms === sigs[r.id] : true) {
      const u: Record<string, unknown> = { ...mine };
      for (const k of KEYS) { if (r[k] === undefined) delete u[k]; else u[k] = r[k]; }
      update.push(u as unknown as Recipe);
      sigs[r.id] = s;
    }
  }
  return { add, update };
}

/**
 * Рецепты, которые убрали из базы: их удаляем и из телефона, но только если в них нет ничего личного —
 * избранного, оценки, фото, заметки, истории готовки, правок человека — и они не стоят в меню (keep).
 * ids — все рецепты нынешней базы.
 */
export function staleBase(have: Recipe[], ids: Set<string>, sigs: Record<string, string>, keep: Set<string>): string[] {
  return have
    .filter((r) => r.source === "base" && !ids.has(r.id) && !keep.has(r.id))
    .filter((r) => !r.fav && !r.rating && !r.photo && !r.note && !r.history?.length)
    .filter((r) => !sigs[r.id] || recipeSig(r) === sigs[r.id])
    .map((r) => r.id);
}
