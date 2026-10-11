// Экран «Рецепты»: что можно приготовить из того, что есть + «Спросить Claude».
import { useMemo, useState } from "react";
import { Header, Seg, Sheet } from "../components/ui";
import { Menu } from "./Menu";
import { addMany } from "../lib/shop";
import { addEntry, dayShort, weekDays } from "../lib/plan";
import { SLOTS, type Slot } from "../lib/types";
import { deleteRecipe, saveRecipes, useStore } from "../lib/store";
import { applyReplace, compileRules, checkRecipe } from "../lib/exclusions";
import { recipeStatus } from "../lib/match";
import { cap, norm, parseYmd, ymd } from "../lib/util";
import { closeSheet, openSheet, setRecipesView, toast, useUI } from "../lib/ui";

type F = "all" | "now" | "almost" | "fav";

export function Recipes() {
  const { recipes, products, settings } = useStore((s) => s);
  const [f, setF] = useState<F>("all");
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const rows = useMemo(() => {
    const compiled = compileRules(settings.rules, settings.customCatalog, settings.members);
    const who = settings.members.map((m) => m.id);
    return recipes.map((r) => ({ r, c: checkRecipe(r, compiled, who), st: recipeStatus(r, products, settings.basics, settings.customCatalog) }))
      .sort((a, b) => b.st.percent - a.st.percent || b.st.urgent - a.st.urgent || b.r.createdAt - a.r.createdAt);
  }, [recipes, products, settings]);
  const nq = norm(q);
  const ok = rows.filter((x) => x.c.verdict !== "hidden").filter((x) => !nq || norm(x.r.name).includes(nq) || x.r.ingredients.some((i) => norm(i.name).includes(nq)));
  const list = ok.filter((x) => f === "all" || (f === "now" ? x.st.missing.length === 0 : f === "almost" ? x.st.missing.length > 0 && x.st.missing.length <= 2 : !!x.r.fav));
  const hidden = rows.filter((x) => x.c.verdict === "hidden");
  const view = useUI((u) => u.recipesView);

  if (view === "menu") {
    return (
      <div className="screen">
        <Header title="Меню" screen="menu" />
        <Seg label="Раздел" value={view} onChange={setRecipesView} options={[{ v: "list", t: "Рецепты" }, { v: "menu", t: "Меню на неделю" }]} />
        <Menu />
      </div>
    );
  }
  return (
    <div className="screen">
      <Header title="Рецепты" screen="recipes" />
      <Seg label="Раздел" value={view} onChange={setRecipesView} options={[{ v: "list", t: "Рецепты" }, { v: "menu", t: "Меню на неделю" }]} />
      <button className="btn" style={{ marginTop: 10 }} onClick={() => openSheet({ kind: "ask" })}>✨ Спросить Claude: что приготовить</button>
      {recipes.length === 0 ? (
        <div className="empty">
          <div className="big">📖</div>
          <p>Здесь будут рецепты. Спросите Claude — он подберёт блюда из ваших продуктов, а вы сохраните понравившиеся.</p>
          <p className="small">Встроенная база рецептов появится на следующем этапе.</p>
        </div>
      ) : (
        <>
          <input className="inp search" style={{ marginTop: 14 }} type="search" placeholder="Поиск по названию или продукту" value={q} onChange={(e: any) => setQ(e.target.value)} aria-label="Поиск рецепта" />
          <div className="chips">
            <button className="chip" aria-pressed={f === "all"} onClick={() => setF("all")}>Все</button>
            <button className="chip" aria-pressed={f === "now"} onClick={() => setF("now")}>Можно сейчас</button>
            <button className="chip" aria-pressed={f === "almost"} onClick={() => setF("almost")}>Не хватает 1–2</button>
            <button className="chip" aria-pressed={f === "fav"} onClick={() => setF("fav")}>★ Избранное</button>
          </div>
          <div className="list">
            {list.map(({ r, c, st }) => (
              <button key={r.id} className="li" onClick={() => openSheet({ kind: "recipe", id: r.id })}>
                <span className="ico">{r.fav ? "⭐" : "🍳"}</span>
                <div className="main">
                  <div className="name">{r.name}</div>
                  <div className="meta">
                    {c.verdict === "warn" && <span className="tag bad">замена</span>}
                    {st.urgent > 0 && <span className="tag soon">спасёт продукты</span>}
                    {r.minutes ? `${r.minutes} мин · ` : ""}{st.missing.length ? `нет: ${st.missing.slice(0, 2).map((x) => x.name.toLowerCase()).join(", ")}${st.missing.length > 2 ? "…" : ""}` : "всё есть"}
                  </div>
                </div>
                <span className={"pct" + (st.percent === 100 ? " full" : "")}>{st.percent}%</span>
              </button>
            ))}
            {list.length === 0 && <p className="empty">Ничего не нашлось.</p>}
          </div>
          {hidden.length > 0 && (
            <>
              <button className="link" onClick={() => setShowHidden(!showHidden)}>{showHidden ? "Скрыть" : "Показать"} неподходящие по ограничениям ({hidden.length})</button>
              {showHidden && (
                <div className="list">
                  {hidden.map(({ r, c }) => (
                    <button key={r.id} className="li" onClick={() => openSheet({ kind: "recipe", id: r.id })}>
                      <span className="ico">🚫</span>
                      <div className="main"><div className="name">{r.name}</div><div className="meta t-bad">{c.issues[0]?.rule.title}</div></div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Открытый рецепт: что есть дома, чего не хватает, шаги, замены. */
export function RecipeView({ id }: { id: string }) {
  const { recipes, products, settings } = useStore((s) => s);
  const r = recipes.find((x) => x.id === id);
  const [confirmDel, setConfirmDel] = useState(false);
  const [toMenu, setToMenu] = useState(false);
  const [day, setDay] = useState(ymd());
  const [slot, setSlot] = useState<Slot>("ужин");
  if (!r) return <Sheet title="Рецепт"><p className="empty">Рецепт удалён.</p></Sheet>;
  const compiled = compileRules(settings.rules, settings.customCatalog, settings.members);
  const c = checkRecipe(r, compiled, settings.members.map((m) => m.id));
  const st = recipeStatus(r, products, settings.basics, settings.customCatalog);
  return (
    <Sheet title="Рецепт" left={<button className="x l" aria-label={r.fav ? "Убрать из избранного" : "В избранное"} onClick={() => saveRecipes([{ ...r, fav: !r.fav }])}>{r.fav ? "★" : "☆"}</button>}>
      <h2 style={{ marginTop: 10 }}>{r.name}</h2>
      <p className="muted mt0">{[r.minutes && `${r.minutes} мин`, r.servings && `${r.servings} порц.`, r.kind].filter(Boolean).join(" · ")}{r.source === "claude" ? " · от Claude" : r.source === "old" ? " · из «Что приготовить»" : ""}</p>
      {r.why && <p>{r.why}</p>}
      {c.issues.map((i, k) => (
        <div key={k} className={"issue" + (i.rule.level === "little" && c.verdict !== "hidden" ? " little" : "")}>
          {i.rule.level === "little" && c.verdict !== "hidden" ? "🌻 " : "⚠️ "}{i.msg}{i.where !== "название" && i.where !== "шаги" ? ` (${i.where})` : ""}
          {i.replace && (
            <button className="btn sec" onClick={() => { saveRecipes([applyReplace(r, i.word, i.replace!)]); toast(`Заменено на: ${i.replace}`); }}>
              Заменить на {i.replace}
            </button>
          )}
        </div>
      ))}
      <h3 style={{ marginTop: 16 }}>Ингредиенты <span className={"pct" + (st.percent === 100 ? " full" : "")}>{st.percent}%</span></h3>
      <div className="card" style={{ background: "var(--card2)", boxShadow: "none" }}>
        {st.list.map((i, k) => (
          <div key={k} className="ing">
            <span className={"mk " + (i.have ? "y" : "n")}>{i.have ? "✓" : "○"}</span>
            <span>{i.name}{i.urgent ? <span className="tag soon" style={{ marginLeft: 6 }}>срочно</span> : null}{i.basic && !i.product ? <span className="muted small"> · базовый</span> : null}</span>
            <span className="a">{i.amount}</span>
          </div>
        ))}
      </div>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => openSheet({ kind: "cook", id: r.id })}>🍳 Приготовили — списать продукты</button>
      {st.missing.length > 0 && (
        <button className="btn sec" onClick={() => { const n = addMany(st.missing.map((x) => ({ name: x.name, amount: x.amount })), r.name); toast(n ? `В список покупок: ${n}` : "Всё уже в списке покупок"); }}>
          Недостающее — в покупки ({st.missing.length})
        </button>
      )}
      {!toMenu ? (
        <button className="btn ghost" onClick={() => setToMenu(true)}>Поставить в меню</button>
      ) : (
        <div className="card" style={{ background: "var(--card2)", boxShadow: "none" }}>
          <div className="chips">
            {weekDays(ymd()).map((d) => (
              <button key={d} className="chip" aria-pressed={day === d} onClick={() => setDay(d)}>{d === ymd() ? "Сегодня" : `${dayShort(d)} ${parseYmd(d).getDate()}`}</button>
            ))}
          </div>
          <Seg label="Приём пищи" value={slot} onChange={setSlot} options={SLOTS.map((s) => ({ v: s, t: cap(s) }))} />
          <button className="btn" onClick={() => { addEntry(day, slot, r.name, r.id); setToMenu(false); toast(`В меню: ${cap(slot)}, ${day === ymd() ? "сегодня" : dayShort(day)}`); }}>Добавить в меню</button>
        </div>
      )}
      {r.steps.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Как готовить</h3>
          <ol className="steps">{r.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
        </>
      )}
      {!confirmDel ? (
        <button className="link" style={{ color: "var(--bad)" }} onClick={() => setConfirmDel(true)}>Удалить рецепт</button>
      ) : (
        <div className="row2" style={{ marginTop: 10 }}>
          <button className="btn danger" onClick={() => { deleteRecipe(r.id); closeSheet(); toast(`Удалено: ${r.name}`, () => saveRecipes([r])); }}>Удалить</button>
          <button className="btn ghost" onClick={() => setConfirmDel(false)}>Отмена</button>
        </div>
      )}
    </Sheet>
  );
}
