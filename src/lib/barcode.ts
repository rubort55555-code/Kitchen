// Распознавание штрихкодов EAN-13, EAN-8 и UPC-A (это почти все продукты в магазинах).
// Работает в самом телефоне, без интернета и сторонних библиотек: берём кадр с камеры или фото,
// проходим по нескольким горизонтальным и вертикальным линиям, переводим яркость в чёрные и белые
// полосы и сверяем ширину полос с таблицей цифр. Контрольная цифра отсекает ошибки.

// Ширины полос цифр «L» (пробел-штрих-пробел-штрих), в модулях. «R» — те же ширины, «G» — в обратном порядке.
const L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
const G = L.map((w) => [...w].reverse());
// Первая цифра EAN-13 «спрятана» в чередовании L/G у левых шести цифр (0 — L, 1 — G).
const PARITY = ["000000", "001011", "001101", "001110", "010011", "011001", "011100", "010101", "010110", "011010"];

/** Правильная ли контрольная цифра (последняя). Подходит для EAN-8, EAN-13, UPC-A. */
export function checkDigitOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split("").map(Number);
  const last = d.pop()!;
  let s = 0;
  for (let i = d.length - 1, k = 3; i >= 0; i--, k = k === 3 ? 1 : 3) s += d[i] * k;
  return (10 - (s % 10)) % 10 === last;
}

/** Приводит код к виду для поиска: UPC-A (12 цифр) → EAN-13 с нулём впереди. */
export function normCode(raw: string): string | null {
  const c = raw.replace(/\D/g, "");
  if (c.length === 12 && checkDigitOk(c)) return "0" + c;
  return checkDigitOk(c) ? c : null;
}

/** Лучшая цифра для четырёх полос. Возвращает [цифра, набор (0=L/R, 1=G), ошибка]. */
function digit(runs: number[], at: number, allowG: boolean): [number, number, number] {
  const sum = runs[at] + runs[at + 1] + runs[at + 2] + runs[at + 3];
  const w = [runs[at] * 7 / sum, runs[at + 1] * 7 / sum, runs[at + 2] * 7 / sum, runs[at + 3] * 7 / sum];
  let best: [number, number, number] = [-1, 0, 99];
  for (let set = 0; set < (allowG ? 2 : 1); set++) {
    const T = set ? G : L;
    for (let n = 0; n < 10; n++) {
      const t = T[n];
      const e = Math.abs(w[0] - t[0]) + Math.abs(w[1] - t[1]) + Math.abs(w[2] - t[2]) + Math.abs(w[3] - t[3]);
      if (e < best[2]) best = [n, set, e];
    }
  }
  return best;
}

const MAX_DIGIT_ERR = 1.8;

/** Похожи ли полосы на охранный узор из n узких полос шириной m. */
function guard(runs: number[], at: number, n: number, m: number): boolean {
  for (let i = 0; i < n; i++) { const r = runs[at + i] / m; if (r < 0.45 || r > 1.9) return false; }
  return true;
}

/**
 * Пробует прочитать код из последовательности полос, начинающейся с чёрной полосы runs[i].
 * runs — длины полос по очереди (чёрная, белая, чёрная…), начиная с индекса i.
 */
function decodeAt(runs: number[], i: number): string | null {
  // EAN-13 / UPC-A: 3 + 24 + 5 + 24 + 3 = 59 полос, 95 модулей
  if (i + 59 <= runs.length) {
    let W = 0; for (let k = 0; k < 59; k++) W += runs[i + k];
    const m = W / 95;
    const quiet = i === 0 || runs[i - 1] >= 2.5 * m;
    if (quiet && guard(runs, i, 3, m) && guard(runs, i + 27, 5, m) && guard(runs, i + 56, 3, m)) {
      let digits = "", parity = "", ok = true;
      for (let k = 0; k < 6 && ok; k++) {
        const [n, set, e] = digit(runs, i + 3 + k * 4, true);
        if (e > MAX_DIGIT_ERR) ok = false; else { digits += n; parity += set; }
      }
      for (let k = 0; k < 6 && ok; k++) {
        const [n, , e] = digit(runs, i + 32 + k * 4, false);
        if (e > MAX_DIGIT_ERR) ok = false; else digits += n;
      }
      if (ok) {
        const first = PARITY.indexOf(parity);
        if (first >= 0) {
          const code = first + digits;
          if (checkDigitOk(code)) return code;
        }
      }
    }
  }
  // EAN-8: 3 + 16 + 5 + 16 + 3 = 43 полосы, 67 модулей
  if (i + 43 <= runs.length) {
    let W = 0; for (let k = 0; k < 43; k++) W += runs[i + k];
    const m = W / 67;
    const quiet = i === 0 || runs[i - 1] >= 2.5 * m;
    const after = i + 43 >= runs.length || runs[i + 43] >= 2.5 * m;
    if (quiet && after && guard(runs, i, 3, m) && guard(runs, i + 19, 5, m) && guard(runs, i + 40, 3, m)) {
      let code = "";
      for (let k = 0; k < 4; k++) {
        const [n, set, e] = digit(runs, i + 3 + k * 4, true);
        if (e > MAX_DIGIT_ERR || set) return null;
        code += n;
      }
      for (let k = 0; k < 4; k++) {
        const [n, , e] = digit(runs, i + 24 + k * 4, false);
        if (e > MAX_DIGIT_ERR) return null;
        code += n;
      }
      if (checkDigitOk(code)) return code;
    }
  }
  return null;
}

/** Ищет код в полосах, в обе стороны (штрихкод может лежать вверх ногами). */
function decodeRuns(runs: number[]): string | null {
  for (let pass = 0; pass < 2; pass++) {
    const r = pass ? [...runs].reverse() : runs;
    // r[0] — белая полоса, если линия начинается с белого; первая чёрная — r[1]
    for (let i = 1; i < r.length - 42; i += 2) {
      const c = decodeAt(r, i);
      if (c) return c;
    }
  }
  return null;
}

/**
 * Читает одну линию яркостей (0–255). Порог для чёрного/белого считается по соседним точкам,
 * поэтому тень и блики на упаковке мешают меньше.
 */
export function decodeLine(lum: ArrayLike<number>): string | null {
  const n = lum.length;
  if (n < 60) return null;
  // лёгкое сглаживание шума
  const s = new Float32Array(n);
  for (let x = 0; x < n; x++) s[x] = (lum[Math.max(0, x - 1)] + 2 * lum[x] + lum[Math.min(n - 1, x + 1)]) / 4;
  let gmin = 255, gmax = 0;
  for (let x = 0; x < n; x++) { if (s[x] < gmin) gmin = s[x]; if (s[x] > gmax) gmax = s[x]; }
  if (gmax - gmin < 40) return null;
  const win = Math.max(8, Math.round(n / 12));
  // 1-й способ: порог — середина между местным минимумом и максимумом (хорошо при тени и бликах);
  // в однотонных местах — общий порог.
  const th = new Float32Array(n);
  const global = (gmin + gmax) / 2;
  const lo = slide(s, win, true), hi = slide(s, win, false);
  for (let x = 0; x < n; x++) th[x] = hi[x] - lo[x] > (gmax - gmin) * 0.35 ? (lo[x] + hi[x]) / 2 : global;
  const r1 = decodeRuns(toRuns(s, th));
  if (r1) return r1;
  // 2-й способ: порог — средняя яркость рядом (лучше ловит узкие полосы на размытом коде).
  const w2 = Math.max(3, Math.round(win / 3));
  const pre = new Float64Array(n + 1);
  for (let x = 0; x < n; x++) pre[x + 1] = pre[x] + s[x];
  for (let x = 0; x < n; x++) {
    const a = Math.max(0, x - w2), b = Math.min(n, x + w2 + 1);
    const mean = (pre[b] - pre[a]) / (b - a);
    th[x] = hi[x] - lo[x] > (gmax - gmin) * 0.35 ? mean : global;
  }
  return decodeRuns(toRuns(s, th));
}

/** Минимум (или максимум) в окне ±r вокруг каждой точки — за один проход. */
function slide(s: Float32Array, r: number, min: boolean): Float32Array {
  const n = s.length, out = new Float32Array(n), q = new Int32Array(n);
  let h = 0, t = 0;
  const worse = (a: number, b: number) => (min ? a >= b : a <= b);
  for (let x = 0; x < n + r; x++) {
    if (x < n) { while (t > h && worse(s[q[t - 1]], s[x])) t--; q[t++] = x; }
    const c = x - r;
    if (c >= 0) { while (q[h] < c - r) h++; out[c] = s[q[h]]; }
  }
  return out;
}

/** Полосы по порогу; границы — с точностью до долей точки (где яркость пересекает порог). */
function toRuns(s: Float32Array, th: Float32Array): number[] {
  const n = s.length;
  const runs: number[] = [];
  let cur = 0, start = 0; // первая полоса всегда белая (если линия начинается с чёрного — белая длины 0)
  for (let x = 0; x < n; x++) {
    const b = s[x] < th[x] ? 1 : 0;
    if (b !== cur) {
      const a = x > 0 ? s[x - 1] - th[x - 1] : 0, c = s[x] - th[x];
      const edge = x > 0 && a !== c ? x - 1 + a / (a - c) : x;
      runs.push(Math.max(0.01, edge - start));
      start = edge; cur = b;
    }
  }
  runs.push(Math.max(0, n - start));
  if (runs.length % 2 === 0) runs.push(0); // заканчиваем белой
  return runs;
}

/** Яркость точек картинки (RGBA). */
export function toGray(data: Uint8ClampedArray | Uint8Array, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < w * h; i += 4, j++) g[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  return g;
}

/**
 * Ищет штрихкод на картинке: несколько горизонтальных линий в середине и вертикальных (если код повёрнут).
 * Код засчитывается, если его прочитали хотя бы на двух линиях (или на одной, если minVotes = 1).
 */
export function decodeGray(g: Uint8Array, w: number, h: number, minVotes = 2): string | null {
  const votes = new Map<string, number>();
  const add = (c: string | null) => { if (!c) return null; const v = (votes.get(c) || 0) + 1; votes.set(c, v); return v >= minVotes ? c : null; };
  const rows = 15;
  const line = new Uint8Array(Math.max(w, h));
  // горизонтальные линии — от центра к краям
  // Полосы штрихкода вертикальные, поэтому среднее по нескольким соседним строкам убирает шум
  // и не размывает сами полосы.
  const band = Math.max(1, Math.min(4, Math.round(h / 120)));
  for (let k = 0; k < rows; k++) {
    const off = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
    const y = Math.round(h / 2 + off * h / (rows + 2));
    if (y - band < 0 || y + band >= h) continue;
    for (let x = 0; x < w; x++) { let sum = 0; for (let d = -band; d <= band; d++) sum += g[(y + d) * w + x]; line[x] = sum / (2 * band + 1); }
    const r = add(decodeLine(line.subarray(0, w)));
    if (r) return r;
  }
  // вертикальные линии
  for (let k = 0; k < rows; k++) {
    const off = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
    const x = Math.round(w / 2 + off * w / (rows + 2));
    const bandX = Math.max(1, Math.min(4, Math.round(w / 120)));
    if (x - bandX < 0 || x + bandX >= w) continue;
    for (let y = 0; y < h; y++) { let sum = 0; for (let d = -bandX; d <= bandX; d++) sum += g[y * w + x + d]; line[y] = sum / (2 * bandX + 1); }
    const r = add(decodeLine(line.subarray(0, h)));
    if (r) return r;
  }
  if (minVotes > 1) {
    // единственное прочтение тоже годится, если других вариантов не было
    if (votes.size === 1) return [...votes.keys()][0];
  }
  return null;
}
