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
const SERVICE = /^(итого|итог|всего|к оплате|сумма|сдача|наличн|безнал|карт[аы]?\b|оплат|ндс|ндс|чек\b|кассов|ккт|инн|фн\b|фд\b|фп\b|фпд|снс|сно\b|кассир|смена|скидк|баллы|бонус|бонусн|приход|возврат|магазин|адрес|тел\b|www|http|спасибо|покупк[аи]|терминал|эквайринг|rrn|номер|№|дата|время|ост\.|мир\b|visa|mastercard|система налог|организац|ооо\b|зао\b|ао\b|ип\b|торговая|торг\.? точка|сайт|эл\.? адрес|электронн|получен|выдан|клиент|картой|наличными|безналичн|электронн|сдача|к оплате|подытог|без скидки|округлен)/i;

const NUM = "\\d+(?:[.,]\\d+)?";
const toN = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/** Фразы-сокращения из чеков → название продукта. Проверяются по порядку. */
const PHRASES: [RegExp, string][] = [
  // Яйца — первыми: «ЯЙЦО КУРИНОЕ С1» не должно стать курицей
  [/яйц|яиц|\bяй\b/, "Яйца"],
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

// В JavaScript «\b» видит границы слов только у латиницы — для русских слов делаем свою границу
const BOUND = "(?:^|$|[^а-яёa-z0-9])";
const PHRASE_RES: [RegExp, string][] = PHRASES.map(([re, name]) => [new RegExp(re.source.replace(/\\b/g, BOUND), re.flags), name]);

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
  for (const [re, name] of PHRASE_RES) if (re.test(q)) return { name, known: true };
  const c = findCatalog(cleanName(raw), custom);
  if (c) return { name: c.n, known: true };
  return { name: cleanName(raw), known: false };
}

// Латинские буквы, похожие на русские: распознавание путает «СМЕТАНА» и «CMETAHA», «НДС» и «HДC»
const LAT: Record<string, string> = { A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У", a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у" };
/** Слово из похожих латинских букв (или вперемешку с русскими) → по-русски. Настоящие латинские слова не трогаем. */
function cyr(word: string): string {
  if (!/[a-z]/i.test(word)) return word;
  const letters = word.replace(/[^a-zа-яё]/gi, "");
  const hasCyr = /[а-яё]/i.test(letters);
  const allLike = [...letters].every((ch) => LAT[ch] || /[а-яё]/i.test(ch));
  return hasCyr || (allLike && letters.length >= 2) ? [...word].map((ch) => LAT[ch] || ch).join("") : word;
}
/** Число, где распознавание спутало цифры с буквами: «3О.2]» → «30.21», «9б» → «96». */
function digits(tok: string): string {
  if (!/\d/.test(tok) || !/^[=\-+]?[\dOoОоЗзбlI|\][.,]+$/.test(tok)) return tok;
  return tok.replace(/[OoОо]/g, "0").replace(/[Зз]/g, "3").replace(/б/g, "6").replace(/[lI|\]]/g, "1");
}

/** Распознавание часто пишет «389, 99», «©» вместо 0, латиницу вместо кириллицы — приводим к обычному виду. */
function normalizeLines(text: string): string[] {
  return text.split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").replace(/[©®]/g, "0").replace(/(\d)\s*[,.]\s+(\d)/g, "$1,$2").replace(/[×✕]/g, "x").replace(/[“”«»"']/g, "").trim())
    .map((l) => l.split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? w : cyr(digits(w)))).join(""))
    // «1 х 89.99», «1Х 79.99», «2 штх 109,90»: русская «х» между числами — знак умножения
    .map((l) => l.replace(/(\d)\s*(шт|кг|г|л)?\.?\s*[хХxX*]{1,2}\s*(?=\d)/gi, (_m, d, u) => `${d}${u ? " " + u.toLowerCase() : ""} x `))
    .filter(Boolean);
}

/** Сумма «ИТОГ(О)» из чека — чтобы сверить с тем, что разобрали. */
export function findTotal(text: string): number | null {
  for (const l of normalizeLines(text)) {
    const m = l.match(/^(?:итого?|к оплате|всего)\D{0,40}?(\d+(?:\s\d{3})*[.,]\d{2})/i);
    if (m) return Number(m[1].replace(/\s/g, "").replace(",", "."));
  }
  return null;
}

interface Raw {
  raw: string; packs: number; price: number; unitPrice?: number;
  /** Другие версии, когда «количество × цена» не сходится с суммой: одно из чисел распознано с ошибкой. */
  alts?: { packs: number; price: number }[];
}

// Совпадает до копейки (вес × цена округляется до копеек)
const near = (a: number, b: number) => Math.abs(a - b) <= 0.011;
/** Количество из суммы: 1.0008 → 1 (целые упаковки), вес — до граммов. */
const packsOf = (total: number, unit: number) => { const q = total / unit; return Math.abs(q - Math.round(q)) < 0.01 ? Math.round(q) : Math.round(q * 1000) / 1000; };
const decimals = (s: string) => (s.match(/[.,](\d+)$/)?.[1].length ?? 0);

/**
 * «A x B = C»: что из A и B цена, а что количество. В чеках бывает и «1 x 89,99», и «89.99 x 1.235» (Пятёрочка).
 * Если есть сумма C — верим ей: количество = сумма / цена (так исправляются цифры, которые распознавание спутало).
 */
function qtyPrice(a: string, b: string, c?: string): { packs: number; unit: number; total: number; alts?: { packs: number; price: number }[] } {
  const A = toN(a), B = toN(b), C = c ? toN(c) : undefined;
  // Количество: целое или с тремя знаками (вес); цена — с двумя знаками
  const aQty = decimals(a) !== 2 && (decimals(a) === 3 || A < 100);
  const bQty = decimals(b) !== 2 && (decimals(b) === 3 || B < 100);
  let packs = aQty && !bQty ? A : bQty && !aQty ? B : Math.min(A, B);
  let unit = packs === A && (aQty || !bQty) ? B : A;
  if (C !== undefined) {
    if (near(A * B, C) || !(unit > 0)) return { packs, unit, total: C };
    // Целое число штук распознаётся надёжно: ошиблись в цене за штуку или в сумме. Верим сумме,
    // а «количество × цена» оставляем второй версией — её проверит сверка с итогом
    const qtyTok = packs === A ? a : b;
    if (decimals(qtyTok) === 0 && packs >= 1) return { packs, unit: C / packs, total: C, alts: [{ packs, price: Math.round(packs * unit * 100) / 100 }] };
    const alts = versions(packs, unit);
    packs = packsOf(C, unit);
    return { packs, unit, total: C, alts };
  }
  return { packs, unit, total: Math.round(packs * unit * 100) / 100 };
}

/** Версии «количество × цена» для сверки с итогом; вес «9.512» мог быть «0.512» (распознавание путает 0 и 9). */
function versions(packs: number, unit: number): { packs: number; price: number }[] {
  const qs = [packs];
  if (packs >= 9 && packs < 10 && Math.round(packs * 1000) % 1000 !== 0) qs.push(Math.round((packs - 9) * 1000) / 1000);
  return qs.map((q) => ({ packs: q, price: Math.round(q * unit * 100) / 100 }));
}

/** Строки НДС, скидок и подитогов — не товары: «НДС 10% =8.18», «НДС 20%». */
const VAT = /^(ндс|нд[сc]|н[оo0][сc]|н\S{1,2})\s*\d{1,2}\s*%|^\S{2,4}\s+(0|10|18|20)\s*%\s*=?\s*\d/i;

/** Строки чека → «сырые» товары (название, число упаковок, цена за всё). */
function scan(text: string): Raw[] {
  const lines = normalizeLines(text);
  const out: Raw[] = [];
  let pending: string[] = []; // название; цена придёт в следующей строке
  // товар без суммы — сумма может прийти отдельной строкой «=79.99»
  const st: { open: Raw | null; numbered: boolean } = { open: null, numbered: false };
  const N = "(\\d+(?:[.,]\\d+)?)";
  const P = "(\\d+[.,]\\d{2})";
  const qtyLine = new RegExp("^(?:(.*?)\\s)?" + N + "\\s*(?:шт|кг|г)?\\s*x\\s*" + N + "\\s*(?:шт|кг|г)?\\s*(?:=\\s*" + P + "|\\s" + P + ")?\\s*(?:₽|р\\.?|руб)?\\s*[А-ЯA-Z]{0,2}$", "i");
  const colsLine = new RegExp("кол-?\\s?во\\s*" + N + "\\s*(?:шт|кг|г|л)?\\.?\\s*цена\\s*" + N + "\\s*(?:сумма|стоим\\S*)\\s*" + P, "i");
  const sumOnly = new RegExp("^=?\\s*" + P + "\\s*(?:₽|р\\.?|руб)?$", "i");
  const endPrice = new RegExp("^(.*?[а-яёa-z].*?)\\s+=?\\s*" + P + "\\s*(?:₽|р\\.?|руб)?\\s*[А-ЯA-Z]{0,2}$", "i");
  const take = () => { const n = pending.join(" "); pending = []; return n; };
  const push = (r: Raw, hasTotal: boolean) => { out.push(r); st.open = hasTotal ? null : r; };
  for (let line of lines) {
    const numbered = /^\d{1,3}[.)]\s*(?=[А-Яа-яA-Za-z]{2})/.test(line);
    // «1. МОЛОКО», «2 Сахар» — номер позиции; но «2 шт x 109,90» — количество, его не трогаем
    line = line.replace(/^\d{1,3}(?:[.)]\s*|\s+)(?=[А-Яа-яA-Za-z]{2})(?!(?:шт|кг|г|л)(?![а-яё]))/i, "")
      .replace(/^\d{4,13}\s+(?=[А-Яа-яA-Za-z]{2})/, ""); // код товара: «3604 Яйцо»
    if (VAT.test(line) || SERVICE.test(line)) { pending = []; st.open = null; continue; }
    // Сумма отдельной строкой (Магнит): «=79.99»
    const so = line.match(sumOnly);
    if (so) {
      const o = st.open;
      if (o) {
        const total = toN(so[1]);
        if (o.unitPrice && !near(o.packs * o.unitPrice, total)) {
          o.alts = versions(o.packs, o.unitPrice);
          o.packs = packsOf(total, o.unitPrice);
        }
        o.price = total; st.open = null;
      }
      continue;
    }
    const cl = line.match(colsLine);
    if (cl) {
      const name = (line.slice(0, cl.index).trim() || take()).trim();
      pending = [];
      if (name && /[а-яёa-z]{2}/i.test(name) && !SERVICE.test(name)) {
        const r = qtyPrice(cl[1], cl[2], cl[3]);
        push({ raw: name, packs: r.packs, price: r.total, unitPrice: r.unit, alts: r.alts }, true);
      }
      continue;
    }
    const q = line.match(qtyLine);
    if (q) {
      // До количества — название, если там есть слово, а не только «шт»/«кг»
      const lead = (q[1] || "").replace(/(^|\s)(шт|кг|г|л)\.?(?=\s|$)/gi, " ").trim();
      const name = (/[а-яёa-z]{3}/i.test(lead) ? q[1] : take()).trim();
      pending = [];
      if (!name || !/[а-яёa-z]{2}/i.test(name) || SERVICE.test(name)) continue;
      const sum = q[4] || q[5];
      const r = qtyPrice(q[2], q[3], sum);
      push({ raw: name, packs: r.packs, price: r.total, unitPrice: r.unit, alts: r.alts }, !!sum);
      continue;
    }
    const e = line.match(endPrice);
    if (e && (!/^\d/.test(e[1].trim()) || /[а-яёa-z]{3}/i.test(e[1]))) {
      const name = e[1].trim();
      if (!SERVICE.test(name) && /[а-яёa-z]{2}/i.test(name)) { push({ raw: name, packs: 1, price: toN(e[2]) }, true); pending = []; continue; }
    }
    // Строка только с названием — цена придёт на следующей. Длинное название с номером может переноситься на 2 строки.
    st.open = null;
    if (/[а-яёa-z]{3}/i.test(line) && !/\d+[.,]\d{2}/.test(line) && line.length < 60) {
      // перенос: продолжение названия с номером («1. МОЛОКО ПРОСТОКВ.» + «ПАСТ. 3,2% 930МЛ»)
      if (!numbered && st.numbered && pending.length === 1) pending.push(line);
      else { pending = [line]; st.numbered = numbered; }
    } else pending = [];
  }
  return reconcile(out, findTotal(text));
}

/**
 * Сверка с «ИТОГО»: если сумма товаров не сходится с итогом, пробуем другие версии цен (у одного товара, потом у двух)
 * и берём ту, при которой итог сходится. Так исправляются цифры, которые распознавание спутало (0 и 9, 1 и 7).
 */
function reconcile(items: Raw[], total: number | null): Raw[] {
  if (total === null || !items.length) return items;
  const sum = (list: Raw[]) => Math.round(list.reduce((s, r) => s + r.price, 0) * 100) / 100;
  const ok = (v: number) => Math.abs(v - total) < 0.015;
  if (ok(sum(items))) return items;
  // Варианты: (номер товара, версия цены)
  const cand: [number, { packs: number; price: number }][] = [];
  items.forEach((r, i) => (r.alts || []).forEach((a) => cand.push([i, a])));
  const use = (ch: [number, { packs: number; price: number }][]) => items.map((r, i) => { const c = ch.find(([j]) => j === i); return c ? { ...r, packs: c[1].packs, price: c[1].price } : r; });
  for (const c of cand) { const v = use([c]); if (ok(sum(v))) return v; }
  for (let a = 0; a < cand.length; a++) for (let b = a + 1; b < cand.length; b++) {
    if (cand[a][0] === cand[b][0]) continue;
    const v = use([cand[a], cand[b]]); if (ok(sum(v))) return v;
  }
  return items;
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
