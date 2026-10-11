// Разбор текста рецепта (с сайта, из заметок, из мессенджера, с фото страницы книги) → название, ингредиенты, шаги.
import type { CatalogItem } from "./types";
import { CATALOG, allCatalog, findCatalog } from "./catalog";
import { norm } from "./util";

export interface RecipeDraft {
  name: string;
  minutes?: number;
  servings?: number;
  kind?: string;
  ingredients: { name: string; amount: string }[];
  steps: string[];
}

const H_ING = /^(?:[#*\s]*)(ингредиент\S*|состав|продукты|вам понадобится|понадобится|нужно|потребуется|для (?:теста|начинки|соуса|крема|приготовления)[^:]*)\s*[:.]?\s*$/i;
const H_STEP = /^(?:[#*\s]*)(приготовление|способ приготовления|как готовить|порядок приготовления|рецепт приготовления|инструкция|шаги|действия|пошаговый рецепт|рецепт)\s*[:.]?\s*$/i;
const BULLET = /^\s*(?:[-–—•·*▪●◦✓✔☑□]|\d+[.)])\s*/;

const UNITS_RE = "(?:кг|килограмм\\S*|г|гр|грамм\\S*|мл|миллилитр\\S*|л|литр\\S*|шт|штук\\S*|уп|упак\\S*|пачк\\S*|банк\\S*|ст\\.?\\s*л\\.?|столов\\S*\\s+ложк\\S*|ч\\.?\\s*л\\.?|чайн\\S*\\s+ложк\\S*|стакан\\S*|ложк\\S*|зубчик\\S*|ломтик\\S*|пучок|пучк\\S*|щепотк\\S*|горсть|горсти|кусок|кусочк\\S*|долек|дольк\\S*|головк\\S*|веточк\\S*|стебл\\S*)";
const NUMBER = "(?:\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?|\\d+\\s*/\\s*\\d+|[½¼¾])";
const LEAD = new RegExp("^(" + NUMBER + ")\\s*(" + UNITS_RE + ")?\\.?\\s+(.+)$", "i");
const TRAIL = new RegExp("^(.+?)(?:\\s*[-–—:,(]\\s*|\\s+)(" + NUMBER + "\\s*" + UNITS_RE + "?|по вкусу|щепотка|немного|на кончике ножа|для .+)\\)?\\s*\\.?$", "i");
const TASTE = /(по вкусу|щепотк|немного|на кончике)/i;

const fixFrac = (s: string) => s.replace("½", "0,5").replace("¼", "0,25").replace("¾", "0,75").replace(/(\d+)\s*\/\s*(\d+)/, (_m, a, b) => String(Math.round((Number(a) / Number(b)) * 100) / 100).replace(".", ","));
const tidyUnit = (u: string) => u.replace(/\s+/g, " ").replace(/^ст\.?\s*л\.?$/i, "ст. л.").replace(/^ч\.?\s*л\.?$/i, "ч. л.").replace(/^столов\S*\s+ложк\S*$/i, "ст. л.").replace(/^чайн\S*\s+ложк\S*$/i, "ч. л.").replace(/^(килограмм\S*)$/i, "кг").replace(/^(грамм\S*|гр)$/i, "г").replace(/^миллилитр\S*$/i, "мл").replace(/^литр\S*$/i, "л").replace(/^штук\S*$/i, "шт").replace(/^упак\S*|^пачк\S*$/i, "уп");

/** Название продукта в именительном падеже, как в справочнике («муки» → Мука, «сметаны» → Сметана). */
export function canonIngredient(raw: string, custom: CatalogItem[] = []): { name: string; known: boolean } {
  const clean = raw.replace(/\([^)]*\)/g, " ").replace(/[.;:!]+$/g, "").replace(/\s+/g, " ").trim();
  const exact = findCatalog(clean, custom);
  if (exact) return { name: exact.n, known: true };
  const toks = norm(clean).split(/[\s,/-]+/).filter((t) => t.length >= 3);
  let best: CatalogItem | null = null, bestScore = 0;
  for (const it of allCatalog(custom)) {
    const ct = norm(it.n).split(/\s+/);
    let hit = 0;
    for (const t of toks) {
      const st = t.slice(0, Math.max(3, t.length - 2));
      if (ct.some((c) => c.startsWith(st))) hit++;
    }
    if (!hit) continue;
    const score = hit * 10 - (ct.length - hit) * 2 - (ct.length > 1 && hit < ct.length ? 1 : 0);
    if (score > bestScore) { best = it; bestScore = score; }
  }
  if (best) return { name: best.n, known: true };
  const s = clean.replace(/^[-–—•*\s]+/, "");
  return { name: s ? s[0].toUpperCase() + s.slice(1) : s, known: false };
}

/** Одна строка ингредиента → {name, amount} или null, если это не ингредиент. */
export function parseIngredientLine(line: string, custom: CatalogItem[] = []): { name: string; amount: string; known: boolean } | null {
  let l = line.replace(BULLET, "").replace(/\s+/g, " ").trim().replace(/[;,]$/g, "");
  if (!l || l.length > 90) return null;
  l = fixFrac(l);
  let m = l.match(LEAD);
  if (m) {
    const amount = [m[1].replace(/\s+/g, ""), m[2] ? tidyUnit(m[2]) : ""].filter(Boolean).join(" ");
    const c = canonIngredient(m[3], custom);
    // «2 яйца»: число без единицы — штуки
    return { name: c.name, amount: m[2] ? amount : amount + " шт", known: c.known };
  }
  m = l.match(TRAIL);
  if (m) {
    const am = m[2].trim();
    const a = fixFrac(am).replace(new RegExp("(" + NUMBER + ")\\s*(" + UNITS_RE + ")?", "i"), (_x, n, u) => [n.replace(/\s+/g, ""), u ? tidyUnit(u) : ""].filter(Boolean).join(" "));
    const c = canonIngredient(m[1], custom);
    return { name: c.name, amount: /^для /i.test(a) ? "" : TASTE.test(a) ? a.toLowerCase() : a, known: c.known };
  }
  if (TASTE.test(l)) {
    const c = canonIngredient(l.replace(TASTE, "").replace(/[-–—,]+\s*$/, "").trim(), custom);
    return c.name ? { name: c.name, amount: "по вкусу", known: c.known } : null;
  }
  // Одно слово-продукт без количества
  if (/^[А-Яа-яЁё\s-]{3,40}$/.test(l) && l.split(" ").length <= 3) {
    const c = canonIngredient(l, custom);
    if (c.known) return { name: c.name, amount: "", known: true };
  }
  return null;
}

const looksLikeStep = (l: string) => l.length > 45 || /[.!]\s*$/.test(l) && l.split(" ").length > 5;

function guessKind(name: string, tags = ""): string {
  const s = norm(name + " " + tags);
  if (/суп|борщ|щи\b|солянк|уха|бульон|харчо|рассольник/.test(s)) return "суп";
  if (/салат|винегрет|оливье/.test(s)) return "салат";
  if (/пирог|булочк|блин|оладь|печень|кекс|пицц|пирожк|хлеб|ватрушк|слойк|лепёшк|лепешк/.test(s)) return "выпечка";
  if (/торт|десерт|пудинг|мусс|желе|кисель|мороженое|сырники|запеканк\S* творож/.test(s)) return "десерт";
  if (/каша|омлет|яичниц|завтрак|гренк|сырник|мюсли/.test(s)) return "завтрак";
  if (/соус|подлив|заправк/.test(s)) return "соус";
  if (/компот|морс|лимонад|смузи|коктейл|чай|какао/.test(s)) return "напиток";
  if (/гарнир|пюре|рис\b|гречк|макарон|картофел/.test(s) && !/с (мясом|курицей|фаршем)/.test(s)) return "гарнир";
  if (/закуск|бутерброд|канапе|рулет|паштет/.test(s)) return "закуска";
  return "основное";
}

/** Главная функция: текст → черновик рецепта. */
export function parseRecipeText(text: string, custom: CatalogItem[] = []): RecipeDraft {
  const lines = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").split("\n").map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  let name = "";
  let minutes: number | undefined, servings: number | undefined;
  const ingredients: RecipeDraft["ingredients"] = [];
  const steps: string[] = [];

  // Название — первая строка, если это не заголовок раздела и не «ингредиент»
  const first = nonEmpty[0] || "";
  if (first && !H_ING.test(first) && !H_STEP.test(first) && first.length <= 90 && !LEAD.test(first)) name = first.replace(/^[#*\s"«]+|[#*\s"»:.]+$/g, "");

  const tm = text.match(/(?:время|готовить|приготовление|готовка|всего)[^\d\n]{0,25}(\d+(?:[.,]\d+)?)\s*(мин|час|ч\b)/i) || text.match(/\b(\d+(?:[.,]\d+)?)\s*(минут\S*|мин\b|час\S*)/i);
  if (tm) { const v = Number(tm[1].replace(",", ".")); minutes = Math.round(/^ч/i.test(tm[2]) ? v * 60 : v); if (minutes > 600 || minutes < 1) minutes = undefined; }
  const sm = text.match(/порци\S*\s*[:\-]\s*(\d+)/i) || text.match(/(\d+)\s*(?:порци\S*|персон\S*|человек\S*|чел\b)/i) || text.match(/(?:порци\S*|на)\s*[:\-]?\s*(\d+)\s*(?:порци|персон|человек|чел)/i);
  if (sm) { const v = Number(sm[1]); if (v >= 1 && v <= 24) servings = v; }

  let mode: "none" | "ing" | "step" = "none";
  const hasHeaders = nonEmpty.some((l) => H_ING.test(l) || H_STEP.test(l));
  let i0 = name ? lines.findIndex((l) => l) + 1 : 0;
  for (let i = i0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (H_ING.test(l)) { mode = "ing"; continue; }
    if (H_STEP.test(l)) { mode = "step"; continue; }
    if (/^(время|порци\S*|калорийность|кбжу|сложность|категория|кухня|выход)[^:\-]{0,30}[:\-]/i.test(l) || /^на\s+\d+\s*(порци|персон|человек|чел)\S*\s*\.?$/i.test(l)) continue;
    const stepText = l.replace(/^\s*(?:шаг\s*)?\d+\s*[.):]\s*/i, "").replace(/^[-–—•*]\s*/, "").trim();
    if (mode === "ing") {
      const ing = parseIngredientLine(l, custom);
      if (ing) { ingredients.push({ name: ing.name, amount: ing.amount }); continue; }
      // не получилось — возможно, уже шаги без заголовка
      if (looksLikeStep(l)) { mode = "step"; steps.push(stepText); }
      else if (l.length >= 3) ingredients.push({ name: canonIngredient(l, custom).name, amount: "" });
      continue;
    }
    if (mode === "step") { if (stepText.length >= 3) steps.push(stepText); continue; }
    // Заголовков нет — угадываем по виду строки
    const ing = parseIngredientLine(l, custom);
    if (ing && (ing.amount || ing.known) && !looksLikeStep(l)) ingredients.push({ name: ing.name, amount: ing.amount });
    else if (stepText.length >= 8) steps.push(stepText);
  }
  // Один сплошной абзац вместо шагов — режем по предложениям
  if (steps.length === 1 && steps[0].length > 160) {
    const parts = steps[0].split(/(?<=[.!?])\s+(?=[А-ЯA-Z])/).map((s) => s.trim()).filter((s) => s.length >= 8);
    if (parts.length > 1) { steps.length = 0; steps.push(...parts); }
  }
  void hasHeaders; void CATALOG;
  return { name, minutes, servings, kind: guessKind(name), ingredients, steps };
}
