// «Меню на неделю»: дни × приёмы пищи; заполнить вручную, из своих рецептов или с Claude.
import { useEffect, useMemo, useState } from "react";
import { Sheet } from "../components/ui";
import { setSettings, useStore } from "../lib/store";
import { addEntry, autoFill, dayShort, dayTitle, entriesFor, pruneOld, recipesInPlan, removeEntry, restorePlan, toggleDone, weekDays } from "../lib/plan";
import { addMany, missingFor } from "../lib/shop";
import { compileRules, checkRecipe } from "../lib/exclusions";
import { recipeStatus } from "../lib/match";
import type { Slot } from "../lib/types";
import { SLOTS } from "../lib/types";
import { addDays, cap, norm, parseYmd, plural, ymd } from "../lib/util";
import { closeSheet, goTab, openSheet, toast } from "../lib/ui";

export function Menu() {
  const st = useStore((s) => s);
  const slots = st.settings.planSlots?.length ? st.settings.planSlots : (["обед", "ужин"] as Slot[]);
  const [offset, setOffset] = useState(0);
  // Неделя — это ближайшие 7 дней, начиная с сегодня (в воскресенье не нужно ждать понедельника)
  const start = addDays(ymd(), offset * 7);
  const days = weekDays(start);
  const today = ymd();
  const plan = st.settings.plan || [];
  useEffect(() => { pruneOld(); }, []);
  const inWeek = plan.filter((e) => e.date >= start && e.date <= days[6]);
  const future = days.filter((d) => d >= today);
  const missing = useMemo(() => missingFor(recipesInPlan(future)), [plan, st.products, st.recipes, offset]);

  function toggleSlot(s: Slot) {
    const next = slots.includes(s) ? slots.filter((x) => x !== s) : SLOTS.filter((x) => x === s || slots.includes(x));
    if (next.length) setSettings({ planSlots: next });
  }
  function fill() {
    const before = plan;
    const r = autoFill(start, slots);
    if (r.noRecipes) toast("Сначала сохраните несколько рецептов (например, через «Спросить Claude»).");
    else if (!r.added) toast("Свободных мест нет или нет подходящих рецептов.");
    else toast(`Поставлено ${r.added} ${plural(r.added, "блюдо", "блюда", "блюд")}`, () => restorePlan(before));
  }
  function clearWeek() {
    const before = plan;
    restorePlan(plan.filter((e) => !(e.date >= start && e.date <= days[6])));
    toast("Меню недели очищено", () => restorePlan(before));
  }

  const range = `${parseYmd(days[0]).getDate()}.${String(parseYmd(days[0]).getMonth() + 1).padStart(2, "0")} — ${parseYmd(days[6]).getDate()}.${String(parseYmd(days[6]).getMonth() + 1).padStart(2, "0")}`;
  return (
    <>
      <div className="chips">
        <button className="chip" aria-pressed={offset === 0} onClick={() => setOffset(0)}>Ближайшие 7 дней</button>
        <button className="chip" aria-pressed={offset === 1} onClick={() => setOffset(1)}>Следующие</button>
        <span className="muted small" style={{ alignSelf: "center", marginLeft: "auto" }}>{range}</span>
      </div>
      <div className="chips" role="group" aria-label="Что планируем">
        {SLOTS.map((s) => <button key={s} className="chip" aria-pressed={slots.includes(s)} onClick={() => toggleSlot(s)}>{cap(s)}</button>)}
      </div>
      <div className="row2" style={{ marginTop: 6 }}>
        <button className="btn sec" onClick={fill}>Заполнить из моих рецептов</button>
        <button className="btn sec" onClick={() => openSheet({ kind: "ask", week: start })}>✨ Составить с Claude</button>
      </div>
      {missing.length > 0 && (
        <div className="banner">
          <span className="txt">Для меню не хватает {missing.length} {plural(missing.length, "продукта", "продуктов", "продуктов")}: {missing.slice(0, 3).map((x) => x.name.toLowerCase()).join(", ")}{missing.length > 3 ? "…" : ""}</span>
          <button className="chip" aria-pressed="true" onClick={() => { const n = addMany(missing, "Меню"); toast(n ? `В список покупок: ${n}` : "Всё уже в списке покупок"); }}>В покупки</button>
        </div>
      )}
      {days.map((d) => (
        <div key={d} className={"day" + (d === today ? " today" : "")} style={{ opacity: d < today ? 0.6 : 1 }}>
          <div className="day-h">{dayTitle(d)}<span>{dayShort(d)}</span></div>
          {slots.map((slot) => {
            const e = entriesFor(d, plan).find((x) => x.slot === slot);
            return (
              <div key={slot} className="meal">
                <span className="slot">{cap(slot)}</span>
                {e ? (
                  <>
                    <button className={"dish" + (e.done ? " done" : "")} onClick={() => (e.recipeId && st.recipes.some((r) => r.id === e.recipeId) ? openSheet({ kind: "recipe", id: e.recipeId }) : openSheet({ kind: "pick", date: d, slot }))}>{e.name}</button>
                    <button className="ib" aria-label={e.done ? "Не готовили" : "Приготовили"} onClick={() => toggleDone(e.id)}>{e.done ? "↺" : "✓"}</button>
                    <button className="ib" aria-label={`Убрать: ${e.name}`} onClick={() => { const before = plan; removeEntry(e.id); toast(`Убрано: ${e.name}`, () => restorePlan(before)); }}>×</button>
                  </>
                ) : (
                  <button className="dish empty" onClick={() => openSheet({ kind: "pick", date: d, slot })}>+ Добавить</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {inWeek.length > 0 && <button className="link" style={{ color: "var(--bad)" }} onClick={clearWeek}>Очистить меню на эти 7 дней</button>}
    </>
  );
}

/** Выбор блюда для дня: из своих рецептов или свободной записью. */
export function PickSheet({ date, slot }: { date: string; slot: Slot }) {
  const st = useStore((s) => s);
  const [q, setQ] = useState("");
  const [free, setFree] = useState("");
  const rows = useMemo(() => {
    const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
    const who = st.settings.members.map((m) => m.id);
    return st.recipes
      .filter((r) => checkRecipe(r, compiled, who).verdict !== "hidden")
      .map((r) => ({ r, s: recipeStatus(r, st.products, st.settings.basics, st.settings.customCatalog) }))
      .filter((x) => !q.trim() || norm(x.r.name).includes(norm(q)))
      .sort((a, b) => b.s.urgent - a.s.urgent || b.s.percent - a.s.percent);
  }, [st, q]);
  const pick = (name: string, id?: string) => { addEntry(date, slot, name, id); closeSheet(); toast(`${cap(slot)}, ${dayTitle(date).toLowerCase()}: ${name}`); };
  return (
    <Sheet title={`${cap(slot)} · ${dayTitle(date)}`}>
      <label className="f" htmlFor="free">Вписать своё блюдо</label>
      <div className="field-row">
        <div style={{ flex: 3 }}><input id="free" className="inp" value={free} onChange={(e: any) => setFree(e.target.value)} placeholder="Например: пельмени" /></div>
        <div><button className="btn" disabled={!free.trim()} onClick={() => pick(free.trim())}>Готово</button></div>
      </div>
      <label className="f">Или выберите из рецептов</label>
      {st.recipes.length > 6 && <input className="inp search" type="search" value={q} onChange={(e: any) => setQ(e.target.value)} placeholder="Поиск" aria-label="Поиск рецепта" />}
      {rows.length === 0 ? (
        <div className="empty">
          <p>{st.recipes.length ? "Ничего не нашлось." : "Рецептов пока нет. Спросите Claude — он подберёт блюда, и они появятся здесь."}</p>
          {!st.recipes.length && <button className="btn sec" onClick={() => { closeSheet(); goTab("recipes"); openSheet({ kind: "ask" }); }}>Спросить Claude</button>}
        </div>
      ) : (
        <div className="list" style={{ background: "var(--card2)" }}>
          {rows.map(({ r, s }) => (
            <button key={r.id} className="li" style={{ background: "var(--card2)" }} onClick={() => pick(r.name, r.id)}>
              <span className="ico">{r.fav ? "⭐" : "🍳"}</span>
              <div className="main"><div className="name">{r.name}</div><div className="meta">{r.minutes ? `${r.minutes} мин · ` : ""}{s.missing.length ? `нет: ${s.missing.slice(0, 2).map((x) => x.name.toLowerCase()).join(", ")}` : "всё есть"}{s.urgent ? " · спасёт продукты" : ""}</div></div>
              <span className={"pct" + (s.percent === 100 ? " full" : "")}>{s.percent}%</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
