// Приём сообщений об ошибках из приложения «Кухня».
// Анонимно: мы не читаем и не сохраняем адрес подключения, не выдаём идентификаторов и ничего не пишем в журнал.
// /transcribe — голос → текст (бесплатная модель Whisper в Cloudflare Workers AI; запись нигде не сохраняется).
// /report — текст и вложения → задача (issue) в репозитории от имени бота; вложения кладутся в ветку feedback-data.

const MAX_TEXT = 5000;
const MAX_FILES = 5;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_AUDIO = 8 * 1024 * 1024;
const BRANCH = "feedback-data";

/** Разрешённые вложения: тип → расширение и проверка начала файла (чтобы под картинку не подсунули другое). */
const KINDS = {
  "image/png": { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  "image/webp": { ext: "webp", magic: [[0x52, 0x49, 0x46, 0x46]] },
  "image/gif": { ext: "gif", magic: [[0x47, 0x49, 0x46, 0x38]] },
  "application/pdf": { ext: "pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  "text/plain": { ext: "txt", magic: null },
};

const json = (data, status, cors) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...cors } });

function corsFor(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(origin)) return null;
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400", vary: "origin" };
}

function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b);

/** Обратные кавычки вокруг текста — длиннее любых внутри, чтобы текст не «вышел» из блока (в блоке @упоминания никого не уведомляют). */
export function fenceFor(text) {
  const runs = String(text).match(/`+/g) || [];
  const n = Math.max(2, ...runs.map((r) => r.length)) + 1;
  return "`".repeat(n);
}

export function issueTitle(text) {
  const first = String(text).split("\n").map((x) => x.trim()).find(Boolean) || "без текста";
  return ("Из приложения: " + first.replace(/[@#<>]/g, "")).slice(0, 80);
}

async function gh(env, path, init = {}) {
  const res = await fetch("https://api.github.com/repos/" + env.GITHUB_REPO + path, {
    ...init,
    headers: { authorization: "Bearer " + env.FEEDBACK_GITHUB_TOKEN, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "kitchen-feedback", "content-type": "application/json", ...(init.headers || {}) },
  });
  return res;
}

async function ensureBranch(env) {
  const have = await gh(env, "/git/ref/heads/" + BRANCH);
  if (have.ok) return;
  const base = await gh(env, "/git/ref/heads/" + (env.BASE_BRANCH || "main"));
  if (!base.ok) throw new Error("base");
  const sha = (await base.json()).object.sha;
  const made = await gh(env, "/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/" + BRANCH, sha }) });
  if (!made.ok && made.status !== 422) throw new Error("branch");
}

async function transcribe(req, env, cors) {
  if (!env.AI) return json({ ok: false, error: "voice-off" }, 503, cors);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return json({ ok: false, error: "empty" }, 400, cors);
  if (buf.length > MAX_AUDIO) return json({ ok: false, error: "too-big" }, 413, cors);
  try {
    const out = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
      audio: b64(buf), language: "ru",
      initial_prompt: "Приложение «Кухня»: продукты, холодильник, рецепты, меню на неделю, дневник питания, срок годности.",
    });
    return json({ ok: true, text: String(out?.text || "").trim() }, 200, cors);
  } catch {
    return json({ ok: false, error: "voice-failed" }, 502, cors);
  }
}

async function report(req, env, cors) {
  let form;
  try { form = await req.formData(); } catch { return json({ ok: false, error: "bad-form" }, 400, cors); }
  // Приманка для роботов: настоящее приложение это поле не заполняет
  if (String(form.get("website") || "")) return json({ ok: true }, 200, cors);
  const text = String(form.get("text") || "").trim();
  const version = String(form.get("version") || "").replace(/[^0-9a-zA-Z.\-_]/g, "").slice(0, 40);
  const files = form.getAll("files").filter((f) => typeof f === "object" && f && "arrayBuffer" in f);
  if (!text && !files.length) return json({ ok: false, error: "empty" }, 400, cors);
  if (text.length > MAX_TEXT) return json({ ok: false, error: "text-too-long" }, 413, cors);
  if (files.length > MAX_FILES) return json({ ok: false, error: "too-many-files" }, 413, cors);

  const ready = [];
  for (const f of files) {
    const kind = KINDS[String(f.type).split(";")[0]];
    if (!kind) return json({ ok: false, error: "bad-type" }, 415, cors);
    if (f.size > MAX_FILE) return json({ ok: false, error: "file-too-big" }, 413, cors);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (kind.magic && !kind.magic.some((sig) => startsWith(bytes, sig))) return json({ ok: false, error: "bad-file" }, 415, cors);
    ready.push({ bytes, ext: kind.ext, image: kind.ext !== "pdf" && kind.ext !== "txt" });
  }

  try {
    const id = crypto.randomUUID().slice(0, 8);
    const day = new Date().toISOString().slice(0, 10);
    const links = [];
    if (ready.length) {
      await ensureBranch(env);
      for (let i = 0; i < ready.length; i++) {
        const path = `feedback/${day}/${id}-${i + 1}.${ready[i].ext}`;
        const put = await gh(env, "/contents/" + path, { method: "PUT", body: JSON.stringify({ message: "Вложение к сообщению " + id, content: b64(ready[i].bytes), branch: BRANCH }) });
        if (!put.ok) throw new Error("upload");
        links.push(ready[i].image
          ? `![вложение ${i + 1}](https://raw.githubusercontent.com/${env.GITHUB_REPO}/${BRANCH}/${path})`
          : `[вложение ${i + 1} (${ready[i].ext})](https://github.com/${env.GITHUB_REPO}/blob/${BRANCH}/${path})`);
      }
    }
    const fence = fenceFor(text);
    const body = [
      `Анонимное сообщение из приложения${version ? ` (версия ${version})` : ""}.`,
      "",
      text ? `${fence}\n${text}\n${fence}` : "_Без текста, только вложения._",
      ...(links.length ? ["", "**Вложения**", "", ...links.map((l) => l + "\n")] : []),
    ].join("\n");
    const issue = await gh(env, "/issues", { method: "POST", body: JSON.stringify({ title: issueTitle(text), body, labels: ["из приложения"] }) });
    if (!issue.ok) throw new Error("issue");
    return json({ ok: true }, 200, cors);
  } catch {
    return json({ ok: false, error: "server" }, 502, cors);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") return new Response("kitchen-feedback ok", { headers: { "content-type": "text/plain; charset=utf-8" } });
    const cors = corsFor(req, env);
    if (!cors) return new Response("forbidden", { status: 403 });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405, cors);
    // Ограничение частоты: Cloudflare считает по подключению сам, мы его не видим и не храним
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get("cf-connecting-ip") || "-" });
      if (!success) return json({ ok: false, error: "slow-down" }, 429, cors);
    }
    if (!env.FEEDBACK_GITHUB_TOKEN || !env.GITHUB_REPO) return json({ ok: false, error: "not-configured" }, 503, cors);
    if (url.pathname === "/transcribe") return transcribe(req, env, cors);
    if (url.pathname === "/report") return report(req, env, cors);
    return json({ ok: false, error: "not-found" }, 404, cors);
  },
};
