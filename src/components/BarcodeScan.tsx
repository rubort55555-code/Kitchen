// Сканер штрихкода: камера в окне добавления продукта. Если камера недоступна —
// можно сфотографировать код или ввести цифры вручную.
import { useEffect, useRef, useState } from "react";
import { decodeGray, normCode, toGray } from "../lib/barcode";

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/** Встроенный в браузер распознаватель, если он есть (в Safari на iPhone его пока нет — тогда наш). */
async function nativeDetector(): Promise<Detector | null> {
  const BD = (window as any).BarcodeDetector;
  if (!BD) return null;
  try {
    const formats: string[] = await BD.getSupportedFormats?.() || [];
    const want = ["ean_13", "ean_8", "upc_a"].filter((f) => formats.includes(f));
    return want.length ? new BD({ formats: want }) : null;
  } catch { return null; }
}

/** Ищет код на картинке (кадр, фото). Снимок уменьшаем до разумного размера и пробуем два масштаба. */
export function decodeCanvasSource(src: CanvasImageSource, sw: number, sh: number, crop = 1, minVotes = 2, sizes = [1000, 640]): string | null {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // Середина картинки (crop — какая доля по ширине и высоте)
  const cw = sw * crop, ch = sh * crop;
  const cx = (sw - cw) / 2, cy = (sh - ch) / 2;
  for (const target of sizes) {
    const k = Math.min(1, target / Math.max(cw, ch));
    const w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    c.width = w; c.height = h;
    ctx.drawImage(src, cx, cy, cw, ch, 0, 0, w, h);
    const g = toGray(ctx.getImageData(0, 0, w, h).data, w, h);
    const code = decodeGray(g, w, h, minVotes);
    if (code) return normCode(code);
  }
  return null;
}

export type ScanHow = "camera" | "photo" | "manual";

export function BarcodeScan({ onCode, onClose, onFail }: { onCode: (code: string, how: ScanHow, sec?: number) => void; onClose: () => void; onFail?: (how: "fail-photo" | "bad-digits") => void }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<"start" | "live" | "nocam">("start");
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState("");
  const done = useRef(false);
  const started = useRef(0);

  function finish(code: string, how: ScanHow) {
    if (done.current) return;
    done.current = true;
    onCode(code, how, how === "camera" && started.current ? Math.round((Date.now() - started.current) / 100) / 10 : undefined);
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let lastSeen = "";
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState("nocam"); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch {
        if (!stopped) { setState("nocam"); setMsg("Камера недоступна. Разрешите доступ к камере в настройках Safari или сфотографируйте код."); }
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      try { await v.play(); } catch { /* iOS иногда требует касания — видео всё равно идёт */ }
      setState("live");
      started.current = Date.now();
      const native = await nativeDetector();
      const tick = async () => {
        if (stopped || done.current) return;
        if (v.videoWidth > 0) {
          let code: string | null = null;
          if (native) {
            try { const r = await native.detect(v); code = r[0] ? normCode(r[0].rawValue) : null; } catch { /* дальше наш распознаватель */ }
          }
          if (!code) {
            const c = decodeCanvasSource(v, v.videoWidth, v.videoHeight, 0.9, 1, [800]);
            // одно прочтение засчитываем, если тот же код был и в прошлом кадре
            if (c && (c === lastSeen)) code = c;
            else if (c) lastSeen = c;
          }
          if (code) { finish(code, "camera"); return; }
        }
        timer = setTimeout(tick, 120);
      };
      tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function onFile(e: any) {
    const f: File | undefined = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setMsg("Ищу штрихкод на фото…");
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const code = decodeCanvasSource(img, img.naturalWidth, img.naturalHeight, 1, 1)
        || decodeCanvasSource(img, img.naturalWidth, img.naturalHeight, 0.6, 1);
      URL.revokeObjectURL(url);
      if (code) finish(code, "photo");
      else {
        onFail?.("fail-photo");
        setMsg("Не нашёл штрихкод на фото. Снимите ближе, чтобы полоски были чёткими и занимали почти всю ширину, или введите цифры под кодом.");
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); setMsg("Не получилось открыть фото."); };
    img.src = url;
  }

  function submitManual(e: { preventDefault(): void }) {
    e.preventDefault();
    const c = normCode(manual);
    if (!c) { onFail?.("bad-digits"); setMsg("Проверьте цифры: обычно их 13 (или 8) и последняя — контрольная."); return; }
    finish(c, "manual");
  }

  return (
    <div className="scan">
      {state !== "nocam" && (
        <div className="scan-view">
          <video ref={video} playsInline muted autoPlay aria-label="Камера" />
          <div className="scan-frame" aria-hidden="true" />
          <p className="scan-hint">{state === "live" ? "Наведите на штрихкод — он распознается сам" : "Включаю камеру…"}</p>
        </div>
      )}
      {msg && <p className="muted small" role="status">{msg}</p>}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <div className="row2">
        <button type="button" className="btn sec" onClick={() => fileRef.current?.click()}>📷 Фото кода</button>
        <button type="button" className="btn sec" onClick={onClose}>Отмена</button>
      </div>
      <p className="muted small beta-note">Пробная функция. Как она работает у вас — видно в ⚙︎ → «Пробные функции».</p>
      <form onSubmit={submitManual} className="scan-manual">
        <input className="inp" inputMode="numeric" pattern="[0-9 ]*" value={manual} onChange={(e: any) => { setManual(e.target.value); setMsg(""); }} placeholder="Цифры под штрихкодом" aria-label="Цифры штрихкода" />
        <button className="btn" type="submit" disabled={manual.replace(/\D/g, "").length < 8}>Найти</button>
      </form>
    </div>
  );
}
