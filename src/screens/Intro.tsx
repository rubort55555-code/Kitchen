// Знакомство при первом запуске: 4 экрана, можно пропустить; открывается снова из «Помощь».
import { useState } from "react";
import { Sheet } from "../components/ui";
import { markTip } from "../lib/store";
import { closeSheet } from "../lib/ui";

const SLIDES = [
  { icon: "🥛", title: "Что лежит дома", text: "Нажмите «+» внизу и добавьте продукт: название, количество и цену. Срок годности подставится сам. Чек можно сфотографировать — продукты добавятся сами." },
  { icon: "👆", title: "Списать — одним свайпом", text: "На экране «Продукты» проведите по продукту влево и выберите, что случилось: съели, пропало или выбросили. По этим отметкам считается статистика." },
  { icon: "🍳", title: "Что приготовить", text: "Вкладка «Рецепты» подбирает блюда из того, что уже есть, и предлагает «спасти» продукты с кончающимся сроком. Нажали «Приготовили» — продукты спишутся сами." },
  { icon: "📊", title: "Сколько пропало", text: "На главной видно, что съесть в первую очередь и сколько денег пропало за месяц. Раз в неделю сохраняйте копию данных: ⚙︎ Ещё → Данные. Везде есть значок «?» с подсказкой." },
];

export function Intro() {
  const [i, setI] = useState(0);
  const last = i === SLIDES.length - 1;
  const s = SLIDES[i];
  const done = () => { markTip("intro"); closeSheet(); };
  return (
    <Sheet title="Знакомство" right={<button className="x" onClick={done}>Пропустить</button>}>
      <div className="center" style={{ paddingTop: 24 }}>
        <div style={{ fontSize: 72 }} aria-hidden="true">{s.icon}</div>
        <h2>{s.title}</h2>
        <p style={{ fontSize: 18, lineHeight: 1.45 }}>{s.text}</p>
        <p className="muted small" aria-label={`Экран ${i + 1} из ${SLIDES.length}`}>{SLIDES.map((_, k) => (k === i ? "●" : "○")).join(" ")}</p>
      </div>
      <button className="btn" onClick={() => (last ? done() : setI(i + 1))}>{last ? "Начать" : "Далее"}</button>
      {i > 0 && <button className="btn ghost" onClick={() => setI(i - 1)}>Назад</button>}
    </Sheet>
  );
}
