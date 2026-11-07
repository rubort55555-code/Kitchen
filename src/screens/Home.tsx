// Главная «Сад»: подсказка по-человечески, сводка, что съесть первым, меню, что приготовить, потери за месяц.
import { useMemo } from "react";
import { Header, Icon, Tip } from "../components/ui";
import { entriesFor } from "../lib/plan";
import { SLOTS } from "../lib/types";
import { cap, ymd } from "../lib/util";
import { useStore, valueOf } from "../lib/store";
import { findCatalog } from "../lib/catalog";
import { compileRules, checkRecipe } from "../lib/exclusions";
import { recipeStatus } from "../lib/match";
import { monthStart, summary } from "../lib/stats";
import { needsBasics } from "../lib/nutrition";
import { daysLeft, freshness, plural, rub, untilText } from "../lib/util";
import { qtyText } from "../lib/units";
import { goMenu, goPage, goTab, openSheet } from "../lib/ui";

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

export function Home() {
  const { products, log, recipes, settings, saveError } = useStore((s) => s);
  const urgent = useMemo(() => products.filter((p) => { const d = daysLeft(p.until); return d !== null && d <= 2; })
    .sort((a, b) => (daysLeft(a.until) ?? 0) - (daysLeft(b.until) ?? 0)), [products]);
  const m = useMemo(() => summary(log, monthStart()), [log]);
  const total = products.reduce((s, p) => s + valueOf(p), 0);
  const cookable = useMemo(() => {
    const compiled = compileRules(settings.rules, settings.customCatalog, settings.members);
    const who = settings.members.map((x) => x.id);
    return recipes
      .filter((r) => checkRecipe(r, compiled, who).verdict !== "hidden")
      .map((r) => ({ r, st: recipeStatus(r, products, settings.basics, settings.customCatalog) }))
      .filter((x) => x.st.percent >= 60)
      .sort((a, b) => b.st.urgent - a.st.urgent || b.st.percent - a.st.percent)
      .slice(0, 3);
  }, [recipes, products, settings]);
  const expired = useMemo(() => products.filter((p) => { const d = daysLeft(p.until); return d !== null && d < 0; }).length, [products]);
  const needRevision = products.length >= 5 && (!settings.lastRevision || (Date.now() - new Date(settings.lastRevision).getTime()) / 86400000 >= 14);
  const backupDays = settings.lastBackup ? Math.floor((Date.now() - settings.lastBackup) / 86400000) : null;
  const needBackup = (products.length > 0 || log.length > 0) && (backupDays === null || backupDays >= 7);
  const today = new Date();
  const todayMenu = entriesFor(ymd(), settings.plan || []).filter((e) => SLOTS.includes(e.slot));
  const shopOpen = (settings.shop || []).filter((x) => !x.done).length;

  const counts = useMemo(() => {
    let bad = 0, soon = 0;
    for (const p of products) { const f = freshness(p.until); if (f === "bad") bad++; else if (f === "soon") soon++; }
    return { bad, soon, ok: products.length - bad - soon };
  }, [products]);
  const hint = useMemo(() => homeHint(urgent.map((p) => p.name), cookable), [urgent, cookable]);
  return (
    <div className="screen">
      <Header title={greeting(today)} screen="home" sub={cap(today.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }))}
        extra={<button className="helpbtn" aria-label="Ещё: семья, ограничения, данные" onClick={() => goPage(null)} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Icon.gear /></button>} />
      <Tip id="home-gear">Значок ⚙︎ справа вверху — статистика, семья, ограничения в питании, оформление и копия данных.</Tip>
      {saveError && <div className="banner bad"><span className="txt">{saveError}</span></div>}

      {products.length === 0 ? (
        <div className="card empty">
          <div className="big">🥕</div>
          <p>Добавьте продукты из холодильника — и я подскажу, что приготовить.</p>
          <button className="btn" onClick={() => openSheet({ kind: "add" })}>Добавить продукт</button>
          <button className="link" onClick={() => goPage("data")}>Перенести данные из «Что приготовить»</button>
        </div>
      ) : (
        <>
          {hint && (
            <button className="greet" onClick={() => (hint.recipeId ? openSheet({ kind: "recipe", id: hint.recipeId }) : hint.ask ? openSheet({ kind: "ask" }) : goMenu())}>
              <span className="em">{hint.emoji}</span>
              <span className="tx"><b>{hint.title}</b>{hint.sub && <small>{hint.sub}</small>}</span>
              {hint.action && <span className="go">{hint.action}</span>}
            </button>
          )}
          <button className="home-hero" onClick={() => goPage("stats")}>
            <div className="t">Дома сейчас</div>
            <div className="big">{rub(total)}</div>
            <div className="s">{products.length} {plural(products.length, "продукт", "продукта", "продуктов")} · {m.lost > 0 ? `пропало за ${MONTHS[today.getMonth()]} ${rub(m.lost)}` : `за ${MONTHS[today.getMonth()]} ничего не пропало`}</div>
            <div className="line">
              {counts.bad > 0 && <i style={{ flex: counts.bad, background: "#F08A5D" }} />}
              {counts.soon > 0 && <i style={{ flex: counts.soon, background: "#F2C14E" }} />}
              {counts.ok > 0 && <i style={{ flex: counts.ok, background: "#8FD1A6" }} />}
            </div>
            <div className="lg">
              {counts.bad > 0 && <span><i style={{ background: "#F08A5D" }} />просрочено {counts.bad}</span>}
              {counts.soon > 0 && <span><i style={{ background: "#F2C14E" }} />скоро {counts.soon}</span>}
              <span><i style={{ background: "#8FD1A6" }} />свежее {counts.ok}</span>
            </div>
          </button>
        </>
      )}

      {needBackup && (
        <div className="banner warn">
          <span className="txt">{backupDays === null ? "Вы ещё не сохраняли копию данных." : `Копии данных ${backupDays} ${plural(backupDays, "день", "дня", "дней")}.`} Сохраните её — Safari иногда стирает данные.</span>
          <button className="chip" onClick={() => goPage("data")}>Сохранить</button>
        </div>
      )}
      {settings.members.some((m) => needsBasics(m.body)) && (
        <div className="banner warn">
          <span className="txt">Заполните данные семьи: пол, год рождения, рост и вес каждого — без них не посчитать ИМТ и нормы питания.</span>
          <button className="chip" onClick={() => goPage("family")}>Заполнить</button>
        </div>
      )}
      {needRevision && (
        <div className="banner">
          <span className="txt">{settings.lastRevision ? "С последней ревизии прошло больше двух недель." : "Сделайте ревизию: пройдитесь по продуктам и поправьте остатки."}</span>
          <button className="chip" onClick={() => openSheet({ kind: "revision" })}>Начать</button>
        </div>
      )}

      {urgent.length > 0 && (
        <>
          <div className="sec-h"><b>Съесть первым</b><button className="link" onClick={() => goTab("products")}>Все →</button></div>
          <div className="hs">
            {urgent.slice(0, 12).map((p) => {
              const fr = freshness(p.until);
              return (
                <button key={p.id} className="pc" onClick={() => openSheet({ kind: "product", id: p.id })}>
                  <span className={"em " + fr}>{findCatalog(p.name, settings.customCatalog)?.e || "🛒"}</span>
                  <span className="n">{p.name}</span>
                  <span className="q">{qtyText(p.qty, p.unit)} · {rub(valueOf(p))}</span>
                  <span className={"st " + fr}>{untilText(p.until)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {expired > 0 && (
        <button className="btn danger" style={{ marginTop: 12 }} onClick={() => openSheet({ kind: "overdue" })}>Просрочено: {expired} — что с ними?</button>
      )}

      <div className="sec-h"><b>Сегодня в меню</b><button className="link" onClick={goMenu}>Неделя →</button></div>
      {todayMenu.length ? (
        todayMenu.map((e) => (
          <button key={e.id} className={"dish" + (e.done ? " done" : "")} onClick={() => (e.recipeId && recipes.some((r) => r.id === e.recipeId) ? openSheet({ kind: "recipe", id: e.recipeId }) : goMenu())}>
            <span className="ph">{SLOT_EMOJI[e.slot] || "🍽️"}</span>
            <span className="main"><span className="name" style={{ display: "block" }}>{e.name}</span><span className="meta" style={{ display: "block" }}>{cap(e.slot)}</span></span>
          </button>
        ))
      ) : (
        <button className="dish" onClick={goMenu}>
          <span className="ph">🗓️</span>
          <span className="main"><span className="name" style={{ display: "block" }}>На сегодня ничего не запланировано</span><span className="meta" style={{ display: "block", color: "var(--accent)" }}>Составить меню на неделю</span></span>
        </button>
      )}
      {shopOpen > 0 && <button className="btn ghost" style={{ marginTop: 4 }} onClick={() => goTab("shop")}>🛒 В списке покупок: {shopOpen}</button>}

      <div className="sec-h"><b>Что приготовить</b></div>
      {cookable.length > 0 ? (
        cookable.map(({ r, st }) => (
          <button key={r.id} className="dish" onClick={() => openSheet({ kind: "recipe", id: r.id })}>
            <Ring pct={st.percent} />
            <span className="main"><span className="name" style={{ display: "block" }}>{r.name}</span><span className="meta" style={{ display: "block" }}>{st.missing.length ? `не хватает: ${st.missing.map((x) => x.name.toLowerCase()).join(", ")}` : "всё есть дома"}{st.urgent ? " · спасёт продукты" : ""}</span></span>
          </button>
        ))
      ) : (
        <p className="muted mt0">{products.length ? "Спросите Claude — он подберёт блюда из того, что есть, с учётом ваших ограничений." : "Когда добавите продукты, здесь появятся блюда из них."}</p>
      )}
      <button className="btn" style={{ marginTop: 4 }} onClick={() => openSheet({ kind: "ask" })}>✨ Спросить Claude</button>

      <div className="card" style={{ marginTop: 22 }}>
        <h3>Пропало за {MONTHS[today.getMonth()]} <button className="link small" style={{ padding: 0 }} onClick={() => goPage("stats")}>Подробнее ›</button></h3>
        <div className={"hero" + (m.lost > 0 ? " bad" : "")}>
          <b>{rub(m.lost)}</b>
          <span className="muted">{m.lost > 0 ? `${m.lostPct}% от съеденного` : "ничего не выброшено 👍"}</span>
        </div>
        <div className="money">
          <div><b>{rub(m.bought)}</b><span>куплено</span></div>
          <div><b>{rub(m.eaten)}</b><span>съедено</span></div>
          <div><b>{rub(total)}</b><span>дома сейчас</span></div>
        </div>
        {m.lost > 0 && <p className="muted small">Если так пойдёт дальше — около {rub(m.lost * 12)} в год.</p>}
      </div>
    </div>
  );
}

const SLOT_EMOJI: Record<string, string> = { "завтрак": "🍳", "обед": "🍲", "ужин": "🥗", "перекус": "🍎", "десерт": "🍰" };

/** Приветствие по времени суток. */
export function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

/** «Молоко и куриное филе», «Молоко, творог и укроп» */
function joinNames(names: string[]): string {
  const n = names.map((x, i) => (i ? x.toLowerCase() : x));
  return n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " и " + n[n.length - 1];
}

type HintRecipe = { r: { id: string; name: string }; st: { urgent: number; list: { urgent: boolean; product?: { name: string } }[] } };

/** Подсказка на главной — по-человечески: что пустить в дело и что из этого приготовить. */
export function homeHint(urgent: string[], cookable: HintRecipe[]): { emoji: string; title: string; sub?: string; action?: string; recipeId?: string; ask?: boolean } {
  const save = cookable.find((x) => x.st.urgent > 0);
  if (save) {
    const used = [...new Set(save.st.list.filter((i) => i.urgent && i.product).map((i) => i.product!.name))].slice(0, 2);
    const names = used.length ? used : urgent.slice(0, 2);
    return { emoji: "🍳", title: `${joinNames(names)} пора пустить в дело`, sub: `Выйдет: ${save.r.name.toLowerCase()}`, action: "Рецепт", recipeId: save.r.id };
  }
  if (urgent.length) {
    const names = urgent.slice(0, 2);
    return { emoji: "⏳", title: `${joinNames(names)} лучше съесть в первую очередь`, sub: "Claude подскажет, что из этого приготовить", action: "Идеи", ask: true };
  }
  return { emoji: "🌿", title: "Всё свежее — ничего не горит", sub: "Можно спокойно планировать меню" };
}

function Ring({ pct }: { pct: number }) {
  const r = 18, L = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 44 44" aria-label={`есть ${pct}%`}>
      <circle className="bg" cx="22" cy="22" r={r} fill="none" strokeWidth="5" />
      <circle className="fg" cx="22" cy="22" r={r} fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(L * pct) / 100} ${L}`} transform="rotate(-90 22 22)" />
      <text x="22" y="26" textAnchor="middle">{pct}%</text>
    </svg>
  );
}
