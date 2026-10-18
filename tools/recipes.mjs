// Превращает текстовые файлы рецептов (папка recipes/) в базу recipes.json.
//
// Формат одного рецепта (рецепты разделяются пустой строкой):
//   # Название | вид блюда | минуты | порции | метки через запятую | кухня (необязательно)
//   Продукт: количество; Продукт: количество; ...
//   - Шаг первый.
//   - Шаг второй.
//   = Активно: 20                   (необязательно: активное время, мин — сколько стоять у плиты)
//   = Посуда: кастрюля 3 л, тёрка   (необязательно)
//   = Подача: …                      (необязательно)
//   = Хранение: …                    (необязательно)
//   = Совет: …                       (необязательно, можно несколько)
// Строки, начинающиеся с //, — комментарии.
// Название не меняйте: по нему считается id рецепта, с ним связаны избранное, оценки и фото у людей.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Те же кухни, что в src/lib/cuisine.ts (фильтр «Кухня» в приложении).
const CUISINES = ["Русская", "Кавказская", "Среднеазиатская", "Итальянская", "Азиатская", "Европейская", "Ближневосточная", "Американская"];

/** Устойчивый id по названию: при правке текста рецепта избранное не теряется. */
function hashId(s) {
  let h = 2166136261;
  for (const ch of s.toLowerCase()) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return "b-" + (h >>> 0).toString(36);
}

// Строки «= Ключ: значение» → поля рецепта
const EXTRA = { "активно": "active", "посуда": "tools", "подача": "serve", "хранение": "keep", "совет": "tips" };

export function parseRecipeText(text, file = "") {
  const out = [], errors = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
    if (!lines.length) continue;
    const head = lines[0];
    if (!head.startsWith("#")) { errors.push(`${file}: ожидался заголовок «# …», а пришло: ${head.slice(0, 60)}`); continue; }
    const [name, kind, minutes, servings, tags, cuisine] = head.slice(1).split("|").map((x) => (x || "").trim());
    const ingredients = [], steps = [], extra = { tips: [] };
    for (const l of lines.slice(1)) {
      if (l.startsWith("-")) { steps.push(l.replace(/^-\s*/, "")); continue; }
      if (l.startsWith("=")) {
        const m = l.match(/^=\s*([^:]+):\s*(.+)$/);
        const key = m && EXTRA[m[1].trim().toLowerCase()];
        if (!key) { errors.push(`${file}: «${name}» — непонятная строка «${l.slice(0, 40)}»`); continue; }
        if (key === "tips") extra.tips.push(m[2].trim());
        else if (key === "active") extra.active = Number(m[2].replace(/[^\d]/g, "")) || undefined;
        else extra[key] = m[2].trim();
        continue;
      }
      for (const part of l.split(";")) {
        const p = part.trim();
        if (!p) continue;
        const i = p.indexOf(":");
        if (i < 0) ingredients.push({ name: p, amount: "" });
        else ingredients.push({ name: p.slice(0, i).trim(), amount: p.slice(i + 1).trim() });
      }
    }
    const r = {
      id: hashId(name), name, kind: kind || undefined,
      minutes: Number(minutes) || undefined, servings: Number(servings) || 2,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      ingredients, steps, source: "base",
    };
    if (extra.active) r.active = extra.active;
    for (const k of ["tools", "serve", "keep"]) if (extra[k]) r[k] = extra[k];
    if (extra.tips.length) r.tips = extra.tips;
    if (r.active && r.minutes && r.active > r.minutes) errors.push(`${file}: «${name}» — активное время больше общего`);
    if (cuisine) {
      if (CUISINES.includes(cuisine)) r.cuisine = cuisine;
      else errors.push(`${file}: «${name}» — неизвестная кухня «${cuisine}»`);
    }
    if (!name) errors.push(`${file}: рецепт без названия`);
    if (ingredients.length < 2) errors.push(`${file}: «${name}» — меньше двух ингредиентов`);
    if (steps.length < 2) errors.push(`${file}: «${name}» — меньше двух шагов`);
    out.push(r);
  }
  return { recipes: out, errors };
}

export function loadAll(dir = "recipes") {
  const all = [], errors = [];
  if (!existsSync(dir)) return { recipes: all, errors };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()) {
    const r = parseRecipeText(readFileSync(join(dir, f), "utf8"), f);
    all.push(...r.recipes); errors.push(...r.errors);
  }
  const seen = new Map();
  for (const r of all) {
    if (seen.has(r.id)) errors.push(`Повтор названия: «${r.name}»`);
    seen.set(r.id, r);
  }
  return { recipes: all, errors };
}
