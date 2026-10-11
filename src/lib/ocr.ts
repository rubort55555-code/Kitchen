// Распознавание текста на фото чека — прямо на телефоне, без интернета (Tesseract.js, русский + английский).
// Файлы языков (≈8 МБ) и ядро (≈4 МБ) лежат рядом с приложением и скачиваются один раз при первом распознавании.

const base = () => new URL("ocr/", document.baseURI).href;

/** Улучшение фото перед распознаванием: размер, чёрно-белое, контраст, поворот. */
export async function prepareImage(file: Blob, rotate: 0 | 90 | 180 | 270 = 0): Promise<Blob> {
  let bmp: ImageBitmap | HTMLImageElement;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
  } catch {
    bmp = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const w0 = (bmp as any).width as number, h0 = (bmp as any).height as number;
  const swap = rotate === 90 || rotate === 270;
  // Размер: текст должен быть крупным (ширина ≥ 1200), но картинка не больше ~3000 по длинной стороне (лимит iPhone)
  const [ow, oh] = swap ? [h0, w0] : [w0, h0];
  let k = 1;
  if (Math.min(ow, oh) < 1000) k = 1000 / Math.min(ow, oh);
  if (Math.max(ow * k, oh * k) > 3000) k = 3000 / Math.max(ow, oh);
  const W = Math.round(ow * k), H = Math.round(oh * k);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  const dw = swap ? H : W, dh = swap ? W : H;
  ctx.drawImage(bmp as CanvasImageSource, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  // Серое + растяжение контраста по 2–98 перцентилям + мягкая бинаризация
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
    d[i] = g; hist[g]++;
  }
  const total = W * H;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  if (hi - lo < 40) { lo = Math.max(0, lo - 20); hi = Math.min(255, hi + 20); }
  const mid = (lo + hi) / 2;
  for (let i = 0; i < d.length; i += 4) {
    let g = ((d[i] - lo) / (hi - lo)) * 255;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    // мягкая S-кривая: текст темнее, фон белее
    g = g < mid * 0.55 ? g * 0.5 : g > mid ? Math.min(255, g * 1.15 + 15) : g;
    d[i] = d[i + 1] = d[i + 2] = g; d[i + 3] = 255;
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
export async function recognize(img: Blob, onProgress: (p: OcrProgress) => void): Promise<string> {
  const T = await loadLib();
  const worker = await T.createWorker(["rus", "eng"], 1, {
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
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
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
