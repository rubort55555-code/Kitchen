// Режим готовки: ингредиенты с галочками, потом шаги по одному крупно, свайп, таймеры, экран не гаснет.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { closeSheet, openSheet } from "../lib/ui";
import { scaleAmount } from "../lib/util";
import { findTimes, fmtTime, startTimer, stopTimer, useTimers } from "../lib/timers";
import { allowSleep, isAwake, keepAwake, wakeSupported } from "../lib/wake";
import { stageOf, stepIngredients, weightHint } from "../lib/recipeSteps";

export function CookMode({ id }: { id: string }) {
  const r = useStore((s) => s.recipes.find((x) => x.id === id));
  const [i, setI] = useState(-1); // -1 — ингредиенты, 0..n-1 — шаги, n — финал
  const [serv, setServ] = useState(r?.servings || 2);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [awake, setAwake] = useState<boolean | null>(null);
  const timers = useTimers();
  const [, force] = useState(0);
  const x0 = useRef<number | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    keepAwake();
    const t = setTimeout(() => setAwake(isAwake()), 800);
    const iv = setInterval(() => force((n) => n + 1), 500);
    return () => { document.body.style.overflow = ""; allowSleep(); clearTimeout(t); clearInterval(iv); };
  }, []);

  if (!r) return null;
  const n = r.steps.length;
  const k = serv / (r.servings || 2);
  const go = (d: number) => setI((v) => Math.min(n, Math.max(-1, v + d)));
  const times = i >= 0 && i < n ? findTimes(r.steps[i]) : [];
  const running = timers;

  return (
    <div className="cookmode" role="dialog" aria-modal="true" aria-label="Готовка"
      onTouchStart={(e: any) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e: any) => {
        if (x0.current === null) return;
        const dx = e.changedTouches[0].clientX - x0.current; x0.current = null;
        if (Math.abs(dx) > 70) go(dx < 0 ? 1 : -1);
      }}>
      <div className="cm-top">
        <button className="x l" onClick={closeSheet}>✕ Закрыть</button>
        <div className="cm-title">{r.name}</div>
        <span className="cm-awake" title={awake ? "Экран не погаснет" : wakeSupported() ? "Экран может погаснуть" : "Не поддерживается этой версией iOS"}>
          {awake ? "☀︎" : "☾"}
        </span>
      </div>
      {running.length > 0 && (
        <div className="cm-timers">
          {running.map((t) => (
            <div key={t.id} className={"cm-timer" + (t.done ? " done" : "")}>
              <span>{t.label}</span>
              <b>{t.done ? "Время вышло!" : fmtTime(t.end - Date.now())}</b>
              <button onClick={() => stopTimer(t.id)}>{t.done ? "Стоп" : "✕"}</button>
            </div>
          ))}
        </div>
      )}
      <div className="cm-dots" aria-hidden="true">
        {Array.from({ length: n + 2 }, (_, j) => <span key={j} className={j - 1 === i ? "on" : j - 1 < i ? "past" : ""} />)}
      </div>
      <div className="cm-body">
        {i === -1 && (
          <>
            <h2>Что понадобится</h2>
            <div className="stepper cm-serv">
              <button aria-label="Меньше порций" onClick={() => setServ(Math.max(1, serv - 1))}>−</button>
              <span>{serv} порц.</span>
              <button aria-label="Больше порций" onClick={() => setServ(Math.min(24, serv + 1))}>+</button>
            </div>
            <div>
              {r.ingredients.map((g, j) => (
                <button key={j} className={"cm-ing" + (checked[j] ? " on" : "")} onClick={() => setChecked({ ...checked, [j]: !checked[j] })}>
                  <span className="cm-box">{checked[j] ? "✓" : ""}</span>
                  <span className="nm">{g.name}</span>
                  <span className="am">{scaleAmount(g.amount, k)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {i >= 0 && i < n && (
          <>
            <div className="cm-num">Шаг {i + 1} из {n}</div>
            {stageOf(r, i) && <div className="cm-stage">{stageOf(r, i)}</div>}
            <p className="cm-step">{r.steps[i]}</p>
            {stepIngredients(r, r.steps[i]).length > 0 && (
              <div className="cm-need">
                <div className="muted small">Нужно на этом шаге</div>
                {stepIngredients(r, r.steps[i]).map((g, j) => <div key={j} className="ing"><span>{g.name}</span><span className="a">{scaleAmount(g.amount, k)}</span></div>)}
              </div>
            )}
            {times.map((t, j) => (
              <button key={j} className="btn sec cm-tbtn" onClick={() => startTimer(`${r.name.slice(0, 18)} · ${t.label}`, t.seconds)}>⏱ Таймер: {t.label}</button>
            ))}
            <details className="cm-small">
              <summary>Все ингредиенты</summary>
              {r.ingredients.map((g, j) => <div key={j} className="ing"><span>{g.name}</span><span className="a">{scaleAmount(g.amount, k)}{k === 1 && weightHint(g) ? ` ${weightHint(g)}` : ""}</span></div>)}
            </details>
          </>
        )}
        {i === n && (
          <div className="center" style={{ paddingTop: 40 }}>
            <div style={{ fontSize: 64 }}>🍽️</div>
            <h2>Готово! Приятного аппетита</h2>
            <p className="muted">Спишем продукты со склада и посчитаем цену порции.</p>
            <button className="btn" onClick={() => { closeSheet(); openSheet({ kind: "cook", id: r.id }); }}>🍳 Приготовили — списать продукты</button>
          </div>
        )}
      </div>
      <div className="cm-nav">
        <button className="btn ghost" disabled={i <= -1} onClick={() => go(-1)}>← Назад</button>
        {i < n && <button className="btn" onClick={() => go(1)}>{i === -1 ? "Начать" : i === n - 1 ? "Закончить" : "Дальше →"}</button>}
      </div>
    </div>
  );
}
