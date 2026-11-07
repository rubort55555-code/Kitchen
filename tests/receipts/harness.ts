// Проверка распознавания чеков: рисуем чек, делаем из него «фото» (фон, наклон, тень, размытие, бледная печать),
// прогоняем подготовку фото, распознавание и разбор, считаем, сколько товаров найдено с верным названием и ценой.
// Запуск: python3 tests/e2e_receipts.py
import { SPECS as BASE, type Spec } from "./receipts";
import { HOLD } from "./holdout";
// Чеки, на которых настраивался разбор, и отложенные — чтобы видеть, не подогнан ли разбор под первые
const SPECS = [...BASE, ...HOLD];
import { prepareImage, recognize } from "../../src/lib/ocr";
import { parseReceipt } from "../../src/lib/receipt";

let seed = 1;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

function paper(spec: Spec, faded: boolean): HTMLCanvasElement {
  const fs = 22, lh = 30, W = 576;
  const c = document.createElement("canvas");
  c.width = W; c.height = 60 + spec.lines.length * lh + 40;
  const x = c.getContext("2d")!;
  x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, c.width, c.height);
  x.font = `${fs}px "DejaVu Sans Mono", monospace`;
  x.fillStyle = faded ? "#5a5a5a" : "#1c1c1c";
  spec.lines.forEach((l, i) => {
    // термопечать: местами бледнее
    x.globalAlpha = faded ? 0.55 + rnd() * 0.35 : 0.9 + rnd() * 0.1;
    x.fillText(l, 14, 50 + i * lh, W - 20);
  });
  x.globalAlpha = 1;
  return c;
}

async function photo(spec: Spec, kind: string): Promise<Blob> {
  const p = paper(spec, kind === "faded");
  if (kind === "scan") return new Promise((r) => p.toBlob((b) => r(b!), "image/png"));
  const W = 2268, H = 3024; // как фото с телефона (уменьшено)
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d")!;
  // стол
  x.fillStyle = "#6b4f3a"; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${40 + rnd() * 60},${30 + rnd() * 40},${20 + rnd() * 30},0.15)`; x.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3); }
  // чек: занимает ~55% ширины кадра, повёрнут
  const scale = (W * (kind === "small" ? 0.38 : 0.55)) / p.width;
  const ang = ((rnd() * 2 - 1) * (kind === "tilt" ? 7 : 3.5) * Math.PI) / 180;
  x.save(); x.translate(W / 2, H / 2); x.rotate(ang);
  x.shadowColor = "rgba(0,0,0,0.5)"; x.shadowBlur = 30;
  x.drawImage(p, (-p.width * scale) / 2, (-p.height * scale) / 2, p.width * scale, p.height * scale);
  x.restore();
  // неровный свет: тень с одной стороны
  const g = x.createLinearGradient(0, 0, W, H * 0.6);
  g.addColorStop(0, "rgba(0,0,0,0.35)"); g.addColorStop(0.5, "rgba(0,0,0,0.05)"); g.addColorStop(1, "rgba(255,240,200,0.12)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // размытие и шум
  const c2 = document.createElement("canvas"); c2.width = W; c2.height = H;
  const y = c2.getContext("2d")!;
  y.filter = `blur(${kind === "blur" ? 2.2 : 1.1}px)`; y.drawImage(c, 0, 0); y.filter = "none";
  const im = y.getImageData(0, 0, W, H); const d = im.data;
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  y.putImageData(im, 0, 0);
  return new Promise((r) => c2.toBlob((b) => r(b!), "image/jpeg", 0.82));
}

export async function bench(kinds: string[], opts: any = {}) {
  const out: any[] = [];
  for (const kind of kinds) for (const spec of SPECS) {
    seed = 7 + spec.id.length * 13 + kind.length * 101;
    const blob = await photo(spec, kind);
    const t0 = performance.now();
    const img = await prepareImage(blob, 0, opts.prep);
    const text = await recognize(img, () => {}, opts);
    const items = parseReceipt(text);
    const ALT: Record<string, string[]> = { "Хлеб": ["Хлеб бородинский", "Хлеб зерновой"], "Сыр твёрдый": ["Российский сыр", "Сыр российский"] };
    const same = (a: string, e: string) => a === e || (ALT[e] || []).includes(a);
    const hit = spec.items.filter((e) => items.some((i) => same(i.name, e.name) && Math.abs(i.price - e.price) < 0.011));
    const nameHit = spec.items.filter((e) => items.some((i) => same(i.name, e.name)));
    const priceHit = spec.items.filter((e) => items.some((i) => Math.abs(i.price - e.price) < 0.011));
    out.push({ kind, id: spec.id, want: spec.items.length, hit: hit.length, name: nameHit.length, price: priceHit.length, extra: items.length - hit.length, ms: Math.round(performance.now() - t0), text, items: items.map((i) => `${i.name}|${i.price}`) });
  }
  return out;
}
(window as any).bench = bench;
