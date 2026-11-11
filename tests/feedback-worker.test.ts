// Проверка приёма сообщений (worker/src/index.js): node node_modules/.bin/tsx tests/feedback-worker.test.ts
// @ts-ignore — обычный JS-файл Worker
import worker, { fenceFor, issueTitle } from "../worker/src/index.js";
let pass = 0, fail = 0;
const ok = (name: string, c: boolean, extra?: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", name, extra ?? ""); } };

const ORIGIN = "https://rubort55555-code.github.io";
const calls: { url: string; method: string; body: any }[] = [];
let branchExists = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any = {}) => {
  const u = String(url), method = init.method || "GET";
  calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null });
  const r = (data: any, status = 200) => new Response(JSON.stringify(data), { status });
  if (u.endsWith("/git/ref/heads/feedback-data")) return branchExists ? r({}) : r({}, 404);
  if (u.endsWith("/git/ref/heads/main")) return r({ object: { sha: "abc" } });
  if (u.endsWith("/git/refs")) { branchExists = true; return r({}, 201); }
  if (u.includes("/contents/")) return r({}, 201);
  if (u.endsWith("/issues")) return r({ number: 1 }, 201);
  return r({}, 500);
}) as any;

const logs: unknown[] = [];
const origLog = console.log; const origErr = console.error;
const quiet = <T,>(f: () => Promise<T>) => f();
const env: any = { GITHUB_REPO: "o/r", BASE_BRANCH: "main", ALLOWED_ORIGINS: ORIGIN + ",capacitor://localhost", FEEDBACK_GITHUB_TOKEN: "t0ken", AI: { run: async (_m: string, p: any) => ({ text: " привет, кнопка не нажимается " + (p.language || "") }) }, LIMITER: { limit: async () => ({ success: true }) } };
const post = (path: string, body: any, headers: Record<string, string> = { origin: ORIGIN }, e = env) => worker.fetch(new Request("https://w.example" + path, { method: "POST", body, headers }), e);
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], "a.png", { type: "image/png" });
const form = (o: Record<string, any>, files: File[] = []) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); files.forEach((x) => f.append("files", x)); return f; };

(async () => {
  // Доступ
  ok("чужой сайт отклоняется", (await post("/report", form({ text: "x" }), { origin: "https://evil.example" })).status === 403);
  ok("запрос без Origin отклоняется", (await post("/report", form({ text: "x" }), {})).status === 403);
  const pre = await worker.fetch(new Request("https://w.example/report", { method: "OPTIONS", headers: { origin: ORIGIN } }), env);
  ok("предварительный запрос браузера разрешён для сайта", pre.status === 204 && pre.headers.get("access-control-allow-origin") === ORIGIN);
  ok("приложение из магазина разрешено", (await post("/report", form({ text: "x" }), { origin: "capacitor://localhost" })).status === 200);
  ok("без настройки (нет токена) — 503", (await post("/report", form({ text: "x" }), { origin: ORIGIN }, { ...env, FEEDBACK_GITHUB_TOKEN: "" })).status === 503);
  ok("слишком частые запросы — 429", (await post("/report", form({ text: "x" }), { origin: ORIGIN }, { ...env, LIMITER: { limit: async () => ({ success: false }) } })).status === 429);

  // Текст
  calls.length = 0;
  let res = await post("/report", form({ text: "Не работает кнопка @octocat #1 ```ломаю блок```", version: "2026.11.11-0709-a10265e" }));
  const issue = calls.find((c) => c.url.endsWith("/issues"));
  ok("текст без вложений создаёт задачу", res.status === 200 && !!issue);
  ok("ветка для вложений не создаётся, если вложений нет", !calls.some((c) => c.url.includes("/git/refs")));
  ok("текст лежит в защищённом блоке длиннее любых кавычек внутри", issue!.body.body.includes("````\nНе работает кнопка @octocat #1 ```ломаю блок```\n````"), issue!.body.body);
  ok("в заголовке нет @ и #", !/[@#]/.test(issue!.body.title) && issue!.body.title.startsWith("Из приложения:"), issue!.body.title);
  ok("версия приложения в описании, пометка «анонимное»", issue!.body.body.includes("Анонимное") && issue!.body.body.includes("2026.11.11-0709-a10265e"));
  ok("задача получает метку «из приложения»", issue!.body.labels[0] === "из приложения");
  ok("о человеке в задаче нет ничего, кроме текста и версии", !/ip|user-agent|agent/i.test(issue!.body.body.replace(/Анонимное сообщение из приложения/g, "")));
  ok("fenceFor: минимум три кавычки", fenceFor("a") === "```" && fenceFor("`` x") === "```" && fenceFor("```` x") === "`````");
  ok("issueTitle: до 80 знаков, пустой текст не ломает", issueTitle("а".repeat(200)).length <= 80 && issueTitle("   ").includes("без текста"));

  // Ограничения
  ok("пустое сообщение — 400", (await post("/report", form({ text: "  " }))).status === 400);
  ok("слишком длинный текст — 413", (await post("/report", form({ text: "а".repeat(5001) }))).status === 413);
  ok("больше пяти файлов — 413", (await post("/report", form({ text: "x" }, Array.from({ length: 6 }, png)))).status === 413);
  ok("неподходящий тип файла — 415", (await post("/report", form({ text: "x" }, [new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })]))).status === 415);
  ok("файл, выданный не за свой тип, — 415", (await post("/report", form({ text: "x" }, [new File(["not a png"], "a.png", { type: "image/png" })]))).status === 415);
  ok("файл больше 5 МБ — 413", (await post("/report", form({ text: "x" }, [new File([new Uint8Array(5 * 1024 * 1024 + 1).fill(0x20)], "a.txt", { type: "text/plain" })]))).status === 413);
  calls.length = 0;
  ok("приманка для роботов: молча «ок» и ничего не создаёт", (await post("/report", form({ text: "спам", website: "http://x" }))).status === 200 && calls.length === 0);

  // Вложения
  calls.length = 0; branchExists = false;
  res = await post("/report", form({ text: "скриншот" }, [png(), new File(["лог"], "log.txt", { type: "text/plain" })]));
  const puts = calls.filter((c) => c.url.includes("/contents/"));
  ok("вложения: ветка создана, оба файла загружены", res.status === 200 && calls.some((c) => c.url.endsWith("/git/refs")) && puts.length === 2);
  ok("имя файла не берётся у человека (случайное)", puts.every((c) => /feedback\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{8}-\d\.(png|txt)$/.test(c.url)), puts.map((p) => p.url));
  const iss2 = calls.find((c) => c.url.endsWith("/issues"))!;
  ok("картинка вставлена в задачу, текстовый файл — ссылкой", iss2.body.body.includes("![вложение 1](https://raw.githubusercontent.com/o/r/feedback-data/") && iss2.body.body.includes("[вложение 2 (txt)]"));
  ok("токен уходит только в GitHub", calls.every((c) => c.url.startsWith("https://api.github.com/")));

  // Голос
  let t = await post("/transcribe", new Uint8Array([1, 2, 3]));
  const tj: any = await t.json();
  ok("голос: возвращается текст без пробелов по краям, язык русский", t.status === 200 && tj.text === "привет, кнопка не нажимается ru", tj);
  ok("голос: пустая запись — 400", (await post("/transcribe", new Uint8Array(0))).status === 400);
  ok("голос: слишком большая запись — 413", (await post("/transcribe", new Uint8Array(8 * 1024 * 1024 + 1))).status === 413);
  ok("голос: без нейросети — 503", (await post("/transcribe", new Uint8Array([1]), { origin: ORIGIN }, { ...env, AI: undefined })).status === 503);
  ok("голос: сбой нейросети — 502, текст ошибки не раскрывается", await (async () => { const r = await post("/transcribe", new Uint8Array([1]), { origin: ORIGIN }, { ...env, AI: { run: async () => { throw new Error("secret"); } } }); return r.status === 502 && !(await r.text()).includes("secret"); })());

  // GitHub упал
  const f0 = globalThis.fetch; globalThis.fetch = (async () => new Response("{}", { status: 500 })) as any;
  const bad = await post("/report", form({ text: "x" }));
  ok("сбой GitHub — 502 без подробностей", bad.status === 502 && !(await bad.text()).includes("t0ken"));
  globalThis.fetch = f0;
  ok("в журнал ничего не пишется", logs.length === 0);
  globalThis.fetch = realFetch;
  origLog(`feedback-worker: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
