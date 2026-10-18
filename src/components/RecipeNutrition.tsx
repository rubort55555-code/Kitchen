// Пищевая ценность рецепта на порцию: КБЖУ и доля дневной нормы члена семьи, витамины и минералы.
import { useMemo, useState } from "react";
import type { Member, Recipe } from "../lib/types";
import { NUTRIENTS, recipeNutrition, type NutrientKey } from "../lib/recipeNutrition";
import { micros, newProfile, planFor } from "../lib/nutrition";

const fmt = (x: number) => (x >= 100 ? Math.round(x) : x >= 10 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100).toLocaleString("ru-RU");
const pctOf = (x: number, norm?: number) => (norm ? Math.round((x / norm) * 100) : null);

export function RecipeNutrition({ r, members, servings }: { r: Recipe; members: Member[]; servings?: number }) {
  const n = useMemo(() => recipeNutrition(r, servings), [r, servings]);
  const people = members.filter((m) => m.body && planFor(m.body));
  const [who, setWho] = useState(people[0]?.id || "");
  const [open, setOpen] = useState(false);
  if (!n) return null;
  const m = people.find((x) => x.id === who) || people[0];
  const plan = m?.body ? planFor(m.body) : null;
  // Без профиля в «Питании» — средняя норма взрослого (женщина 30–64 лет, МР 2.3.1.0253-21)
  const norms = new Map(micros(m?.body || newProfile("f")).map((x) => [x.key, x.amount]));
  const macro: { key: NutrientKey; t: string; norm?: number }[] = [
    { key: "kcal", t: "ккал", norm: plan?.kcal },
    { key: "protein", t: "белки, г", norm: plan?.protein },
    { key: "fat", t: "жиры, г", norm: plan?.fat },
    { key: "carbs", t: "углеводы, г", norm: plan?.carbs },
  ];
  const v = n.perServing;
  const micro = NUTRIENTS.filter((x) => norms.has(x.key));
  return (
    <>
      <h3 style={{ marginTop: 16 }}>Пищевая ценность <span className="muted small">на порцию</span></h3>
      {people.length > 1 && (
        <div className="chips">
          {people.map((p) => <button key={p.id} className="chip" aria-pressed={p.id === m?.id} onClick={() => setWho(p.id)}>{p.name}</button>)}
        </div>
      )}
      <div className="list">
        {macro.map((x) => {
          const p = pctOf(v[x.key], x.norm);
          return <div key={x.key} className="kv"><span>{fmt(v[x.key])} {x.t}</span><span>{p !== null ? `${p}% нормы` : ""}</span></div>;
        })}
      </div>
      <p className="muted small">
        Клетчатка {fmt(v.fiber)} г{plan ? ` (${pctOf(v.fiber, plan.fiber)}%)` : ""} · сахара {fmt(v.sugar)} г · насыщенные жиры {fmt(v.satFat)} г · соль ≈ {fmt((v.na * 2.54) / 1000)} г
      </p>
      <button className="btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Скрыть витамины и минералы" : "Витамины и минералы"}</button>
      {open && (
        <div className="list">
          {micro.map((x) => {
            const p = pctOf(v[x.key], norms.get(x.key));
            return (
              <div key={x.key} className="kv">
                <span>{x.title}</span>
                <span>{fmt(v[x.key])} {x.unit}{p !== null ? ` · ${p}%` : ""}</span>
              </div>
            );
          })}
        </div>
      )}
      <p className="muted small">
        Ориентировочно: по составу сырых продуктов (базы Fineli и USDA), потери витаминов при готовке не учтены, соль — нейодированная. % — от дневной нормы {m ? `(${m.name})` : "взрослого; свою норму можно рассчитать в «Ещё → Питание»"}.
        {n.missing.length > 0 && ` Не учтено: ${n.missing.join(", ").toLowerCase()}.`}
      </p>
    </>
  );
}
