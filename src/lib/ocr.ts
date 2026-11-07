// Распознавание текста на фото чека — прямо на телефоне, без интернета (Tesseract.js, русский).
// Файл языка (≈4 МБ) и ядро (≈4 МБ) лежат рядом с приложением и скачиваются один раз при первом распознавании.

const base = () => new URL("ocr/", document.baseURI).href;

export interface PrepOpts {
  /** Обрезать по краю чека (убрать стол и фон). */
  crop?: boolean;
  /** Выровнять наклон строк. */
  deskew?: boolean;
  /** Ширина вырезанного чека после увеличения, точек. */
  width?: number;
}

/** Серое изображение: яркость 0–255 на пиксель. */
function grayOf(ctx: CanvasRenderingContext2D, W: number, H: number): Uint8Array {
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return g;
}

/** Порог Оцу по гистограмме. */
function otsu(hist: Uint32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}

/** «Белизна» пикселя: светлый и бесцветный — бумага; светлый, но окрашенный стол или рука — нет. */
function whiteOf(ctx: CanvasRenderingContext2D, W: number, H: number): Uint8Array {
  const d = ctx.getImageData(0, 0, W, H).data;
  const g = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    const mn = Math.min(d[i], d[i + 1], d[i + 2]), mx = Math.max(d[i], d[i + 1], d[i + 2]);
    g[j] = Math.max(0, mn - (mx - mn));
  }
  return g;
}

/** Где на фото чек: самая большая белая область (белизна — whiteOf). null — обрезать не нужно. */
type Box = { x: number; y: number; w: number; h: number };
/** Чек на фото: рамка и для каждой полосы высотой f точек — где бумага слева и справа (чтобы закрасить стол рядом). */
type Paper = Box & { f: number; spans: [number, number][] };
function paperBox(g: Uint8Array, W: number, H: number): Paper | null {
  const f = Math.max(1, Math.ceil(Math.max(W, H) / 300));
  const w = Math.floor(W / f), h = Math.floor(H / f);
  const s = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) acc += g[(y * f + yy) * W + x * f + xx];
    const v = acc / (f * f); s[y * w + x] = v; hist[v | 0]++;
  }
  // Порог: по Оцу, но не ниже 80% от самых белых точек (2% ярчайших) — иначе светлые участки стола и блики
  // считаются бумагой, когда чек занимает малую часть кадра
  let p98 = 255, acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= w * h * 0.02) { p98 = v; break; } }
  const th = Math.max(otsu(hist, w * h), p98 * 0.8);
  // Текст на бумаге тёмный — «закрываем» его: светлый пиксель или светлые соседи
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < s.length; i++) bright[i] = s[i] > th ? 1 : 0;
  const seen = new Uint8Array(w * h);
  let bestN = 0, bestId = 0, box = { x0: 0, y0: 0, x1: 0, y1: 0 }, id = 0;
  const stack: number[] = [];
  for (let i = 0; i < bright.length; i++) {
    if (!bright[i] || seen[i]) continue;
    let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    id++;
    stack.push(i); seen[i] = id;
    while (stack.length) {
      const k = stack.pop()!, x = k % w, y = (k / w) | 0;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      // соседи на расстоянии 2 — перешагиваем тонкие тёмные буквы
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (bright[j] && !seen[j]) { seen[j] = id; stack.push(j); }
      }
    }
    if (n > bestN) { bestN = n; bestId = id; box = { x0, y0, x1, y1 }; }
  }
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  // Бумага занимает почти весь кадр или найдено что-то крошечное — не режем
  if (bestN < w * h * 0.06 || (bw > w * 0.92 && bh > h * 0.92)) return null;
  // Где бумага в каждой строке: от самой левой до самой правой клетки чека (буквы внутри не мешают)
  const spans: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (seen[y * w + x] === bestId) { if (a < 0) a = x; b = x; }
    spans.push(a < 0 ? [1, 0] : [Math.max(0, a - 1) * f, Math.min(W, (b + 2) * f)]);
  }
  const m = 2;
  const x = Math.max(0, (box.x0 - m) * f), y = Math.max(0, (box.y0 - m) * f);
  return { x, y, w: Math.min(W, (box.x1 + 1 + m) * f) - x, h: Math.min(H, (box.y1 + 1 + m) * f) - y, f, spans };
}

/** Наклон строк в радианах: перебираем углы и ищем, где строки текста дают самые «резкие» полосы. */
function skewAngle(g: Uint8Array, W: number, box: Box): number {
  const f = Math.max(1, Math.round(box.w / 500));
  const pts: number[] = [];
  const hist = new Uint32Array(256);
  for (let y = box.y; y < box.y + box.h; y += f) for (let x = box.x; x < box.x + box.w; x += f) hist[g[y * W + x]]++;
  const th = otsu(hist, hist.reduce((a, b) => a + b, 0));
  for (let y = box.y; y < box.y + box.h; y += f) for (let x = box.x; x < box.x + box.w; x += f) if (g[y * W + x] < th) pts.push((x - box.x) / f, (y - box.y) / f);
  if (pts.length < 200) return 0;
  const step = Math.max(1, Math.floor(pts.length / 2 / 40000));
  const H = Math.ceil(Math.hypot(box.w, box.h) / f) + 4;
  let best = 0, bestScore = -1;
  for (let deg = -10; deg <= 10.001; deg += 0.25) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const bins = new Float64Array(2 * H);
    for (let i = 0; i < pts.length; i += 2 * step) bins[(pts[i + 1] * c - pts[i] * s + H) | 0]++;
    let score = 0;
    for (let i = 0; i < bins.length; i++) score += bins[i] * bins[i];
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return Math.abs(best) < (0.3 * Math.PI) / 180 ? 0 : best;
}

/** Улучшение фото перед распознаванием: поворот, обрезка по чеку, выравнивание, размер, контраст. */
export async function prepareImage(file: Blob, rotate: 0 | 90 | 180 | 270 = 0, o: PrepOpts = {}): Promise<Blob> {
  const { crop = true, deskew = true, width = 1300 } = o;
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
  } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w0 = (bmp as any).width as number, h0 = (bmp as any).height as number;
  const swap = rotate === 90 || rotate === 270;
  // 1. Поворот, который выбрал человек; рабочий размер — не больше 3000 по длинной стороне (лимит iPhone)
  const [ow, oh] = swap ? [h0, w0] : [w0, h0];
  const k0 = Math.min(1, 3000 / Math.max(ow, oh));
  const W = Math.round(ow * k0), H = Math.round(oh * k0);
  const src = document.createElement("canvas");
  src.width = W; src.height = H;
  const sctx = src.getContext("2d", { willReadFrequently: true })!;
  sctx.fillStyle = "#fff"; sctx.fillRect(0, 0, W, H);
  sctx.translate(W / 2, H / 2);
  sctx.rotate((rotate * Math.PI) / 180);
  const dw = swap ? H : W, dh = swap ? W : H;
  sctx.drawImage(bmp as CanvasImageSource, -dw / 2, -dh / 2, dw, dh);
  sctx.setTransform(1, 0, 0, 1, 0, 0);

  // 2. Где чек и насколько он наклонён
  const paper = crop ? paperBox(whiteOf(sctx, W, H), W, H) : null;
  if (paper) {
    // Стол и руку рядом с чеком закрашиваем белым — иначе их узор распознаётся как буквы
    const im = sctx.getImageData(0, 0, W, H), d = im.data;
    for (let y = 0; y < H; y++) {
      const [a, b] = paper.spans[Math.min(paper.spans.length - 1, (y / paper.f) | 0)];
      for (let x = 0; x < W; x++) if (x < a || x >= b) { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
    }
    sctx.putImageData(im, 0, 0);
  }
  const g0 = grayOf(sctx, W, H);
  const box: Box = paper || { x: 0, y: 0, w: W, h: H };
  const ang = deskew ? skewAngle(g0, W, box) : 0;

  // 3. Вырезаем чек, выравниваем и подгоняем размер: в строке чека ~40 знаков, ширина ~1300 — буквы около 30 точек.
  // Длинный узкий чек может быть высоким: ограничиваем площадь (лимит холста iPhone ~16 млн точек) и сторону
  let k = 1;
  if (box.w < width) k = Math.min(5, width / box.w);
  if (box.w * box.h * k * k > 12e6) k = Math.sqrt(12e6 / (box.w * box.h));
  if (Math.max(box.w, box.h) * k > 8000) k = 8000 / Math.max(box.w, box.h);
  const OW = Math.round(box.w * k), OH = Math.round(box.h * k);
  const cv = document.createElement("canvas");
  cv.width = OW; cv.height = OH;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, OW, OH);
  ctx.translate(OW / 2, OH / 2);
  ctx.rotate(-ang);
  ctx.scale(k, k);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, -(box.x + box.w / 2), -(box.y + box.h / 2));
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // 4. Серое с растяжением контраста по 2–98 перцентилям и мягкой S-кривой: текст темнее, фон белее.
  // Жёсткую бинаризацию не делаем: на фото с фоном и размытием она съедает буквы (проверено на тестовых чеках).
  const img = ctx.getImageData(0, 0, OW, OH);
  const d = img.data;
  const g = new Uint8Array(OW * OH);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const hist = new Uint32Array(256);
  for (let j = 0; j < g.length; j++) hist[g[j]]++;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= g.length * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= g.length * 0.02) { hi = v; break; } }
  if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); }
  const mid = (lo + hi) / 2;
  for (let j = 0, i = 0; j < g.length; j++, i += 4) {
    let v = ((g[j] - lo) / (hi - lo)) * 255;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    v = v < mid * 0.55 ? v * 0.5 : v > mid ? Math.min(255, v * 1.15 + 15) : v;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Не удалось подготовить фото"))), "image/png"));
}

let scriptP: Promise<any> | null = null;
function loadLib(): Promise<any> {
  if ((window as any).Tesseract) return Promise.resolve((window as any).Tesseract);
  if (!scriptP) {
    scriptP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = base() + "tesseract.min.js";
      s.onload = () => res((window as any).Tesseract);
      s.onerror = () => { scriptP = null; rej(new Error("Не загрузился модуль распознавания")); };
      document.head.appendChild(s);
    });
  }
  return scriptP;
}

export interface OcrProgress { status: string; progress: number }

/** Распознаёт текст на картинке. onProgress — для полосы загрузки. */
export async function recognize(img: Blob, onProgress: (p: OcrProgress) => void, o: { langs?: string[]; psm?: string } = {}): Promise<string> {
  const T = await loadLib();
  // Только русский: с английским распознавание путает похожие буквы («CMETAHA» вместо «СМЕТАНА»)
  const worker = await T.createWorker(o.langs || ["rus"], 1, {
    workerPath: base() + "worker.min.js",
    corePath: base(),
    langPath: base().replace(/\/$/, ""),
    gzip: false,
    workerBlobURL: false,
    cacheMethod: "none",
    logger: (m: any) => onProgress({ status: String(m.status || ""), progress: Number(m.progress || 0) }),
  });
  try {
    // Чек — один столбец строк; пробелы между словами сохраняем
    await worker.setParameters({ tessedit_pageseg_mode: o.psm || "6", preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(img);
    return String(data.text || "");
  } finally {
    try { await worker.terminate(); } catch { /* уже закрыт */ }
  }
}

/** Понятная подпись этапа для человека. */
export function statusText(s: string): string {
  if (/loading tesseract core/i.test(s)) return "Загружаю модуль распознавания…";
  if (/loading language/i.test(s)) return "Загружаю русский язык (один раз, потом без интернета)…";
  if (/initializ/i.test(s)) return "Готовлюсь…";
  if (/recogniz/i.test(s)) return "Читаю чек…";
  return "Работаю…";
}
