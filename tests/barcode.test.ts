// Проверка распознавания штрихкодов на нарисованных кодах: разный масштаб, размытие, шум, тень, поворот.
// Запуск: node node_modules/.bin/tsx tests/barcode.test.ts
import { checkDigitOk, decodeGray, decodeLine, normCode } from "../src/lib/barcode";
import { parseQuantity, fromOff, nameFor } from "../src/lib/off";

let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = L.map((s) => s.split("").map((b) => (b === "1" ? "0" : "1")).join(""));
const PAR = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Модули штрихкода (1 — чёрный) с тихой зоной по 11 модулей. */
function modules(code: string): number[] {
  let s = "";
  if (code.length === 13) {
    const p = PAR[+code[0]];
    s = "101";
    for (let i = 1; i <= 6; i++) s += (p[i - 1] === "L" ? L : G)[+code[i]];
    s += "01010";
    for (let i = 7; i <= 12; i++) s += R[+code[i]];
    s += "101";
  } else {
    s = "101";
    for (let i = 0; i < 4; i++) s += L[+code[i]];
    s += "01010";
    for (let i = 4; i < 8; i++) s += R[+code[i]];
    s += "101";
  }
  const q = "0".repeat(11);
  return (q + s + q).split("").map(Number);
}

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

/** Линия яркостей: модуль шириной mw пикселей, со сдвигом, размытием, шумом и тенью. */
function render(code: string, mw: number, o: { blur?: number; noise?: number; shade?: number; pad?: number; low?: number } = {}): number[] {
  const m = modules(code);
  const pad = o.pad ?? 20;
  const n = Math.ceil(m.length * mw + pad * 2);
  const raw: number[] = [];
  for (let x = 0; x < n; x++) {
    // покрытие пикселя чёрным (сглаживание на границах)
    let cov = 0;
    for (let k = 0; k < 4; k++) { const mi = Math.floor((x + k / 4 + 0.13 - pad) / mw); cov += mi >= 0 && mi < m.length ? m[mi] : 0; }
    const dark = o.low ?? 30, light = 225;
    raw.push(light - (light - dark) * (cov / 4));
  }
  let line = raw;
  for (let b = 0; b < (o.blur || 0); b++) line = line.map((_, i) => (line[Math.max(0, i - 1)] + line[i] + line[Math.min(n - 1, i + 1)]) / 3);
  return line.map((v, i) => Math.max(0, Math.min(255, v - (o.shade || 0) * (i / n) + ((o.noise || 0) * (rnd() * 2 - 1)))));
}

/** Добавляет правильную контрольную цифру. */
const withCheck = (b: string) => { let s = 0; for (let i = b.length - 1, k = 3; i >= 0; i--, k = k === 3 ? 1 : 3) s += +b[i] * k; return b + ((10 - (s % 10)) % 10); };
const CODES = ["460700177153", "460060502752", "544900000099", "469022800779", "001234567890", "481026802931", "301762401070", "400000000000", "999999999999"].map(withCheck);

ok("контрольная цифра верна", CODES.every(checkDigitOk));
ok("контрольная цифра неверна", !checkDigitOk("4607001771532"));
ok("EAN-8 контрольная", checkDigitOk("96385074"));
ok("UPC-A → EAN-13", normCode("012345678905") === "0012345678905");
ok("мусор не код", normCode("12345") === null);

for (const c of CODES) {
  ok(`чисто ${c}`, decodeLine(render(c, 3)) === c, decodeLine(render(c, 3)));
  ok(`мелко 2px ${c}`, decodeLine(render(c, 2)) === c, decodeLine(render(c, 2)));
  ok(`крупно 6.3px ${c}`, decodeLine(render(c, 6.3)) === c);
  ok(`размыто ${c}`, decodeLine(render(c, 3.4, { blur: 2 })) === c, decodeLine(render(c, 3.4, { blur: 2 })));
  ok(`шум и тень ${c}`, decodeLine(render(c, 2.6, { noise: 25, shade: 90 })) === c, decodeLine(render(c, 2.6, { noise: 25, shade: 90 })));
  ok(`слабый контраст ${c}`, decodeLine(render(c, 3.1, { low: 150, noise: 8 })) === c);
  ok(`вверх ногами ${c}`, decodeLine(render(c, 2.9).reverse()) === c);
}
ok("EAN-8", decodeLine(render("96385074", 3)) === "96385074", decodeLine(render("96385074", 3)));
ok("EAN-8 размыт", decodeLine(render(withCheck("4600999"), 2.7, { blur: 1, noise: 10 })) === withCheck("4600999"));

// много случайных кодов в разных условиях
{
  let good = 0, wrong = 0;
  for (let t = 0; t < 400; t++) {
    const base = Array.from({ length: 12 }, () => Math.floor(rnd() * 10)).join("");
    const c = withCheck(base);
    const mw = 2.4 + rnd() * 5, o = { blur: Math.floor(rnd() * 3), noise: rnd() * 12, shade: rnd() * 80 };
    const line = render(c, mw, o);
    const r = decodeLine(line);
    if (r === c) good++; else if (r) wrong++;
  }
  ok("случайные коды: читается ≥ 95%", good >= 380, good);
  ok("случайные коды: ни одного неверного", wrong === 0, wrong);
}

// ложные срабатывания: случайные полосы и текст не должны давать код
let fp = 0;
for (let t = 0; t < 2000; t++) {
  const line: number[] = [];
  let x = 0; const n = 400;
  while (x < n) { const w = 1 + Math.floor(rnd() * 8); const v = rnd() > 0.5 ? 40 : 220; for (let k = 0; k < w && x < n; k++, x++) line.push(v); }
  if (decodeLine(line)) fp++;
}
ok("случайные полосы почти никогда не читаются", fp <= 1, fp);

// обрезанный код — не читается
ok("обрезанный код не читается", decodeLine(render(CODES[0], 3).slice(0, 200)) === null);

// картинка целиком: код в середине, повёрнут на 90°
function image(code: string, vertical: boolean): { g: Uint8Array; w: number; h: number } {
  const line = render(code, 2.4, { noise: 12 });
  const len = line.length, th = 120;
  const w = vertical ? th + 100 : len + 40, h = vertical ? len + 40 : th + 100;
  const g = new Uint8Array(w * h).fill(200);
  for (let a = 0; a < len; a++) for (let b = 0; b < th; b++) {
    const x = vertical ? 50 + b : 20 + a, y = vertical ? 20 + a : 50 + b;
    g[y * w + x] = line[a];
  }
  return { g, w, h };
}
{ const im = image(CODES[1], false); ok("картинка: горизонтальный код", decodeGray(im.g, im.w, im.h) === CODES[1]); }
{ const im = image(CODES[2], true); ok("картинка: вертикальный код", decodeGray(im.g, im.w, im.h) === CODES[2]); }
{ const g = new Uint8Array(300 * 200); for (let i = 0; i < g.length; i++) g[i] = Math.floor(rnd() * 255); ok("картинка-шум: нет кода", decodeGray(g, 300, 200) === null); }

// ---- Open Food Facts: разбор ответа ----
ok("количество 930 мл", JSON.stringify(parseQuantity("930 мл")) === JSON.stringify({ qty: 930, unit: "мл" }));
ok("количество 0,9 л", JSON.stringify(parseQuantity("0,9 л")) === JSON.stringify({ qty: 0.9, unit: "л" }));
ok("количество 1 kg", JSON.stringify(parseQuantity("1 kg")) === JSON.stringify({ qty: 1, unit: "кг" }));
ok("количество 200g", JSON.stringify(parseQuantity("200g")) === JSON.stringify({ qty: 200, unit: "г" }));
ok("количество 10 шт", JSON.stringify(parseQuantity("10 шт.")) === JSON.stringify({ qty: 10, unit: "шт" }));
ok("количество 6 x 330 ml", JSON.stringify(parseQuantity("6 x 330 ml")) === JSON.stringify({ qty: 1980, unit: "мл" }));
ok("количество 1.5 L", JSON.stringify(parseQuantity("1.5 L")) === JSON.stringify({ qty: 1.5, unit: "л" }));
ok("количество пусто", parseQuantity("") === null && parseQuantity("большая") === null);

const off = fromOff("4607001771531", {
  status: 1, product: {
    product_name: "Moloko", product_name_ru: "Молоко пастеризованное 3,2%", brands: "Простоквашино, Danone", quantity: "930 мл",
    nutriments: { "energy-kcal_100g": 58, proteins_100g: 3, fat_100g: 3.2, carbohydrates_100g: 4.7, fiber_100g: 0, sugars_100g: 4.7, salt_100g: 0.1 },
  },
});
ok("OFF: название по-русски", off?.title === "Молоко пастеризованное 3,2%", off);
ok("OFF: марка — первая", off?.brand === "Простоквашино");
ok("OFF: количество", off?.qty === 930 && off?.unit === "мл");
ok("OFF: КБЖУ", off?.per100?.kcal === 58 && off?.per100?.p === 3 && off?.per100?.f === 3.2 && off?.per100?.c === 4.7);
ok("OFF: не найден", fromOff("1", { status: 0, status_verbose: "product not found" }) === null);
const kj = fromOff("2", { status: 1, product: { product_name: "Хлеб", nutriments: { "energy_100g": 1046 } } });
ok("OFF: ккал из кДж", kj?.per100?.kcal === 250, kj);

const nf = (title: string, brand?: string) => nameFor({ code: "1", title, brand }).name;
ok("имя: молоко", nf("Молоко пастеризованное 3,2%", "Простоквашино") === "Молоко");
ok("имя: сметана, не простокваша", nf("Сметана Простоквашино 20%", "Простоквашино") === "Сметана", nf("Сметана Простоквашино 20%", "Простоквашино"));
ok("имя: чипсы не сметана", nf("Чипсы Lay's сметана и лук", "Lay's") !== "Сметана", nf("Чипсы Lay's сметана и лук", "Lay's"));
ok("имя: макароны → паста/макароны", /паст|макарон/i.test(nf("Макаронные изделия спагетти", "Barilla")), nf("Макаронные изделия спагетти", "Barilla"));
ok("имя: кефир", nf("Кефир 1%") === "Кефир");
ok("имя: незнакомое — с упаковки", nf("Напиток газированный Coca-Cola", "Coca-Cola") === "Напиток газированный", nf("Напиток газированный Coca-Cola", "Coca-Cola"));
ok("имя: только марка", nf("Coca-Cola Zero", "Coca-Cola") === "Coca-Cola Zero", nf("Coca-Cola Zero", "Coca-Cola"));

console.log(`barcode: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
