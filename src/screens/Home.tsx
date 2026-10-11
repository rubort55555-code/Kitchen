// Главная: что съесть первым, что приготовить, сколько пропало за месяц.
import { useMemo } from "react";
import { Header, Icon } from "../components/ui";
import { entriesFor } from "../lib/plan";
import { SLOTS } from "../lib/types";
import { cap, ymd } from "../lib/util";
import { useStore, valueOf } from "../lib/store";
import { findCatalog } from "../lib/catalog";
import { compileRules, checkRecipe } from "../lib/exclusions";
import { recipeStatus } from "../lib/match";
import { monthStart, summary } from "../lib/stats";
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
  const backupDays = settings.lastBackup ? Math.floor((Date.now() - settings.lastBackup) / 86400000) : null;
  const needBackup = (products.length > 0 || log.length > 0) && (backupDays === null || backupDays >= 7);
  const today = new Date();
  const todayMenu = entriesFor(ymd(), settings.plan || []).filter((e) => SLOTS.includes(e.slot));
  const shopOpen = (settings.shop || []).filter((x) => !x.done).length;

  return (
    <div className="screen">
      <Header title="Кухня" screen="home" sub={today.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
        extra={<button className="helpbtn" aria-label="Ещё: семья, ограничения, данные" onClick={() => goPage(null)} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Icon.gear /></button>} />
      {saveError && <div className="banner bad"><span className="txt">{saveError}</span></div>}
      {needBackup && (
        <div className="banner warn">
          <span className="txt">{backupDays === null ? "Вы ещё не сохраняли копию данных." : `Копии данных ${backupDays} ${plural(backupDays, "день", "дня", "дней")}.`} Сохраните её — Safari иногда стирает данные.</span>
          <button className="chip" onClick={() => goPage("data")}>Сохранить</button>
        </div>
      )}

      {products.length === 0 ? (
        <div className="card empty">
          <div className="big">🥕</div>
          <p>Добавьте продукты из холодильника — и я подскажу, что приготовить.</p>
          <button className="btn" onClick={() => openSheet({ kind: "add" })}>Добавить продукт</button>
          <button className="link" onClick={() => goPage("data")}>Перенести данные из «Что приготовить»</button>
        </div>
      ) : (
        <div className="card">
          <h3>Съесть в первую очередь <span className="muted small">{urgent.length ? urgent.length : ""}</span></h3>
          {urgent.length === 0 ? (
            <p className="muted mt0">Всё свежее. Ничего не горит 👍</p>
          ) : (
            <div>
              {urgent.slice(0, 6).map((p) => {
                const fr = freshness(p.until);
                return (
                  <button key={p.id} className="li" style={{ padding: "8px 0", minHeight: 48 }} onClick={() => openSheet({ kind: "product", id: p.id })}>
                    <span className="ico">{findCatalog(p.name, settings.customCatalog)?.e || "🛒"}</span>
                    <div className="main"><div className="name">{p.name}</div><div className="meta">{qtyText(p.qty, p.unit)} · {rub(valueOf(p))}</div></div>
                    <span className={"end " + (fr === "bad" ? "t-bad" : "t-soon")}>{untilText(p.until)}</span>
                  </button>
                );
              })}
              {urgent.length > 6 && <button className="link" onClick={() => goTab("products")}>Ещё {urgent.length - 6}</button>}
            </div>
          )}
        </div>
      )}

      {expired > 0 && (
        <button className="btn danger" style={{ marginTop: 10 }} onClick={() => openSheet({ kind: "overdue" })}>⚠️ Просрочено: {expired} — что с ними?</button>
      )}
      <div className="card">
        <h3>Сегодня в меню <button className="link small" style={{ padding: 0 }} onClick={goMenu}>Неделя ›</button></h3>
        {todayMenu.length ? (
          todayMenu.map((e) => (
            <button key={e.id} className="li" style={{ padding: "8px 0", minHeight: 44 }} onClick={() => (e.recipeId && recipes.some((r) => r.id === e.recipeId) ? openSheet({ kind: "recipe", id: e.recipeId }) : goMenu())}>
              <span className="ico" style={{ fontSize: 15, width: 60, textAlign: "left" }} >{cap(e.slot)}</span>
              <div className="main"><div className={"name" + (e.done ? " muted" : "")} style={{ textDecoration: e.done ? "line-through" : undefined }}>{e.name}</div></div>
            </button>
          ))
        ) : (
          <p className="muted mt0">На сегодня ничего не запланировано. <button className="link" style={{ padding: 0 }} onClick={goMenu}>Составить меню на неделю</button></p>
        )}
        {shopOpen > 0 && <button className="btn ghost" style={{ marginTop: 8, background: "var(--card2)" }} onClick={() => goTab("shop")}>🛒 В списке покупок: {shopOpen}</button>}
      </div>

      <div className="card">
        <h3>Что приготовить</h3>
        {cookable.length > 0 ? (
          <div>
            {cookable.map(({ r, st }) => (
              <button key={r.id} className="li" style={{ padding: "8px 0", minHeight: 48 }} onClick={() => openSheet({ kind: "recipe", id: r.id })}>
                <span className="ico">🍳</span>
                <div className="main"><div className="name">{r.name}</div><div className="meta">{st.missing.length ? `не хватает: ${st.missing.map((x) => x.name.toLowerCase()).join(", ")}` : "всё есть дома"}{st.urgent ? " · спасёт продукты" : ""}</div></div>
                <span className={"pct" + (st.percent === 100 ? " full" : "")}>{st.percent}%</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted mt0">{products.length ? "Спросите Claude — он подберёт блюда из того, что есть, с учётом ваших ограничений." : "Когда добавите продукты, здесь появятся блюда из них."}</p>
        )}
        <button className="btn" style={{ marginTop: 10 }} onClick={() => openSheet({ kind: "ask" })}>✨ Спросить Claude</button>
      </div>

      <div className="card">
        <h3>Пропало за {MONTHS[today.getMonth()]} <button className="link small" style={{ padding: 0 }} onClick={() => goPage("stats")}>Подробнее ›</button></h3>
        <div className={"hero" + (m.lost > 0 ? " bad" : "")}>
          <b>{rub(m.lost)}</b>
          <span className="muted">{m.lost > 0 ? `${m.lostPct}% от съеденного` : "ничего не выброшено"}</span>
        </div>
        <div className="stats3">
          <div><b>{rub(m.bought)}</b><span>куплено</span></div>
          <div><b>{rub(m.eaten)}</b><span>съедено</span></div>
          <div><b>{rub(total)}</b><span>дома сейчас</span></div>
        </div>
        {m.lost > 0 && <p className="muted small">Если так пойдёт дальше — около {rub(m.lost * 12)} в год.</p>}
      </div>
    </div>
  );
}
