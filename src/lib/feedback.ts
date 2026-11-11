// Сообщение об ошибке: голос → текст, вложения, отправка. Анонимно: никаких идентификаторов, только текст, файлы и версия приложения.
// Принимает сообщения Worker из папки worker/ (Cloudflare). Адрес — после первого развёртывания (см. worker/README.md).

/** Адрес приёмника (worker/). Не секретный: сервер принимает запросы только с сайта приложения и ограничивает частоту. Можно заменить при сборке переменной FEEDBACK_URL. */
const DEFAULT_URL = "https://kitchen-feedback.rubort55555.workers.dev";
export const FEEDBACK_URL: string = (typeof __FEEDBACK_URL__ !== "undefined" && __FEEDBACK_URL__) || DEFAULT_URL;

export const LIMITS = { text: 5000, files: 5, fileBytes: 5 * 1024 * 1024, voiceSec: 120 } as const;
export const FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain"] as const;
export const FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt";

export const feedbackReady = () => !!FEEDBACK_URL;

/** Проверка вложения до отправки; пусто — всё хорошо. */
export function fileProblem(f: { name: string; type: string; size: number }): string {
  const type = f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : /\.txt$/i.test(f.name) ? "text/plain" : "");
  if (!(FILE_TYPES as readonly string[]).includes(type)) return `«${f.name}»: можно приложить картинку (PNG, JPG, WebP, GIF), PDF или текстовый файл.`;
  if (f.size > LIMITS.fileBytes) return `«${f.name}»: файл больше 5 МБ.`;
  return "";
}

const ERRORS: Record<string, string> = {
  "slow-down": "Слишком часто. Подождите минуту и попробуйте снова.",
  "voice-off": "Распознавание речи сейчас недоступно. Напишите сообщение текстом.",
  "voice-failed": "Не удалось распознать речь. Попробуйте ещё раз или напишите текстом.",
  "too-big": "Запись слишком длинная. Надиктуйте покороче.",
  "text-too-long": "Текст слишком длинный.",
  "bad-type": "Этот тип файла не подходит.",
  "bad-file": "Файл повреждён или не совпадает со своим типом.",
  "file-too-big": "Один из файлов больше 5 МБ.",
  "too-many-files": "Файлов должно быть не больше пяти.",
  "not-configured": "Приём сообщений ещё не настроен.",
};

async function post(path: string, body: BodyInit): Promise<{ ok: boolean; [k: string]: unknown }> {
  if (!FEEDBACK_URL) throw new Error("Приём сообщений ещё не подключён.");
  let res: Response;
  try { res = await fetch(FEEDBACK_URL.replace(/\/$/, "") + path, { method: "POST", body }); }
  catch { throw new Error("Нет связи. Проверьте интернет и попробуйте снова."); }
  let data: { ok: boolean; error?: string } = { ok: false };
  try { data = await res.json(); } catch { /* не JSON */ }
  if (!res.ok || !data.ok) throw new Error(ERRORS[data.error || ""] || "Не получилось отправить. Попробуйте позже.");
  return data as { ok: boolean };
}

/** Голос → текст. Запись уходит на распознавание и нигде не сохраняется. */
export async function transcribe(audio: Blob): Promise<string> {
  const data = await post("/transcribe", audio);
  return String(data.text || "");
}

export async function sendReport(text: string, files: File[], version: string): Promise<void> {
  const f = new FormData();
  f.set("text", text.trim());
  f.set("version", version);
  f.set("website", ""); // приманка для роботов: человек её не видит и не заполняет
  files.forEach((x) => f.append("files", x, x.name));
  await post("/report", f);
}

/** Формат записи, который поддерживает телефон: Safari — mp4, Chrome — webm. */
export function pickAudioType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
}
export const voiceSupported = () => typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
