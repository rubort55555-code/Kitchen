// Окно «Приготовили»: сколько порций, что спишем со склада, во сколько обошлось блюдо и порция.
import { useMemo, useState } from "react";
import { Seg, Sheet } from "../components/ui";
import { applyCook, saveRecipes, undoCook, useStore } from "../lib/store";
import { planCook, type CookRow, type Override } from "../lib/cook";
import { toggleDone } from "../lib/plan";
import { closeSheet, toast } from "../lib/ui";
import { plural, rub, toNum, ymd } from "../lib/util";
import { qtyText } from "../lib/units";

interface Edit { on?: boolean; qty?: string }

function rowNote(row: CookRow): string {
  if (row.manual) return "Впишите, сколько использовали";
  const parts: string[] = [];
  if (row.takes.length) parts.push("Со склада: " + row.takes.map((t) => `${t.name} ${qtyText(t.take, t.unit)}`).join(" + "));
  else parts.push("Дома нет — списывать нечего");
  if (row.short > 0 && row.unit && row.takes.length) parts.push(`не хватило ${qtyText(row.short, row.unit)}`);
  if (row.rub > 0) parts.push((row.estimated ? "≈ " : "") + rub(row.rub));
  return parts.join(" · ");
}

export function CookSheet({ id, entry }: { id: string; entry?: string }) {
  const { recipes, products, settings } = useStore((s) => s);
  const r = recipes.find((x) => x.id === id);
  const [servings, setServings] = useState(r?.servings || 2);
  const [left, setLeft] = useState(0);
  const [days, setDays] = useState(3);
  const [edits, setEdits] = useState<Record<string, Edit>>({});

  const plan = useMemo(() => {
    if (!r) return null;
    const ov: Record<string, Override> = {};
    for (const [k, e] of Object.entries(edits)) {
      const q = e.qty !== undefined ? toNum(e.qty) : null;
      ov[k] = { on: e.on, qty: q !== null && q >= 0 ? q : undefined };
    }
    return planCook(r, servings, products, settings, ov);
  }, [r, servings, products, settings, edits]);

  if (!r || !plan) return <Sheet title="Приготовили"><p className="empty">Рецепт удалён.</p></Sheet>;

  const setEdit = (key: string, patch: Edit) => setEdits({ ...edits, [key]: { ...edits[key], ...patch } });
  const portion = servings > 0 ? plan.cost / servings : 0;
  const writeCount = plan.rows.filter((x) => x.on).reduce((n, x) => n + x.takes.length, 0);

  function confirm() {
    const takes = plan!.rows.filter((x) => x.on).flatMap((x) => x.takes.map((t) => ({ productId: t.productId, take: t.take })));
    const leftFrac = servings > 0 ? Math.min(1, left / servings) : 0;
    const u = applyCook(takes, r!.name, leftFrac, left > 0 ? { qty: left, days, price: plan!.cost * leftFrac } : undefined);
    // Блюдо в меню на сегодня (или то, из которого открыли) — отмечаем приготовленным
    const ent = (settings.plan || []).find((x) => (entry ? x.id === entry : x.recipeId === r!.id && x.date === ymd()));
    const marked = !!ent && !ent.done;
    if (marked) toggleDone(ent!.id);
    const prevHist = r!.history;
    saveRecipes([{ ...r!, history: [...(r!.history || []), ymd()] }]);
    const n = u.before.length;
    const head = n ? `Списано ${n} ${plural(n, "продукт", "продукта", "продуктов")}` : "Приготовлено";
    toast(`${head}. Порция ≈ ${rub(portion)}`, () => { undoCook(u); saveRecipes([{ ...r!, history: prevHist }]); if (marked) toggleDone(ent!.id); });
    closeSheet();
  }

  return (
    <Sheet title="Приготовили" right={<button className="x" onClick={closeSheet}>Закрыть</button>}>
      <h2 style={{ marginTop: 10 }}>{r.name}</h2>

      <label className="f">Сколько порций приготовили</label>
      <div className="stepper">
        <button type="button" aria-label="Меньше порций" onClick={() => { const s = Math.max(1, servings - 1); setServings(s); setLeft(Math.min(left, s)); }}>−</button>
        <input className="inp big" readOnly value={servings} aria-label="Порций" />
        <button type="button" aria-label="Больше порций" onClick={() => setServings(servings + 1)}>+</button>
      </div>
      {r.servings && servings !== r.servings && <p className="muted small">В рецепте {r.servings} {plural(r.servings, "порция", "порции", "порций")} — количество продуктов пересчитано.</p>}

      <h3 style={{ marginTop: 16 }}>Что спишем со склада</h3>
      <p className="muted small mt0">Уберите галочку у того, что не использовали. Количество можно поправить.</p>
      <div className="card" style={{ background: "var(--card2)", boxShadow: "none", padding: "4px 14px" }}>
        {plan.rows.length === 0 && <p className="muted">В рецепте только базовые продукты — списывать нечего.</p>}
        {plan.rows.map((row) => (
          <div key={row.key} className={"cook-row" + (row.on ? "" : " off")}>
            <button type="button" className={"chk" + (row.on ? " on" : "")} aria-pressed={row.on} aria-label={`Использовали: ${row.name}`} onClick={() => setEdit(row.key, { on: !row.on })}>{row.on ? "✓" : ""}</button>
            <div className="main">
              <div className="name">{row.name}</div>
              <div className="meta">{rowNote(row)}</div>
            </div>
            {row.unit && (
              <div className="qtybox">
                <input
                  className="inp" inputMode="decimal" aria-label={`Сколько: ${row.name}`}
                  placeholder={row.manual ? "?" : undefined}
                  value={edits[row.key]?.qty ?? (row.qty > 0 ? String(row.qty).replace(".", ",") : "")}
                  onChange={(e: any) => setEdit(row.key, { qty: e.target.value })}
                />
                <span>{row.unit}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {plan.skipped.length > 0 && <p className="muted small">Не списываем: {plan.skipped.map((x) => x.toLowerCase()).join(", ")} — базовые продукты и «по вкусу».</p>}

      <div className="card cost">
        <div className="row-between"><span>Стоимость блюда</span><b>{plan.cost > 0 ? (plan.estimated ? "≈ " : "") + rub(plan.cost) : "—"}</b></div>
        <div className="row-between"><span>Одна порция</span><b>{plan.cost > 0 ? (plan.estimated ? "≈ " : "") + rub(portion) : "—"}</b></div>
        {plan.estimated && <p className="muted small" style={{ margin: "6px 0 0" }}>Знак «≈»: цена части продуктов оценена по прошлым покупкам или неизвестна.</p>}
      </div>

      <label className="f">Осталось на потом, порций</label>
      <div className="stepper">
        <button type="button" aria-label="Меньше остатков" onClick={() => setLeft(Math.max(0, left - 1))}>−</button>
        <input className="inp big" readOnly value={left} aria-label="Остатки, порций" />
        <button type="button" aria-label="Больше остатков" onClick={() => setLeft(Math.min(servings, left + 1))}>+</button>
      </div>
      {left > 0 && (
        <>
          <p className="muted small">В продукты добавим «Остатки: {r.name}» — {left} {plural(left, "порция", "порции", "порций")} в холодильник. Деньги за них попадут в статистику, когда остатки съедят или выбросят.</p>
          <Seg label="Сколько дней хранить" value={String(days)} onChange={(v) => setDays(Number(v))} options={[2, 3, 4, 5].map((d) => ({ v: String(d), t: `${d} дн.` }))} />
        </>
      )}

      <button className="btn" style={{ marginTop: 16 }} onClick={confirm}>
        {writeCount ? `Приготовили — списать (${writeCount})` : "Приготовили"}
      </button>
    </Sheet>
  );
}
