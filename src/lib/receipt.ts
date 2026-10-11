// Разбор текста чека: строки → продукты с количеством и ценой.
// Работает и с распознанным текстом (Tesseract), и с текстом, вставленным из «Живого текста» iPhone.
import type { CatalogItem, Unit } from "./types";
import { findCatalog } from "./catalog";
import { norm } from "./util";

export interface ReceiptItem {
  /** Строка из чека как есть (для запоминания сокращений). */
  raw: string;
  /** Название для склада (из справочника или очищенное из чека). */
  name: string;
  qty: number;
  unit: Unit;
  /** Цена за всё количество, ₽. */
  price: number;
  /** Нашли в справочнике. */
  known: boolean;
}

/** Строки, которые точно не товары. */
const SERVICE = /^(итого|итог|всего|к оплате|сумма|сдача|наличн|безнал|карт[аы]?\b|оплат|ндс|ндс|чек\b|кассов|ккт|инн|фн\b|фд\b|фп\b|фпд|снс|сно\b|кассир|смена|скидк|баллы|бонус|бонусн|приход|возврат|магазин|адрес|тел\b|www|http|спасибо|покупк[аи]|терминал|эквайринг|rrn|номер|№|дата|время|ост\.|мир\b|visa|mastercard|система налог|организац|ооо\b|зао\b|ао\b|ип\b|торговая|торг\.? точка|сайт|эл\.? адрес|электронн|получен|выдан|клиент)/i;

const NUM = "\\d+(?:[.,]\\d+)?";
const PRICE = "\\d+[.,]\\d{2}";
const toN = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/** Фразы-сокращения из чеков → название продукта. Проверяются по порядку. */
const PHRASES: [RegExp, string][] = [
  [/масл\S*\s*(сл|слив|крест)/, "Масло сливочное"],
  [/масл\S*\s*(под|подс|раст|рафин)/, "Масло подсолнечное"],
  [/масл\S*\s*(олив|extra|оливк)/, "Масло оливковое"],
  [/(кур|цып)\S*\s*(фил|груд)|филе\s*(кур|цып)|груд\S*\s*(кур|цып)/, "Куриное филе"],
  [/(кур|цып)\S*\s*бедр|бедр\S*\s*(кур|цып)|окороч/, "Куриные бёдра"],
  [/(кур|цып)\S*\s*голен|голен/, "Куриные голени"],
  [/(кур|цып)\S*\s*крыл|крыл\S*\s*(кур|цып)/, "Куриные крылья"],
  [/тушк\S*\s*(кур|цып)|\bкур(ица)?\b|\bцып/, "Курица целая"],
  [/фарш\S*\s*(кур|цып|индей)/, "Фарш куриный"],
  [/фарш/, "Фарш мясной"],
  [/индей/, "Индейка"],
  [/свин/, "Свинина"],
  [/говяд|телят/, "Говядина"],
  [/сыр\S*\s*(плав|дружб)|плавл\S*\s*сыр/, "Сыр плавленый"],
  [/сыр\S*\s*(творож|филад|сливоч|крем)|филадельфия/, "Сыр творожный"],
  [/моцарел/, "Моцарелла"],
  [/\bсыр\b|\bсыр\S*\s+(рос|гауд|голланд|пармез|чедд|маасд|твер)/, "Сыр твёрдый"],
  [/^(мол|молок)\S*\b|\bмол\.?\s*(прост|пастер|ультр|отбор)|\bмолок/, "Молоко"],
  [/сметан|\bсмет\b/, "Сметана"],
  [/творог|\bтв(ор)?[-.\s]?г\b|\bтворож(ок|н)/, "Творог"],
  [/кефир/, "Кефир"],
  [/ряжен/, "Ряженка"],
  [/йогурт|\bйог\b/, "Йогурт"],
  [/сливк/, "Сливки"],
  [/яйц|яиц|\bяй\b/, "Яйца"],
  [/колбас\S*\s*(вар|докт|молоч)|докторск/, "Колбаса варёная"],
  [/колбас\S*\s*(копч|салями|с\/к|сырок)|салям/, "Колбаса копчёная"],
  [/колбас/, "Колбаса варёная"],
  [/сосиск|сардел|сос\.?\s*(мол|вар)/, "Сосиски"],
  [/ветчин/, "Ветчина"],
  [/бекон/, "Бекон"],
  [/\bхлеб|\bбатон|\bбулк|буханк|багет/, "Хлеб"],
  [/лаваш/, "Лаваш"],
  [/картоф|картошк|\bкарт\b/, "Картофель"],
  [/помид|томат(?!\S*\s*(паст|в с))/, "Помидоры"],
  [/томат\S*\s*паст|паст\S*\s*томат/, "Томатная паста"],
  [/огурц|огур\b/, "Огурцы"],
  [/морков|морк\b/, "Морковь"],
  [/лук\s*(реп|репч)|\bлук\b(?!\s*зел)/, "Лук репчатый"],
  [/лук\S*\s*зел|зел\S*\s*лук/, "Зелёный лук"],
  [/капуст\S*\s*(пек|китай)/, "Капуста пекинская"],
  [/капуст/, "Капуста белокочанная"],
  [/перец\S*\s*(болг|сладк)|болгарск/, "Перец болгарский"],
  [/кабач/, "Кабачок"],
  [/баклаж/, "Баклажан"],
  [/свекл|свёкл/, "Свёкла"],
  [/бан(ан)?[аы]?\b|банан/, "Бананы"],
  [/яблок|\bябл\b/, "Яблоки"],
  [/апельс/, "Апельсины"],
  [/лимон\b|лимон(ы|ов)?\b/, "Лимон"],
  [/гречк|греча|греч\b|крупа\S*\s*греч/, "Гречка"],
  [/\bрис\b|рис\s*(круг|длин|басм|жасм)|крупа\S*\s*рис/, "Рис"],
  [/макарон|спагет|вермиш|лапш|паста\b(?!\s*томат)|перья|рожки|спираль/, "Макароны"],
  [/овсян|геркулес|хлопья\s*овс/, "Овсянка"],
  [/пшен/, "Пшено"],
  [/\bмука|мука\s*(пш|в\/с)/, "Мука"],
  [/сахар/, "Сахар"],
  [/майонез|майон\b/, "Майонез"],
  [/кетчуп/, "Кетчуп"],
  [/минтай/, "Минтай"],
  [/камбал/, "Камбала"],
  [/лосос|сёмг|семг|форел|горбуш/, "Лосось"],
  [/скумбр/, "Скумбрия"],
  [/сельд/, "Сельдь"],
  [/креветк/, "Креветки"],
  [/крабов\S*\s*палоч|палочки\s*краб/, "Крабовые палочки"],
  [/пельмен/, "Пельмени"],
  [/шампин/, "Шампиньоны"],
  [/чай\b/, "Чай"],
  [/кофе/, "Кофе"],
  [/(?:^|\s)сок\b/, "Сок"],
  [/укроп/, "Укроп"],
  [/петруш/, "Петрушка"],
];

/** Размер упаковки из названия: «930 МЛ», «400Г», «0,850КГ», «1,5Л», «10ШТ». */
function packSize(text: string): { size: number; unit: Unit } | null {
  const m = text.toLowerCase().match(new RegExp("(" + NUM + ")\\s*(кг|гр?|мл|л|шт)(?![а-я])"));
  if (!m) return null;
  return { size: toN(m[1]), unit: m[2] === "гр" ? "г" : (m[2] as Unit) };
}

const dim = (u: Unit) => (u === "г" || u === "кг" ? "w" : u === "мл" || u === "л" ? "v" : "c");
const toBase = (q: number, u: Unit) => (u === "кг" || u === "л" ? q * 1000 : q);
const fromBase = (q: number, u: Unit) => (u === "кг" || u === "л" ? q / 1000 : q);
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Убирает из названия всё лишнее: размеры, проценты, служебные пометки. */
export function cleanName(raw: string): string {
  let s = raw
    .replace(new RegExp("(" + NUM + ")\\s*(кг|гр?|мл|л|шт)(?![а-я])", "gi"), " ")
    .replace(new RegExp(NUM + "\\s*%", "g"), " ")
    .replace(/\b(охл|зам|охлажд|замор|в\/у|в\/с|уп|упак|пакет|пэт|ж\/б|т\/п|с[01]|с-[01]|к[гg])\b\.?/gi, " ")
    .replace(/[0-9№#*=:;|_]+/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!s) s = raw.trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

/** Ключ для запоминания сокращений: название без цифр и размеров. */
export const receiptKey = (raw: string) => norm(cleanName(raw));

/** Подбор названия продукта: запомненное → фразы-сокращения → справочник → очищенное название. */
export function matchName(raw: string, learned: Record<string, string>, custom: CatalogItem[]): { name: string; known: boolean } {
  const key = receiptKey(raw);
  if (learned[key]) return { name: learned[key], known: true };
  const q = norm(raw).replace(/[0-9]+[.,]?[0-9]*\s*%/g, " ");
  for (const [re, name] of PHRASES) if (re.test(q)) return { name, known: true };
  const c = findCatalog(cleanName(raw), custom);
  if (c) return { name: c.n, known: true };
  return { name: cleanName(raw), known: false };
}

/** Распознавание часто пишет «389, 99» или «©» вместо 0 — приводим к обычному виду. */
function normalizeLines(text: string): string[] {
  return text.split(/\r?\n/)
    .map((l) => l.replace(/[\u00a0\t]+/g, " ").replace(/[©®]/g, "0").replace(/(\d)\s*[,.]\s+(\d)/g, "$1,$2").replace(/[×✕]/g, "x").trim())
    .filter(Boolean);
}

/** Сумма «ИТОГО» из чека — чтобы сверить с тем, что разобрали. */
export function findTotal(text: string): number | null {
  for (const l of normalizeLines(text)) {
    const m = l.match(/^(?:итого|к оплате|всего)\D{0,15}?(\d+(?:\s\d{3})*[.,]\d{2})/i);
    if (m) return Number(m[1].replace(/\s/g, "").replace(",", "."));
  }
  return null;
}

interface Raw { raw: string; packs: number; price: number; unitPrice?: number }

/** Строки чека → «сырые» товары (название, число упаковок, цена за всё). */
function scan(text: string): Raw[] {
  const lines = normalizeLines(text);
  const out: Raw[] = [];
  let pending = ""; // название, цена в следующей строке
  const qtyLine = new RegExp("^(?:(.*?)\\s)?(" + NUM + ")\\s*[xх×*]\\s*(" + PRICE + "|\\d+)\\s*(?:[=]?\\s*(" + PRICE + "))?\\s*(?:₽|р\\.?|руб)?\\s*[А-ЯA-Z]{0,2}$", "i");
  const endPrice = new RegExp("^(.*?[а-яёa-z].*?)\\s+(" + PRICE + ")\\s*(?:₽|р\\.?|руб)?\\s*[А-ЯA-Z]{0,2}$", "i");
  for (let line of lines) {
    line = line.replace(/^\d{1,3}(?:[.)]\s*|\s+)(?=[А-Яа-яA-Za-z]{2})/, ""); // «1. МОЛОКО», «2 Сахар»
    if (SERVICE.test(line)) { pending = ""; continue; }
    const q = line.match(qtyLine);
    if (q) {
      const name = (q[1] || pending).trim();
      pending = "";
      if (!name || !/[а-яёa-z]{2}/i.test(name) || SERVICE.test(name)) continue;
      const packs = toN(q[2]);
      const unitPrice = toN(q[3]);
      const total = q[4] ? toN(q[4]) : Math.round(packs * unitPrice * 100) / 100;
      out.push({ raw: name, packs, price: total, unitPrice });
      continue;
    }
    const e = line.match(endPrice);
    if (e && !/^\d/.test(e[1].trim()) || (e && /[а-яёa-z]{3}/i.test(e[1]))) {
      const name = e![1].trim();
      if (!SERVICE.test(name) && /[а-яёa-z]{2}/i.test(name)) { out.push({ raw: name, packs: 1, price: toN(e![2]) }); pending = ""; continue; }
    }
    // Строка только с названием — цена придёт на следующей
    if (/[а-яёa-z]{3}/i.test(line) && !/\d+[.,]\d{2}/.test(line) && line.length < 60) pending = line; else pending = "";
  }
  return out;
}

/** Главная функция: текст чека → список товаров. */
export function parseReceipt(text: string, learned: Record<string, string> = {}, custom: CatalogItem[] = []): ReceiptItem[] {
  return scan(text).map((r) => {
    const m = matchName(r.raw, learned, custom);
    const c = m.known ? findCatalog(m.name, custom) : null;
    const size = packSize(r.raw);
    const wholePacks = Math.abs(r.packs - Math.round(r.packs)) < 1e-9;
    const weighed = !wholePacks || /(^|\s)(кг|вес)(\s|$)/i.test(r.raw);
    let qty = r.packs, unit: Unit = c?.u && (c.u === "шт" || c.u === "уп") ? c.u : "шт";

    if (size && !weighed) {
      if (dim(size.unit) === "c") { // «10ШТ»
        qty = r.packs * size.size; unit = "шт";
      } else if (!c || dim(c.u) === dim(size.unit)) {
        const target: Unit = c ? c.u : size.unit;
        qty = fromBase(toBase(size.size, size.unit) * r.packs, target); unit = target;
      } else {
        qty = r.packs; unit = c.u === "уп" ? "уп" : "шт";
      }
    } else if (weighed) {
      const target: Unit = c && dim(c.u) === "w" ? c.u : "кг";
      qty = fromBase(toBase(r.packs, "кг"), target); unit = target;
    } else if (c && dim(c.u) !== "c") {
      // Штучный товар, который на складе считаем в г/мл/кг, а размер не указан — ставим 1 шт
      qty = r.packs; unit = "шт";
    }
    return { raw: r.raw, name: m.name, qty: round(qty), unit, price: r.price, known: m.known };
  });
}
