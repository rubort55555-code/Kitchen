// Чек → продукты: фото (распознавание на телефоне) или вставленный текст → проверка → склад.
import { useMemo, useRef, useState } from "react";
import { Sheet } from "../components/ui";
import { addProduct, setSettings, useStore } from "../lib/store";
import { findCatalog } from "../lib/catalog";
import { checkProduct, compileRules } from "../lib/exclusions";
import { CLAUDE_RECEIPT_PROMPT, findTotal, parseClaudeReceipt, parseReceipt, receiptKey, type ReceiptItem } from "../lib/receipt";
import { claudeUrl } from "../lib/claude";
import { prepareImage, recognize, statusText } from "../lib/ocr";
import { UNITS, type Place, type Unit } from "../lib/types";
import { closeAll, toast } from "../lib/ui";
import { plural, rub, toNum } from "../lib/util";
import { autoUntil } from "./AddProduct";

interface Row extends ReceiptItem { id: number; on: boolean; qtyS: string; priceS: string; orig: string }

export function Receipt({ mode }: { mode: "photo" | "text" }) {
  const settings = useStore((s) => s.settings);
  const compiled = useMemo(() => compileRules(settings.rules, settings.customCatalog, settings.members), [settings]);
  const who = settings.members.map((m) => m.id);
  const [stage, setStage] = useState<"start" | "busy" | "text" | "claude" | "review">(mode === "text" ? "text" : "start");
  // Ответ Claude по фото чека и итог из него
  const [answer, setAnswer] = useState("");
  const [claudeTotal, setClaudeTotal] = useState<number | null>(null);
  const [copied, setCopied] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [prog, setProg] = useState({ status: "", progress: 0 });
  const [err, setErr] = useState("");
  const [rot, setRot] = useState<0 | 90 | 180 | 270>(0);
  const file = useRef<File | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  async function run(f: File, r: 0 | 90 | 180 | 270) {
    setErr(""); setStage("busy"); setProg({ status: "", progress: 0 });
    try {
      const img = await prepareImage(f, r);
      const t = await recognize(img, setProg);
      setText(t);
      if (!t.trim()) setErr("Текст на фото не найден. Попробуйте сфотографировать ближе и при хорошем свете или повернуть фото.");
      setStage("text");
    } catch (e: any) {
      setErr("Не получилось распознать фото. Можно вставить текст чека вручную. " + (e?.message ? `(${e.message})` : ""));
      setStage("text");
    }
  }

  function onFile(e: any) {
    const f: File | undefined = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    file.current = f; setRot(0);
    run(f, 0);
  }

  function review(items: ReceiptItem[]) {
    setErr("");
    setRows(items.map((it, i) => ({ ...it, id: i, on: !it.nonFood, qtyS: String(it.qty).replace(".", ","), priceS: String(it.price).replace(".", ","), orig: it.name })));
    setStage("review");
  }
  function toReview() {
    const items = parseReceipt(text, settings.receiptMap || {}, settings.customCatalog);
    if (!items.length) { setErr("Не нашёл в тексте строк с товарами и ценами. Поправьте текст: каждая строка — «название количество x цена»."); return; }
    setClaudeTotal(null);
    review(items);
  }
  function fromClaude(t = answer) {
    const r = parseClaudeReceipt(t, settings.receiptMap || {}, settings.customCatalog);
    if (r.error) { setErr(r.error); return; }
    setClaudeTotal(r.total);
    review(r.items);
  }
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(CLAUDE_RECEIPT_PROMPT); return true; } catch { return false; }
  }

  const upd = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const active = rows.filter((r) => r.on);
  const sum = active.reduce((s, r) => s + (toNum(r.priceS) || 0), 0);
  // С итогом чека сверяем все позиции — и те, что не добавляем (пакет, помада)
  const allSum = rows.reduce((s, r) => s + (toNum(r.priceS) || 0), 0);
  const receiptTotal = useMemo(() => claudeTotal ?? findTotal(text), [text, claudeTotal]);
  const bad = (r: Row) => r.on && (!r.name.trim() || !((toNum(r.qtyS) || 0) > 0) || toNum(r.priceS) === null);

  function save() {
    if (active.some(bad)) { setErr("Проверьте выделенные строки: нужны название, количество и цена."); return; }
    const map = { ...(settings.receiptMap || {}) };
    for (const r of active) {
      const c = findCatalog(r.name, settings.customCatalog);
      const place: Place = c?.p || "Холодильник";
      addProduct({ name: r.name.trim(), qty: toNum(r.qtyS) as number, unit: r.unit, place, until: autoUntil(c, place), price: toNum(r.priceS) as number });
      // Запоминаем сокращение, если вы поправили название или его не знали
      if (r.raw && (r.name !== r.orig || !r.known)) map[receiptKey(r.raw)] = r.name.trim();
    }
    setSettings({ receiptMap: map });
    closeAll();
    toast(`Добавлено продуктов: ${active.length} на ${rub(sum)}`);
  }

  return (
    <Sheet title={mode === "text" ? "Текст чека" : "Чек"}>
      {stage === "start" && (
        <div className="center" style={{ paddingTop: 16 }}>
          <div style={{ fontSize: 56 }}>🧾</div>
          <h2>Сфотографируйте чек</h2>
          <p className="muted">Расправьте чек и подойдите ближе, чтобы строки с товарами занимали почти весь кадр — чем крупнее текст, тем точнее. Длинный чек снимите в две части и добавьте по очереди. Распознавание идёт на телефоне, фото никуда не отправляется.</p>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          <button className="btn" onClick={() => input.current?.click()}>📷 Сфотографировать</button>
          <button className="btn sec" onClick={() => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.onchange = onFile; i.click(); }}>🖼 Выбрать из галереи</button>
          <button className="btn sec" onClick={() => { setErr(""); setStage("claude"); }}>✨ Распознать с Claude — точнее</button>
          <button className="link" onClick={() => setStage("text")}>Вставить текст вместо фото</button>
          <p className="muted small">В первый раз скачается русский язык (около 8 МБ) — лучше по Wi‑Fi. Дальше работает без интернета.</p>
        </div>
      )}

      {stage === "claude" && (
        <>
          <h2 style={{ marginTop: 10 }}>Распознать с Claude</h2>
          <p className="muted mt0">Claude читает чеки намного точнее, чем распознавание на телефоне: полные названия, вес, цены со скидкой. Это бесплатно — откроется обычный чат.</p>
          <ol className="small">
            <li>Нажмите «Открыть Claude» — откроется чат с готовым запросом.</li>
            <li>Прикрепите фото чека (скрепка или «+» в чате) и отправьте.</li>
            <li>Скопируйте ответ Claude целиком, вернитесь сюда и нажмите «Вставить ответ».</li>
          </ol>
          <a className="btn" href={claudeUrl(CLAUDE_RECEIPT_PROMPT)} target="_blank" rel="noopener noreferrer"
            onClick={() => { copyPrompt().then((ok) => setCopied(ok ? "Запрос открыт в Claude и на всякий случай скопирован." : "")); }}>Открыть Claude</a>
          <button className="btn ghost" onClick={async () => setCopied((await copyPrompt()) ? "Запрос скопирован — вставьте его в чат с Claude вместе с фото." : "Не удалось скопировать — откройте «Посмотреть запрос» и выделите текст.")}>Скопировать запрос</button>
          {copied && <p className="small muted" role="status">{copied}</p>}
          <details className="prompt"><summary>Посмотреть запрос</summary><pre>{CLAUDE_RECEIPT_PROMPT}</pre></details>
          <h3>Ответ Claude</h3>
          <button className="btn sec" onClick={async () => { try { const t = await navigator.clipboard.readText(); if (t) { setAnswer(t); fromClaude(t); } else setErr("Буфер обмена пуст. Скопируйте ответ Claude."); } catch { setErr("Не получилось прочитать буфер. Нажмите в поле ниже и выберите «Вставить»."); } }}>Вставить ответ</button>
          <textarea className="inp" style={{ marginTop: 10 }} rows={6} value={answer} onChange={(e: any) => setAnswer(e.target.value)} placeholder="…или вставьте ответ в это поле" aria-label="Ответ Claude по чеку" />
          {answer.trim() && <button className="btn" style={{ marginTop: 10 }} onClick={() => fromClaude()}>Разобрать ответ</button>}
          {err && <p className="err" role="alert">{err}</p>}
          <button className="link" onClick={() => { setErr(""); setStage("start"); }}>← Назад</button>
        </>
      )}

      {stage === "busy" && (
        <div className="center" style={{ paddingTop: 40 }}>
          <div style={{ fontSize: 48 }}>🔍</div>
          <h2>{statusText(prog.status)}</h2>
          <div className="split" style={{ height: 12 }}><i style={{ width: Math.max(4, Math.round(prog.progress * 100)) + "%" }} /></div>
          <p className="muted small">Не закрывайте приложение. Обычно это занимает 10–30 секунд.</p>
        </div>
      )}

      {stage === "text" && (
        <>
          <h2 style={{ marginTop: 10 }}>{mode === "text" || !file.current ? "Вставьте текст чека" : "Что прочитано"}</h2>
          <p className="muted mt0">{file.current ? "Проверьте текст: можно исправить ошибки пальцем. Каждая строка — «название количество x цена»." : "На iPhone: откройте фото чека, нажмите и удерживайте текст («Живой текст»), «Скопировать», вернитесь сюда и вставьте."}</p>
          <textarea className="inp" rows={12} value={text} onChange={(e: any) => setText(e.target.value)} placeholder={"МОЛОКО 930 МЛ  1 x 89,90\nХЛЕБ 400Г  1 x 54,50"} aria-label="Текст чека" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 14 }} />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn" disabled={!text.trim()} onClick={toReview}>Разобрать</button>
          {!text.trim() && <button className="btn sec" onClick={async () => { try { setText(await navigator.clipboard.readText()); } catch { setErr("Не удалось вставить автоматически — нажмите в поле и выберите «Вставить»."); } }}>📋 Вставить из буфера</button>}
          {file.current && (
            <button className="btn ghost" onClick={() => { const r = (((rot + 90) % 360) as 0 | 90 | 180 | 270); setRot(r); run(file.current!, r); }}>↻ Повернуть фото и прочитать заново</button>
          )}
          {file.current && <button className="link" onClick={() => { file.current = null; setText(""); setStage("start"); }}>Сфотографировать заново</button>}
        </>
      )}

      {stage === "review" && (
        <>
          <h2 style={{ marginTop: 10 }}>Проверьте продукты</h2>
          <p className="muted mt0">Исправьте название, количество и цену, если нужно. Уберите галочку у лишнего. Место и срок подставятся из справочника.</p>
          {rows.map((r) => {
            const banned = r.on ? checkProduct(r.name, compiled, who) : null;
            return (
              <div key={r.id} className={"card rv" + (bad(r) ? " rv-bad" : "")} style={{ background: "var(--card2)", boxShadow: "none", opacity: r.on ? 1 : 0.5 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" className="chk" checked={r.on} onChange={(e: any) => upd(r.id, { on: e.target.checked })} aria-label={"Добавить: " + r.name} />
                  <input className="inp" value={r.name} onChange={(e: any) => upd(r.id, { name: e.target.value })} aria-label="Название" />
                </div>
                <div className="muted small" style={{ margin: "4px 0 6px 34px" }}>{[
                  r.raw !== r.name && `в чеке: ${r.raw}`,
                  r.nonFood ? "похоже, не продукт — не добавляю" : !r.known ? "не знаю такой продукт" : r.kind && r.kind !== r.name && `продукт: ${r.kind}`,
                ].filter(Boolean).join(" · ")}</div>
                <div className="field-row">
                  <div style={{ flex: 2 }}><input className="inp" inputMode="decimal" value={r.qtyS} onChange={(e: any) => upd(r.id, { qtyS: e.target.value })} aria-label="Сколько" /></div>
                  <div style={{ flex: 2 }}>
                    <select className="inp" value={r.unit} onChange={(e: any) => upd(r.id, { unit: e.target.value as Unit })} aria-label="Единица">{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</select>
                  </div>
                  <div style={{ flex: 3 }}><input className="inp" inputMode="decimal" value={r.priceS} onChange={(e: any) => upd(r.id, { priceS: e.target.value })} aria-label="Цена, ₽" /></div>
                </div>
                {banned && <div className="issue small">⚠️ «{banned.rule.title}» у вас в исключениях.</div>}
              </div>
            );
          })}
          <div className="card" style={{ background: "var(--card2)", boxShadow: "none" }}>
            <div className="ing"><span>В списке: {active.length} {plural(active.length, "продукт", "продукта", "продуктов")}</span><span className="a"><b>{rub(sum)}</b></span></div>
            {receiptTotal !== null && <div className="ing"><span>Итого по чеку</span><span className={"a" + (Math.abs(receiptTotal - allSum) > 1 ? " t-bad" : " t-ok")}>{rub(receiptTotal)}{Math.abs(receiptTotal - allSum) > 1 ? " — не сходится, проверьте цены" : " ✓"}</span></div>}
          </div>
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn" disabled={!active.length} onClick={save}>Сохранить в продукты</button>
          <button className="btn ghost" onClick={() => setStage(claudeTotal !== null || answer.trim() ? "claude" : "text")}>{answer.trim() ? "← К ответу Claude" : "← К тексту"}</button>
        </>
      )}
    </Sheet>
  );
}
