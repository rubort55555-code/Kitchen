// Экран «Ещё»: семья, ограничения, справочник, данные, справка, «Что-то не работает».
import { useEffect, useMemo, useState } from "react";
import { Chevron, Header, Seg, Sheet } from "../components/ui";
import { defaultSettings, getState, makeBackup, markBackup, restore, setSettings, useStore, type Backup } from "../lib/store";
import { allCatalog, FISH_TYPE_TEXT, shelfDays } from "../lib/catalog";
import { DEFAULT_RULES, newRule } from "../lib/exclusions";
import { parseBackupText, type Parsed } from "../lib/importOld";
import { makeDemo } from "../lib/demo";
import { FAQ, SCREEN_HELP, SECTIONS, searchHelp, type HelpSection, type Screen } from "../lib/help";
import type { CatalogItem, FishType, Level, Member, Place, Rule, Unit } from "../lib/types";
import { PLACES, UNITS } from "../lib/types";
import { norm, plural, ymd } from "../lib/util";
import { Stats } from "./Stats";
import { closeAll, closeSheet, goPage, goTab, toast, useUI } from "../lib/ui";

export const VERSION = typeof __VERSION__ !== "undefined" ? __VERSION__ : "dev";

export function More() {
  const page = useUI((u) => u.page);
  switch (page) {
    case "stats": return <Stats />;
    case "family": return <Family />;
    case "rules": return <Rules />;
    case "catalog": return <Catalog />;
    case "data": return <Data />;
    case "help": return <HelpPage />;
    case "bug": return <Bug />;
    case "about": return <About />;
    default: return <Menu />;
  }
}

function Row({ icon, title, sub, onClick }: { icon: string; title: string; sub?: string; onClick: () => void }) {
  return (
    <button className="li" onClick={onClick}>
      <span className="ico">{icon}</span>
      <div className="main"><div className="name">{title}</div>{sub && <div className="meta">{sub}</div>}</div>
      <span className="chev"><Chevron /></span>
    </button>
  );
}

function Menu() {
  const s = useStore((x) => x.settings);
  const days = s.lastBackup ? Math.floor((Date.now() - s.lastBackup) / 86400000) : null;
  return (
    <div className="screen">
      <Header title="Ещё" screen="more" />
      <div className="list">
        <Row icon="📊" title="Статистика" sub="Съедено, пропало, осталось — в рублях" onClick={() => goPage("stats")} />
      </div>
      <div className="list">
        <Row icon="👨‍👩" title="Семья" sub={s.members.map((m) => m.name).join(", ")} onClick={() => goPage("family")} />
        <Row icon="🚫" title="Ограничения в питании" sub={s.rules.filter((r) => r.level !== "ok").map((r) => r.title).join(", ")} onClick={() => goPage("rules")} />
        <Row icon="📚" title="Справочник продуктов" sub="Сроки хранения, типы рыбы" onClick={() => goPage("catalog")} />
      </div>
      <div className="list">
        <Row icon="💾" title="Данные и копия" sub={days === null ? "Копию ещё не сохраняли" : days === 0 ? "Копия сохранена сегодня" : `Копия: ${days} ${plural(days, "день", "дня", "дней")} назад`} onClick={() => goPage("data")} />
      </div>
      <div className="list">
        <Row icon="❓" title="Помощь" sub="Справка и частые вопросы" onClick={() => goPage("help")} />
        <Row icon="🛠" title="Что-то не работает" onClick={() => goPage("bug")} />
        <Row icon="ℹ️" title="О приложении" sub={"Версия " + VERSION} onClick={() => goPage("about")} />
      </div>
    </div>
  );
}

const back = () => goPage(null);
const splitList = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);

// ---------- Семья ----------
function Family() {
  const members = useStore((s) => s.settings.members);
  const upd = (i: number, patch: Partial<Member>) => setSettings({ members: members.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  return (
    <div className="screen">
      <Header title="Семья" screen="family" onBack={back} backText="Ещё" />
      <p className="muted mt0">Порции считаются на всех. В «Спросить Claude» можно выбрать «только я» или «только второй».</p>
      {members.map((m, i) => (
        <div className="card" key={m.id}>
          <label className="f mt0" htmlFor={"mn" + i}>Имя</label>
          <input id={"mn" + i} className="inp" style={{ background: "var(--card2)" }} defaultValue={m.name} onBlur={(e: any) => upd(i, { name: e.target.value.trim() || m.name })} />
          <label className="f" htmlFor={"ma" + i}>Аллергия (через запятую)</label>
          <input id={"ma" + i} className="inp" style={{ background: "var(--card2)" }} defaultValue={m.allergies.join(", ")} placeholder="Например: арахис, киви" onBlur={(e: any) => upd(i, { allergies: splitList(e.target.value) })} />
          <label className="f" htmlFor={"md" + i}>Не любит</label>
          <input id={"md" + i} className="inp" style={{ background: "var(--card2)" }} defaultValue={m.dislikes.join(", ")} placeholder="Например: грибы, оливки" onBlur={(e: any) => upd(i, { dislikes: splitList(e.target.value) })} />
        </div>
      ))}
      <p className="muted small">Изменения сохраняются, когда вы выходите из поля.</p>
    </div>
  );
}

// ---------- Ограничения ----------
const LEVELS: { v: Level; t: string }[] = [{ v: "never", t: "Никогда" }, { v: "little", t: "Немного" }, { v: "ok", t: "Можно" }];
function Rules() {
  const s = useStore((x) => x.settings);
  const [editing, setEditing] = useState<string | null>(null);
  const setRule = (r: Rule) => setSettings({ rules: s.rules.map((x) => (x.id === r.id ? r : x)) });
  return (
    <div className="screen">
      <Header title="Ограничения" screen="rules" onBack={back} backText="Ещё" />
      <p className="muted mt0">Рецепты с «никогда» не предлагаются. Рыбу можно заменить — приложение подскажет чем.</p>
      <div className="list">
        {s.rules.map((r) => (
          <button key={r.id} className="li" onClick={() => setEditing(r.id)}>
            <span className="ico">{r.level === "never" ? "🚫" : r.level === "little" ? "🤏" : "✅"}</span>
            <div className="main">
              <div className="name">{r.title}</div>
              <div className="meta">{LEVELS.find((l) => l.v === r.level)!.t}{r.level === "little" ? `, до ${r.limitTbsp ?? 2} ст. л.` : ""}{r.except?.length && r.fishType ? ` · кроме: ${r.except.join(", ")}` : ""} · {r.who === "all" ? "для всех" : s.members.find((m) => m.id === r.who)?.name}</div>
            </div>
            <span className="chev"><Chevron /></span>
          </button>
        ))}
      </div>
      <button className="btn sec" onClick={() => { const r = newRule(); setSettings({ rules: [...s.rules, r] }); setEditing(r.id); }}>Добавить ограничение</button>
      <h2>Базовые продукты</h2>
      <p className="muted mt0">Они всегда есть дома и не считаются недостающими в рецептах.</p>
      <textarea className="inp" style={{ minHeight: 80 }} defaultValue={s.basics.join(", ")} onBlur={(e: any) => setSettings({ basics: splitList(e.target.value) })} aria-label="Базовые продукты" />
      <button className="link" onClick={() => { setSettings({ rules: defaultSettings().rules }); toast("Ограничения сброшены к начальным"); }}>Вернуть начальные ограничения</button>
      {editing && (() => { const r = s.rules.find((x) => x.id === editing); return r ? <RuleSheet rule={r} members={s.members} onSave={setRule} onDelete={() => { setSettings({ rules: s.rules.filter((x) => x.id !== r.id) }); setEditing(null); }} onClose={() => setEditing(null)} /> : null; })()}
    </div>
  );
}

function RuleSheet({ rule, members, onSave, onDelete, onClose }: { rule: Rule; members: Member[]; onSave: (r: Rule) => void; onDelete: () => void; onClose: () => void }) {
  const [r, setR] = useState<Rule>(rule);
  const [words, setWords] = useState(rule.words.join(", "));
  const [except, setExcept] = useState((rule.except || []).join(", "));
  const isDefault = DEFAULT_RULES.some((d) => d.id === rule.id);
  const save = () => { onSave({ ...r, title: r.title.trim() || "Без названия", words: splitList(words), except: splitList(except) }); onClose(); toast("Сохранено"); };
  return (
    <Sheet title="Ограничение" onClose={onClose} left={<button className="x l" onClick={onClose}>Отмена</button>} right={<button className="x" onClick={save}>Сохранить</button>}>
      <label className="f" htmlFor="rt">Название</label>
      <input id="rt" className="inp" value={r.title} onChange={(e: any) => setR({ ...r, title: e.target.value })} />
      <label className="f">Уровень</label>
      <Seg label="Уровень" value={r.level} onChange={(level) => setR({ ...r, level })} options={LEVELS} />
      {r.level === "little" && (
        <>
          <label className="f" htmlFor="rl">Сколько можно на всё блюдо, ст. л.</label>
          <input id="rl" className="inp" inputMode="decimal" value={String(r.limitTbsp ?? 2)} onChange={(e: any) => setR({ ...r, limitTbsp: Number(String(e.target.value).replace(",", ".")) || 0 })} />
        </>
      )}
      <label className="f">Для кого</label>
      <Seg label="Для кого" value={r.who} onChange={(who) => setR({ ...r, who })} options={[{ v: "all", t: "Для всех" }, ...members.map((m) => ({ v: m.id, t: m.name }))]} />
      <label className="f" htmlFor="rw">Слова в рецептах (через запятую, можно начало слова)</label>
      <textarea id="rw" className="inp" value={words} onChange={(e: any) => setWords(e.target.value)} />
      {r.fishType && <p className="muted small">Плюс вся рыба с типом «{FISH_TYPE_TEXT[r.fishType]}» из справочника.</p>}
      <label className="f" htmlFor="re">Кроме (это можно)</label>
      <input id="re" className="inp" value={except} onChange={(e: any) => setExcept(e.target.value)} placeholder="Например: камбала, минтай" />
      <label className="f" htmlFor="rr">Чем заменить (подсказка в рецептах)</label>
      <input id="rr" className="inp" value={r.replace || ""} onChange={(e: any) => setR({ ...r, replace: e.target.value.trim() || undefined })} placeholder="Например: минтай" />
      <button className="btn" style={{ marginTop: 18 }} onClick={save}>Сохранить</button>
      {!isDefault && <button className="btn danger" onClick={onDelete}>Удалить ограничение</button>}
    </Sheet>
  );
}

// ---------- Справочник ----------
function Catalog() {
  const custom = useStore((s) => s.settings.customCatalog);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useMemo(() => allCatalog(custom).filter((c) => !q || norm(c.n).includes(norm(q)) || (c.s || []).some((x) => norm(x).includes(norm(q)))), [custom, q]);
  const fmt = (d: number | null) => (d === null ? "—" : d === 0 ? "∞" : d >= 60 ? `${Math.round(d / 30)} мес` : `${d} дн`);
  return (
    <div className="screen">
      <Header title="Справочник" screen="catalog" onBack={back} backText="Ещё" sub={`${list.length} продуктов · холодильник / морозилка / шкаф`} />
      <input className="inp search" type="search" placeholder="Поиск" value={q} onChange={(e: any) => setQ(e.target.value)} aria-label="Поиск в справочнике" />
      <button className="btn sec" onClick={() => setAdding(true)}>Добавить свой продукт</button>
      <div className="list" style={{ marginTop: 12 }}>
        {list.slice(0, 200).map((c) => (
          <div key={c.n} className="li">
            <span className="ico">{c.e}</span>
            <div className="main">
              <div className="name">{c.n}{c.custom ? " · свой" : ""}</div>
              <div className="meta">{c.c}{c.f ? ` · рыба ${FISH_TYPE_TEXT[c.f]}` : ""}{c.o ? ` · после вскрытия ${c.o} дн` : ""}</div>
            </div>
            <div className="end small">{PLACES.map((p) => fmt(shelfDays(c, p) ?? null)).join(" / ")}</div>
          </div>
        ))}
      </div>
      {adding && <CatalogSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

function CatalogSheet({ onClose }: { onClose: () => void }) {
  const custom = useStore((s) => s.settings.customCatalog);
  const [n, setN] = useState("");
  const [u, setU] = useState<Unit>("шт");
  const [p, setP] = useState<Place>("Холодильник");
  const [d, setD] = useState(["5", "90", ""]);
  const [fish, setFish] = useState<"" | FishType>("");
  const [err, setErr] = useState("");
  const save = () => {
    if (!n.trim()) return setErr("Напишите название.");
    const num = (x: string): number | null => (x.trim() === "" ? null : Math.max(0, Math.round(Number(x.replace(",", ".")) || 0)));
    const it: CatalogItem = { n: n.trim(), c: fish ? "Рыба" : "Свои", e: fish ? "🐟" : "🛒", u, p, d: [num(d[0]), num(d[1]), num(d[2])], custom: true };
    if (fish) it.f = fish;
    setSettings({ customCatalog: [...custom.filter((x) => norm(x.n) !== norm(it.n)), it] });
    toast(`Добавлено в справочник: ${it.n}`);
    onClose();
  };
  return (
    <Sheet title="Свой продукт" onClose={onClose} left={<button className="x l" onClick={onClose}>Отмена</button>} right={<button className="x" onClick={save}>Сохранить</button>}>
      <label className="f" htmlFor="cn">Название</label>
      <input id="cn" className="inp" value={n} onChange={(e: any) => setN(e.target.value)} />
      <label className="f">Единица</label>
      <Seg label="Единица" value={u} onChange={setU} options={UNITS.map((x) => ({ v: x, t: x }))} />
      <label className="f">Где обычно хранится</label>
      <Seg label="Место" value={p} onChange={setP} options={PLACES.map((x) => ({ v: x, t: x }))} />
      <label className="f">Срок, дней: холодильник / морозилка / шкаф (пусто — так не хранят, 0 — без срока)</label>
      <div className="row2">
        {d.map((v, i) => <input key={i} className="inp" inputMode="numeric" value={v} aria-label={PLACES[i]} onChange={(e: any) => setD(d.map((x, k) => (k === i ? e.target.value : x)))} />)}
      </div>
      <label className="f">Если это рыба — какая</label>
      <Seg label="Тип рыбы" value={fish} onChange={setFish} options={[{ v: "", t: "Не рыба" }, { v: "white_sea", t: "Белая морск." }, { v: "red", t: "Красная" }, { v: "river", t: "Речная" }]} />
      {fish === "white_sea" && <p className="muted small">Белая морская рыба у вас под запретом — эту рыбу приложение тоже не будет предлагать.</p>}
      {err && <p className="err">{err}</p>}
      <button className="btn" style={{ marginTop: 18 }} onClick={save}>Сохранить</button>
    </Sheet>
  );
}

// ---------- Данные ----------
function Data() {
  const st = useStore((s) => s);
  const [pending, setPending] = useState<Parsed | null>(null);
  const [oldText, setOldText] = useState("");
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<null | "demo" | "wipe">(null);

  async function saveBackup() {
    const text = JSON.stringify(makeBackup());
    const name = `kitchen-${ymd()}.json`;
    const file = new File([text], name, { type: "application/json" });
    try {
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Кухня — копия данных" });
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      markBackup();
      setMsg(`Копия готова (${Math.max(1, Math.round(text.length / 1024))} КБ). Сохраните файл в «Файлы» → iCloud Drive.`);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") { setMsg("Копия не сохранена — вы закрыли окно."); return; }
      try { await navigator.clipboard.writeText(text); markBackup(); setMsg("Не получилось сохранить файл, поэтому копия скопирована как текст. Вставьте её в Заметки."); }
      catch { setMsg("Не получилось сохранить копию. Напишите в «Что-то не работает»."); }
    }
  }

  async function saveCsv(kind: "products" | "log" | "prices") {
    const { productsCsv, logCsv, pricesCsv } = await import("../lib/csv");
    const s = getState();
    const text = kind === "products" ? productsCsv(s.products) : kind === "log" ? logCsv(s.log) : pricesCsv(s.log);
    const name = `kitchen-${kind === "products" ? "produkty" : kind === "log" ? "zhurnal" : "tseny"}-${ymd()}.csv`;
    const file = new File([text], name, { type: "text/csv" });
    try {
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) await navigator.share({ files: [file], title: "Кухня — таблица" });
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      setMsg("Таблица готова. Сохраните её в «Файлы» — откроется в Numbers или Excel.");
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setMsg("Не получилось сохранить таблицу.");
    }
  }

  async function readFile(e: any) {
    const f: File | undefined = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    check(await f.text());
  }
  function check(text: string) {
    const p = parseBackupText(text, getState().settings);
    if (!p) { setMsg("Это не похоже на копию данных. Нужен файл или текст копии целиком."); setPending(null); return; }
    setPending(p); setMsg("");
  }
  async function doRestore(mode: "replace" | "merge") {
    if (!pending) return;
    await restore(pending.backup, mode);
    const b = pending.backup;
    setPending(null); setOldText("");
    toast(mode === "replace" ? "Данные восстановлены" : "Данные добавлены");
    setMsg(`Готово: ${b.products.length} продуктов, ${b.recipes.length} рецептов, ${b.log.length} записей журнала.`);
  }
  async function demo() {
    await restore(makeDemo(), "replace");
    setConfirm(null); toast("Демо-данные загружены"); goTab("home");
  }
  async function wipe() {
    const b: Backup = { app: "kitchen-app", v: 1, at: "", products: [], log: [], recipes: [], settings: defaultSettings() };
    await restore(b, "replace");
    setConfirm(null); toast("Все данные удалены");
  }
  const has = st.products.length + st.log.length + st.recipes.length > 0;

  return (
    <div className="screen">
      <Header title="Данные" screen="data" onBack={back} backText="Ещё" />
      <div className="card">
        <h3>Копия данных</h3>
        <p className="muted small mt0">Все данные хранятся только в этом телефоне. Сохраняйте копию раз в неделю — Safari может стереть данные сайтов.</p>
        <button className="btn" onClick={saveBackup}>Сохранить копию</button>
        <label className="btn ghost" style={{ marginTop: 10 }}>
          Восстановить из файла
          <input type="file" accept=".json,application/json,text/plain" onChange={readFile} hidden />
        </label>
        {msg && <p className="small" role="status">{msg}</p>}
      </div>
      <div className="card">
        <h3>Таблицы (CSV)</h3>
        <p className="muted small mt0">Для Numbers или Excel. Это не копия данных — восстановить из неё нельзя.</p>
        <div className="row2">
          <button className="btn sec" onClick={() => saveCsv("products")}>Продукты</button>
          <button className="btn sec" onClick={() => saveCsv("log")}>Журнал</button>
        </div>
        <button className="btn sec" onClick={() => saveCsv("prices")}>Цены покупок</button>
      </div>
      {pending && (
        <div className="card">
          <h3>{pending.kind === "old" ? "Нашёл данные из «Что приготовить»" : "Нашёл копию"}</h3>
          <p className="small mt0">{pending.backup.products.length} продуктов, {pending.backup.recipes.length} рецептов, {pending.backup.log.length} записей журнала{pending.backup.at ? `, от ${new Date(pending.backup.at).toLocaleDateString("ru-RU")}` : ""}.</p>
          <button className="btn" onClick={() => doRestore("merge")}>Добавить к текущим</button>
          <button className="btn danger" onClick={() => doRestore("replace")}>Заменить всё</button>
          <button className="link" onClick={() => setPending(null)}>Отмена</button>
        </div>
      )}
      <div className="card">
        <h3>Перенести из «Что приготовить»</h3>
        <p className="muted small mt0">На старой странице нажмите «Скопировать копию данных» и вставьте текст сюда (или выберите файл копии кнопкой выше).</p>
        <textarea className="inp" style={{ background: "var(--card2)", minHeight: 90 }} value={oldText} onChange={(e: any) => setOldText(e.target.value)} placeholder="Вставьте копию данных" aria-label="Копия из «Что приготовить»" />
        <button className="btn sec" style={{ marginTop: 10 }} disabled={!oldText.trim()} onClick={() => check(oldText)}>Проверить</button>
      </div>
      <div className="card">
        <h3>Для проверки</h3>
        <p className="muted small mt0">Демо: 14 продуктов с ценами, 3 месяца покупок, готовки и потерь, и 5 рецептов — среди них треска, холодец и козинаки из семечек, чтобы проверить ограничения.</p>
        {confirm === "demo" ? (
          <div className="row2"><button className="btn danger" onClick={demo}>Заменить мои данные</button><button className="btn ghost" onClick={() => setConfirm(null)}>Отмена</button></div>
        ) : (
          <button className="btn sec" onClick={() => (has ? setConfirm("demo") : demo())}>Заполнить демо-данными</button>
        )}
        {confirm === "wipe" ? (
          <div className="row2" style={{ marginTop: 10 }}><button className="btn danger" onClick={wipe}>Да, удалить всё</button><button className="btn ghost" onClick={() => setConfirm(null)}>Отмена</button></div>
        ) : (
          <button className="link" style={{ color: "var(--bad)", display: "block", marginTop: 8 }} onClick={() => setConfirm("wipe")} disabled={!has}>Удалить все данные</button>
        )}
      </div>
    </div>
  );
}

// ---------- Справка ----------
function SectionView({ s, open }: { s: HelpSection; open?: boolean }) {
  return (
    <details className="sect" open={open} id={"h-" + s.id}>
      <summary>{s.title}</summary>
      <div className="body">{s.text.map((t, i) => <p key={i}>{t}</p>)}</div>
    </details>
  );
}

function HelpPage() {
  const [q, setQ] = useState("");
  const found = searchHelp(q);
  return (
    <div className="screen">
      <Header title="Помощь" screen="help" onBack={back} backText="Ещё" />
      <input className="inp search" type="search" placeholder="Например: как удалить продукт" value={q} onChange={(e: any) => setQ(e.target.value)} aria-label="Поиск по справке" />
      {q.trim() ? (
        found.length ? found.map((s, i) => <SectionView key={s.id} s={s} open={i === 0} />) : <p className="muted">Ничего не нашлось. Попробуйте другие слова или откройте «Что-то не работает».</p>
      ) : (
        <>
          {SECTIONS.map((s) => <SectionView key={s.id} s={s} />)}
          <h2>Частые вопросы</h2>
          {FAQ.map((s) => <SectionView key={s.id} s={s} />)}
        </>
      )}
    </div>
  );
}

/** Короткая справка по текущему экрану (значок «?»). */
export function HelpSheet({ screen }: { screen: Screen }) {
  const h = SCREEN_HELP[screen];
  const sec = h.more ? SECTIONS.concat(FAQ).find((s) => s.id === h.more) : undefined;
  return (
    <Sheet title={h.title} short>
      <ul className="help-lines">{h.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
      {sec && <SectionView s={sec} />}
      <button className="btn sec" style={{ marginTop: 12 }} onClick={() => { closeAll(); goPage("help"); }}>Вся справка и частые вопросы</button>
    </Sheet>
  );
}

// ---------- Что-то не работает ----------
function iosVersion(): string {
  const m = navigator.userAgent.match(/OS (\d+)_(\d+)(?:_(\d+))? like Mac OS X/);
  return m ? `iOS ${m[1]}.${m[2]}${m[3] ? "." + m[3] : ""}` : "не iOS";
}
function Bug() {
  const st = useStore((s) => s);
  const [what, setWhat] = useState("");
  const [done, setDone] = useState("");
  const report = () => {
    let last = "нет";
    try { const e = JSON.parse(localStorage.getItem("kitchen-last-error") || "null"); if (e) last = `${e.msg} (${e.t})`; } catch { /* пусто */ }
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || matchMedia("(display-mode: standalone)").matches;
    return [
      "Кухня — сообщение о проблеме",
      `Что делал(а): ${what.trim() || "(не описано)"}`,
      `Версия приложения: ${VERSION}`,
      `Система: ${iosVersion()}`,
      `Браузер: ${navigator.userAgent}`,
      `Открыто с экрана «Домой»: ${standalone ? "да" : "нет"}`,
      `Данные: ${st.products.length} продуктов, ${st.log.length} записей, ${st.recipes.length} рецептов`,
      `Последняя ошибка: ${last}`,
    ].join("\n");
  };
  return (
    <div className="screen">
      <Header title="Что-то не работает" screen="more" onBack={back} backText="Ещё" />
      <p className="muted mt0">Опишите, что делали и что пошло не так. Нажмите «Скопировать» и вставьте текст в чат с Claude — так проблему найдут быстрее.</p>
      <textarea className="inp" value={what} onChange={(e: any) => setWhat(e.target.value)} placeholder="Например: нажал «Добавить», а продукт не появился" aria-label="Что случилось" />
      <button className="btn" style={{ marginTop: 12 }} onClick={async () => { try { await navigator.clipboard.writeText(report()); setDone("Скопировано. Вставьте в чат с Claude."); } catch { setDone("Не удалось скопировать — выделите текст ниже вручную."); } }}>Скопировать</button>
      {done && <p className="small" role="status">{done}</p>}
      <details className="prompt"><summary>Что будет отправлено</summary><pre>{report()}</pre></details>
    </div>
  );
}

function About() {
  const [info, setInfo] = useState<string>("");
  useEffect(() => {
    (async () => {
      const p = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
      const e = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      setInfo(`Защита данных от очистки: ${p === null ? "не поддерживается" : p ? "включена" : "не включена (установите на экран «Домой»)"}` + (e?.usage ? `. Занято: ${Math.round(e.usage / 1024)} КБ` : ""));
    })();
  }, []);
  return (
    <div className="screen">
      <Header title="О приложении" screen="more" onBack={back} backText="Ещё" />
      <div className="list">
        <div className="kv"><span>Версия</span><span>{VERSION}</span></div>
        <div className="kv"><span>Где данные</span><span>только в этом телефоне</span></div>
      </div>
      <p className="muted small">{info}</p>
      <p className="muted small">Бесплатно, без регистрации и рекламы. Работает без интернета.</p>
      <button className="btn sec" onClick={() => { closeSheet(); location.reload(); }}>Перезапустить приложение</button>
    </div>
  );
}
