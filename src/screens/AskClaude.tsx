// «Спросить Claude»: готовый запрос → чат Claude → «Вставить ответ» → блюда в рецептах.
import { useMemo, useState } from "react";
import { Seg, Sheet } from "../components/ui";
import { saveRecipes, useStore } from "../lib/store";
import { buildPrompt, claudeUrl, parseAnswer } from "../lib/claude";
import { compileRules, checkRecipe } from "../lib/exclusions";
import type { Recipe } from "../lib/types";
import { daysLeft, plural } from "../lib/util";
import { closeSheet, goTab, toast } from "../lib/ui";

export function AskClaude() {
  const { products, settings } = useStore((s) => s);
  const members = settings.members;
  const [who, setWho] = useState<string>("all");
  const [minutes, setMinutes] = useState<string>("0");
  const [kind, setKind] = useState("любое");
  const [wish, setWish] = useState("");
  const [answer, setAnswer] = useState("");
  const [parsed, setParsed] = useState<Recipe[] | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const whoIds = who === "all" ? members.map((m) => m.id) : [who];
  const urgent = products.filter((p) => { const d = daysLeft(p.until); return d !== null && d <= 2; }).map((p) => p.name);

  const prompt = useMemo(() => buildPrompt(
    { who: whoIds, minutes: Number(minutes) || null, kind, count: 3, wish, useFirst: urgent.slice(0, 5) },
    products, members, settings.rules, settings.basics, settings.customCatalog,
  ), [who, minutes, kind, wish, products, settings]);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setAnswer(t); parse(t); } else setErr("Буфер обмена пуст. Скопируйте ответ Claude.");
    } catch {
      setErr("Не получилось прочитать буфер. Нажмите в поле ниже и выберите «Вставить».");
    }
  }

  const compiled = useMemo(() => compileRules(settings.rules, settings.customCatalog, members), [settings]);
  function parse(t = answer) {
    setErr("");
    const r = parseAnswer(t);
    if (r.error) { setParsed(null); setErr(r.error); return; }
    setParsed(r.recipes);
  }
  function save() {
    if (!parsed) return;
    const ok = parsed.filter((r) => checkRecipe(r, compiled, whoIds).verdict !== "hidden");
    saveRecipes(ok);
    const skipped = parsed.length - ok.length;
    toast(`Сохранено ${ok.length} ${plural(ok.length, "блюдо", "блюда", "блюд")}` + (skipped ? `, ${skipped} не подходит по ограничениям` : ""));
    closeSheet();
    goTab("recipes");
  }

  return (
    <Sheet title="Спросить Claude">
      <p className="muted small mt0">Claude получит список ваших продуктов, сроки и ограничения в питании. Это бесплатно — откроется обычный чат.</p>
      <label className="f">Кто будет есть</label>
      <Seg label="Кто будет есть" value={who} onChange={setWho} options={[{ v: "all", t: "Оба" }, ...members.map((m) => ({ v: m.id, t: "Только " + m.name }))]} />
      <label className="f">Время</label>
      <Seg label="Время" value={minutes} onChange={setMinutes} options={[{ v: "0", t: "Любое" }, { v: "15", t: "15 мин" }, { v: "30", t: "30 мин" }, { v: "60", t: "1 час" }]} />
      <label className="f">Блюдо</label>
      <div className="chips">
        {["любое", "завтрак", "обед", "ужин", "суп", "перекус", "выпечка"].map((k) => (
          <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
        ))}
      </div>
      <label className="f" htmlFor="wish">Пожелание (необязательно)</label>
      <input id="wish" className="inp" value={wish} onChange={(e: any) => setWish(e.target.value)} placeholder="Например: без духовки, что-то лёгкое" />
      {urgent.length > 0 && <p className="small"><b>В первую очередь:</b> {urgent.slice(0, 5).join(", ")}</p>}

      <a className="btn" style={{ marginTop: 16 }} href={claudeUrl(prompt)} target="_blank" rel="noopener noreferrer"
        onClick={() => { copy(prompt).then((ok) => setCopied(ok ? "Запрос открыт в Claude и на всякий случай скопирован." : "")); }}>
        Открыть Claude
      </a>
      <button className="btn ghost" onClick={async () => setCopied((await copy(prompt)) ? "Запрос скопирован. Вставьте его в чат с Claude." : "Не удалось скопировать — выделите текст запроса ниже.")}>Скопировать запрос</button>
      {copied && <p className="small muted" role="status">{copied}</p>}
      <details className="prompt"><summary>Посмотреть запрос</summary><pre>{prompt}</pre></details>

      <h2>Ответ Claude</h2>
      <p className="muted small mt0">Скопируйте ответ Claude целиком — вместе с блоком JSON в конце — и вставьте сюда.</p>
      <button className="btn sec" onClick={pasteFromClipboard}>Вставить ответ</button>
      <textarea className="inp" style={{ marginTop: 10 }} value={answer} onChange={(e: any) => { setAnswer(e.target.value); setParsed(null); }} placeholder="…или вставьте ответ в это поле" aria-label="Ответ Claude" />
      {answer.trim() && !parsed && <button className="btn" style={{ marginTop: 10 }} onClick={() => parse()}>Разобрать ответ</button>}
      {err && <p className="err" role="alert">{err}</p>}
      {parsed && (
        <>
          <h3 style={{ marginTop: 16 }}>Нашёл {parsed.length} {plural(parsed.length, "блюдо", "блюда", "блюд")}</h3>
          <div className="list">
            {parsed.map((r) => {
              const c = checkRecipe(r, compiled, whoIds);
              return (
                <div key={r.id} className="li" style={{ alignItems: "flex-start" }}>
                  <span className="ico">{c.verdict === "hidden" ? "🚫" : c.verdict === "warn" ? "⚠️" : "🍳"}</span>
                  <div className="main">
                    <div className="name" style={{ whiteSpace: "normal" }}>{r.name}</div>
                    <div className="meta">{r.minutes ? `${r.minutes} мин · ` : ""}{r.ingredients.length} ингр.</div>
                    {c.issues.filter((i) => i.rule.level === "never" || c.verdict === "hidden").map((i, k) => (
                      <div key={k} className={c.verdict === "hidden" ? "t-bad small" : "t-soon small"}>{c.verdict === "hidden" ? "Не сохраню: " : ""}{i.msg}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn" onClick={save}>Сохранить в рецепты</button>
        </>
      )}
    </Sheet>
  );
}
