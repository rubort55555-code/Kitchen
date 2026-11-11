// Справочник: рекомендации по питанию при мочекаменной болезни. Показывает, что именно изменилось в нормах человека, и источники.
import { Sheet } from "../components/ui";
import { useStore } from "../lib/store";
import { COND_SOURCES, DISCLAIMER, MODE_TITLE, STONE_TITLE, URGENT_AMBULANCE, URGENT_DOCTOR, rulesFor, uroStatus } from "../lib/conditions";
import { ageOf, planFor } from "../lib/nutrition";

export function ConditionSheet({ memberId }: { memberId: string }) {
  const m = useStore((s) => s.settings.members.find((x) => x.id === memberId));
  const b = m?.body;
  if (!m || !b) return <Sheet title="Справочник"><p className="empty muted">Профиль не найден.</p></Sheet>;
  const st = uroStatus(b, ageOf(b));
  const plan = planFor(b);
  const stone = st.stone;
  return (
    <Sheet title="Справочник">
      <h3 style={{ marginTop: 4 }}>{MODE_TITLE}</h3>
      <div className="issue little small">ℹ️ {DISCLAIMER}</div>
      <div className="card" style={{ borderLeft: "4px solid var(--bad)" }}>
        <h4 className="nut-h">Когда нужна помощь</h4>
        <p className="small" style={{ margin: "4px 0" }}><b>Скорая помощь (103 или 112).</b> {URGENT_AMBULANCE.replace(/^Вызовите скорую помощь \(103 или 112\): /, "")}</p>
        <p className="small" style={{ margin: "4px 0" }}><b>Врач в тот же день.</b> {URGENT_DOCTOR.replace(/^Обратитесь к врачу в тот же день: /, "")}</p>
        <p className="muted small">В таких случаях диетические советы не помогут — не откладывайте обращение.</p>
      </div>
      {!st.active ? (
        <div className="issue small">⚠️ {st.reason || "Режим не включён."} Числа питания при мочекаменной болезни приложение не применяет — следуйте назначениям врача.</div>
      ) : (
        <>
          <p className="small">Тип камней: {STONE_TITLE[stone]}. {plan?.uro && <>Что изменилось в ваших нормах: жидкость {st.fluidLimit ? "не повышается (по назначению врача)" : `${plan.uro.waterMin}–${plan.uro.waterMax} л`}, кальций {plan.uro.caMin}–{plan.uro.caMax} мг, соль не больше {plan.saltMax} г (натрий до {plan.naMax} мг){plan.uro.proteinCap ? `, белок ${plan.uro.proteinMin}–${plan.uro.proteinMax} г` : ", потолок белка не применяется"}.</>}</p>
          {st.warnings.map((w) => <div key={w} className="issue little small">⚠️ {w}</div>)}
          {rulesFor(stone, st.fluidLimit).map((r) => (
            <div key={r.id} className="card">
              <h4 className="nut-h">{r.title}</h4>
              <p className="small" style={{ margin: "4px 0" }}><b>В приложении:</b> {r.app}</p>
              <p className="small" style={{ margin: "4px 0" }}>{r.why}</p>
              <details>
                <summary className="small">Источник и уровень</summary>
                <p className="small" style={{ margin: "4px 0" }}>{r.quote}</p>
                <p className="muted small" style={{ margin: "2px 0" }}>{[r.mzLevel && `Минздрав: ${r.mzLevel}`, r.eauLevel && `EAU: ${r.eauLevel}`].filter(Boolean).join(" · ") || "Уровень в документе не указан"}</p>
                <ul className="small muted">{r.sources.map((id) => <li key={id}>{COND_SOURCES[id].cite} ({COND_SOURCES[id].edition})</li>)}</ul>
              </details>
            </div>
          ))}
          <p className="muted small">Не принимайте добавки кальция и витамина C, цитраты, травы и минеральные воды «для растворения камней» без назначения врача: приложение таких советов не даёт. Тексты и числа приведены по опубликованным рекомендациям и требуют проверки врачом-урологом перед использованием.</p>
        </>
      )}
    </Sheet>
  );
}
