// «Меню»: на один день или на неделю — дни × приёмы пищи; заполнить вручную, из своих рецептов или с Claude.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Sheet } from "../components/ui";
import { NO_FILTERS, RecipeFilters, filterRecipes, kindOf, type Filters } from "../components/RecipeFilters";
import { setSettings, useStore } from "../lib/store";
import { addEntry, autoFill, dayShort, dayTitle, entriesFor, pruneOld, recipesInPlan, removeEntry, restorePlan, toggleDone, weekDays } from "../lib/plan";
import { addMany, missingFor, restoreShop, shopList } from "../lib/shop";
import { compileRules, checkRecipe } from "../lib/exclusions";
import { recipeStatus } from "../lib/match";
import { CUISINES, cuisineOf } from "../lib/cuisine";
import type { Slot } from "../lib/types";
import { SLOTS } from "../lib/types";
import { addDays, cap, norm, parseYmd, plural, ymd } from "../lib/util";
import { closeSheet, goTab, openSheet, toast } from "../lib/ui";

export function Menu() {
  const st = useStore((s) => s);
  const slots = st.settings.planSlots?.length ? st.settings.planSlots : (["обед", "ужин"] as Slot[]);
  const [offset, setOffset] = useState(0);
  // Меню на один день (выбранный из ближайших 7) или на неделю
  const [mode, setMode] = useState<"day" | "week">("week");
  const today = ymd();
  const [day, setDay] = useState(today);
  // Неделя — это ближайшие 7 дней, начиная с сегодня (в воскресенье не нужно ждать понедельника)
  const start = mode === "day" ? today : addDays(today, offset * 7);
  const week = weekDays(start);
  const days = mode === "day" ? [day] : week;
  const plan = st.settings.plan || [];
  useEffect(() => { pruneOld(); }, []);
  const inWeek = plan.filter((e) => days.includes(e.date));
  const future = days.filter((d) => d >= today);
  // Сколько рецептов каждой кухни (без запрещённых ограничениями) — для списка «Кухня»
  const cuisCounts = useMemo(() => {
    const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
    const who = st.settings.members.map((m) => m.id);
    const m = new Map<string, number>();
    st.recipes.filter((r) => checkRecipe(r, compiled, who).verdict === "ok").forEach((r) => m.set(cuisineOf(r), (m.get(cuisineOf(r)) || 0) + 1));
    return m;
  }, [st.recipes, st.settings.rules, st.settings.customCatalog, st.settings.members]);
  const cuis = st.settings.planCuisine || "";
  const missing = useMemo(() => missingFor(recipesInPlan(future)), [plan, st.products, st.recipes, offset, mode, day]);

  function toggleSlot(s: Slot) {
    const next = slots.includes(s) ? slots.filter((x) => x !== s) : SLOTS.filter((x) => x === s || slots.includes(x));
    if (next.length) setSettings({ planSlots: next });
  }
  function fill() {
    const before = plan;
    const r = autoFill(start, slots, mode === "day" ? day : undefined);
    if (r.noRecipes) toast("Сначала сохраните несколько рецептов (например, через «Спросить Claude»).");
    else if (!r.added) toast(mode === "day" && day < today ? "Этот день уже прошёл." : cuis ? `Не нашлось подходящих рецептов кухни «${cuis}» — выберите другую кухню или «Любая».` : "Свободных мест нет или нет подходящих рецептов.");
    else {
      // Недостающее для новых блюд сразу уходит в список покупок (отмена вернёт и меню, и список)
      const shopBefore = shopList();
      const n = addMany(missingFor(recipesInPlan(future)), "Меню");
      toast(`Поставлено ${r.added} ${plural(r.added, "блюдо", "блюда", "блюд")}` + (n ? `; докупить: ${n} в списке покупок` : ""), () => { restorePlan(before); restoreShop(shopBefore); });
    }
  }
  function clearWeek() {
    const before = plan;
    restorePlan(plan.filter((e) => !days.includes(e.date)));
    toast(mode === "day" ? "Меню дня очищено" : "Меню недели очищено", () => restorePlan(before));
  }

  const dm = (d: string) => `${parseYmd(d).getDate()}.${String(parseYmd(d).getMonth() + 1).padStart(2, "0")}`;
  const range = `${dm(week[0])} — ${dm(week[6])}`;
  return (
    <>
      <div className="chips" role="group" aria-label="На сколько дней">
        <button className="chip" aria-pressed={mode === "day"} onClick={() => setMode("day")}>На день</button>
        <button className="chip" aria-pressed={mode === "week"} onClick={() => setMode("week")}>На неделю</button>
      </div>
      {mode === "week" ? (
        <div className="chips">
          <button className="chip" aria-pressed={offset === 0} onClick={() => setOffset(0)}>Ближайшие 7 дней</button>
          <button className="chip" aria-pressed={offset === 1} onClick={() => setOffset(1)}>Следующие</button>
          <span className="muted small" style={{ alignSelf: "center", marginLeft: "auto" }}>{range}</span>
        </div>
      ) : (
        <div className="chips scroll" role="group" aria-label="День">
          {week.map((d, i) => <button key={d} className="chip" aria-pressed={day === d} onClick={() => setDay(d)}>{i === 0 ? "Сегодня" : i === 1 ? "Завтра" : `${dayShort(d)} ${dm(d)}`}</button>)}
        </div>
      )}
      <div className="chips" role="group" aria-label="Что планируем">
        {SLOTS.map((s) => <button key={s} className="chip" aria-pressed={slots.includes(s)} onClick={() => toggleSlot(s)}>{cap(s)}</button>)}
        <button className="chip" aria-pressed={st.settings.planDessert !== false} onClick={() => setSettings({ planDessert: st.settings.planDessert === false })}>Десерт</button>
      </div>
      <label className="fsel">
        <span>Кухня</span>
        <select className="inp" value={cuis} onChange={(e: any) => setSettings({ planCuisine: e.target.value || undefined })} aria-label="Кухня меню">
          <option value="">Любая</option>
          {CUISINES.filter((c) => cuisCounts.get(c) || c === cuis).map((c) => <option key={c} value={c}>{c} ({cuisCounts.get(c) || 0})</option>)}
        </select>
      </label>
      <div className="row2" style={{ marginTop: 6 }}>
        <button className="btn sec" onClick={fill}>Заполнить из моих рецептов</button>
        <button className="btn sec" onClick={() => openSheet(mode === "day" ? { kind: "ask", week: day, day } : { kind: "ask", week: start })}>✨ Составить с Claude</button>
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
              <Fragment key={slot}>
              <div className="meal">
                <span className="slot">{cap(slot)}</span>
                {e ? (
                  <>
                    <button className={"dish" + (e.done ? " done" : "")} onClick={() => (e.recipeId && st.recipes.some((r) => r.id === e.recipeId) ? openSheet({ kind: "recipe", id: e.recipeId }) : openSheet({ kind: "pick", date: d, slot }))}>{e.name}</button>
                    <button className="ib" aria-label={e.done ? "Не готовили" : "Приготовили"} onClick={() => (!e.done && e.recipeId && st.recipes.some((r) => r.id === e.recipeId) ? openSheet({ kind: "cook", id: e.recipeId, entry: e.id }) : toggleDone(e.id))}>{e.done ? "↺" : "✓"}</button>
                    <button className="ib" aria-label={`Убрать: ${e.name}`} onClick={() => { const before = plan; removeEntry(e.id); toast(`Убрано: ${e.name}`, () => restorePlan(before)); }}>×</button>
                  </>
                ) : (
                  <button className="dish empty" onClick={() => openSheet({ kind: "pick", date: d, slot })}>+ Добавить</button>
                )}
              </div>
              {e && ([["side", "+ салат"], ["sweet", "+ десерт"]] as const).map(([k, label]) => e[k] && (
                <div key={k} className="meal side">
                  <span className="slot">{label}</span>
                  <button className="dish" onClick={() => openSheet({ kind: "recipe", id: e[k]!.id })}>{e[k]!.name}</button>
                  <button className="ib" aria-label={`Убрать: ${e[k]!.name}`} onClick={() => { const before = plan; restorePlan(plan.map((x) => (x.id === e.id ? { ...x, [k]: undefined } : x))); toast(`Убрано: ${e[k]!.name}`, () => restorePlan(before)); }}>×</button>
                </div>
              ))}
              </Fragment>
            );
          })}
        </div>
      ))}
      {inWeek.length > 0 && <button className="link" style={{ color: "var(--bad)" }} onClick={clearWeek}>{mode === "day" ? "Очистить меню на этот день" : "Очистить меню на эти 7 дней"}</button>}
    </>
  );
}

/** Выбор блюда для дня: из своих рецептов или свободной записью. */
export function PickSheet({ date, slot }: { date: string; slot: Slot }) {
  const st = useStore((s) => s);
  const [q, setQ] = useState("");
  const [free, setFree] = useState("");
  const [limit, setLimit] = useState(50);
  const ok = useMemo(() => {
    const compiled = compileRules(st.settings.rules, st.settings.customCatalog, st.settings.members);
    const who = st.settings.members.map((m) => m.id);
    const nq = norm(q);
    return st.recipes
      .filter((r) => checkRecipe(r, compiled, who).verdict !== "hidden")
      .filter((r) => !nq || norm(r.name).includes(nq) || r.ingredients.some((i) => norm(i.name).includes(nq)))
      .map((r) => ({ r, st: recipeStatus(r, st.products, st.settings.basics, st.settings.customCatalog) }))
      .sort((a, b) => b.st.urgent - a.st.urgent || b.st.percent - a.st.percent);
  }, [st, q]);
  // На завтрак сразу показываем завтраки, если они есть; фильтр можно сбросить
  const [flt, setFlt] = useState<Filters>(() => (slot === "завтрак" && st.recipes.some((r) => kindOf(r) === "завтрак") ? { ...NO_FILTERS, kind: "завтрак" } : NO_FILTERS));
  const rows = filterRecipes(ok, flt);
  const pick = (name: string, id?: string) => { addEntry(date, slot, name, id); closeSheet(); toast(`${cap(slot)}, ${dayTitle(date).toLowerCase()}: ${name}`); };
  return (
    <Sheet title={`${cap(slot)} · ${dayTitle(date)}`}>
      <label className="f" htmlFor="free">Вписать своё блюдо</label>
      <div className="field-row">
        <div style={{ flex: 3 }}><input id="free" className="inp" value={free} onChange={(e: any) => setFree(e.target.value)} placeholder="Например: пельмени" /></div>
        <div><button className="btn" disabled={!free.trim()} onClick={() => pick(free.trim())}>Готово</button></div>
      </div>
      <label className="f">Или выберите из рецептов</label>
      {st.recipes.length > 6 && (
        <>
          <input className="inp search" type="search" value={q} onChange={(e: any) => { setQ(e.target.value); setLimit(50); }} placeholder="Поиск по названию или продукту" aria-label="Поиск рецепта" />
          <RecipeFilters ok={ok} value={flt} onChange={(v) => { setFlt(v); setLimit(50); }} />
        </>
      )}
      {rows.length === 0 ? (
        <div className="empty">
          <p>{st.recipes.length ? "Ничего не нашлось." : "Рецептов пока нет. Спросите Claude — он подберёт блюда, и они появятся здесь."}</p>
          {!st.recipes.length && <button className="btn sec" onClick={() => { closeSheet(); goTab("recipes"); openSheet({ kind: "ask" }); }}>Спросить Claude</button>}
        </div>
      ) : (
        <div className="list" style={{ background: "var(--card2)" }}>
          {rows.slice(0, limit).map(({ r, st: s }) => (
            <button key={r.id} className="li" style={{ background: "var(--card2)" }} onClick={() => pick(r.name, r.id)}>
              <span className="ico">{r.fav ? "⭐" : "🍳"}</span>
              <div className="main"><div className="name">{r.name}</div><div className="meta">{r.minutes ? `${r.minutes} мин · ` : ""}{s.missing.length ? `нет: ${s.missing.slice(0, 2).map((x) => x.name.toLowerCase()).join(", ")}` : "всё есть"}{s.urgent ? " · спасёт продукты" : ""}</div></div>
              <span className={"pct" + (s.percent === 100 ? " full" : "")}>{s.percent}%</span>
            </button>
          ))}
          {rows.length > limit && <button className="btn sec" onClick={() => setLimit(limit + 50)}>Показать ещё ({rows.length - limit})</button>}
        </div>
      )}
    </Sheet>
  );
}
