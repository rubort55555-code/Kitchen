// Фильтры списка рецептов: наличие продуктов, избранное, тип блюда и кухня. Общие для экрана «Рецепты» и выбора блюда в меню.
import { CUISINES, KINDS_ORDER, cuisineOf } from "../lib/cuisine";
import type { Recipe } from "../lib/types";
import { cap, norm } from "../lib/util";

export type Avail = "all" | "now" | "almost" | "fav";
export interface Filters { avail: Avail; kind: string; cuis: string }
export const NO_FILTERS: Filters = { avail: "all", kind: "", cuis: "" };
type Row = { r: Recipe; st: { missing: unknown[] } };

export const kindOf = (r: Recipe) => (KINDS_ORDER.includes(norm(r.kind || "")) ? norm(r.kind || "") : "другое");

export function filterRecipes<T extends Row>(ok: T[], f: Filters): T[] {
  return ok
    .filter((x) => (!f.kind || kindOf(x.r) === f.kind) && (!f.cuis || cuisineOf(x.r) === f.cuis))
    .filter((x) => f.avail === "all" || (f.avail === "now" ? x.st.missing.length === 0 : f.avail === "almost" ? x.st.missing.length > 0 && x.st.missing.length <= 2 : !!x.r.fav));
}

/** Кнопки и списки фильтров; ok — рецепты после поиска и ограничений, до этих фильтров. */
export function RecipeFilters<T extends Row>({ ok, value, onChange }: { ok: T[]; value: Filters; onChange: (f: Filters) => void }) {
  const set = (p: Partial<Filters>) => onChange({ ...value, ...p });
  // В каждом списке — сколько рецептов подходит с учётом другого фильтра
  const byKind = ok.filter((x) => !value.cuis || cuisineOf(x.r) === value.cuis);
  const byCuis = ok.filter((x) => !value.kind || kindOf(x.r) === value.kind);
  const kindCounts = new Map<string, number>();
  byKind.forEach((x) => kindCounts.set(kindOf(x.r), (kindCounts.get(kindOf(x.r)) || 0) + 1));
  const cuisCounts = new Map<string, number>();
  byCuis.forEach((x) => cuisCounts.set(cuisineOf(x.r), (cuisCounts.get(cuisineOf(x.r)) || 0) + 1));
  return (
    <>
      <div className="chips">
        <button className="chip" aria-pressed={value.avail === "all"} onClick={() => set({ avail: "all" })}>Все</button>
        <button className="chip" aria-pressed={value.avail === "now"} onClick={() => set({ avail: "now" })}>Можно сейчас</button>
        <button className="chip" aria-pressed={value.avail === "almost"} onClick={() => set({ avail: "almost" })}>Не хватает 1–2</button>
        <button className="chip" aria-pressed={value.avail === "fav"} onClick={() => set({ avail: "fav" })}>★ Избранное</button>
      </div>
      <div className="row2 filters">
        <label className="fsel">
          <span>Тип блюда</span>
          <select className="inp" value={value.kind} onChange={(e: any) => set({ kind: e.target.value })} aria-label="Тип блюда">
            <option value="">Все ({byKind.length})</option>
            {[...KINDS_ORDER, "другое"].filter((k) => kindCounts.get(k) || k === value.kind).map((k) => <option key={k} value={k}>{cap(k)} ({kindCounts.get(k) || 0})</option>)}
          </select>
        </label>
        <label className="fsel">
          <span>Кухня</span>
          <select className="inp" value={value.cuis} onChange={(e: any) => set({ cuis: e.target.value })} aria-label="Кухня">
            <option value="">Все ({byCuis.length})</option>
            {CUISINES.filter((c) => cuisCounts.get(c) || c === value.cuis).map((c) => <option key={c} value={c}>{c} ({cuisCounts.get(c) || 0})</option>)}
          </select>
        </label>
      </div>
      {(value.kind || value.cuis) && <button className="link" onClick={() => set({ kind: "", cuis: "" })}>Сбросить фильтры · найдено {filterRecipes(ok, value).length}</button>}
    </>
  );
}
