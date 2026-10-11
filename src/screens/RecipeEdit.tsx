// Свои рецепты: вручную, из вставленного текста или с фото страницы книги.
import { useMemo, useRef, useState } from "react";
import { Sheet } from "../components/ui";
import { compressPhoto } from "../lib/photo";
import { saveRecipes, useStore } from "../lib/store";
import { applyReplace, checkRecipe, compileRules } from "../lib/exclusions";
import { parseRecipeText, type RecipeDraft } from "../lib/recipeText";
import { prepareImage, recognize, statusText } from "../lib/ocr";
import type { Recipe } from "../lib/types";
import { closeSheet, openSheet, toast } from "../lib/ui";
import { toNum, uid } from "../lib/util";

const KINDS = ["завтрак", "суп", "салат", "основное", "гарнир", "выпечка", "десерт", "закуска", "соус", "напиток"];

/** Выбор способа: вручную, вставить текст, фото страницы. */
export function RecipeNew({ mode }: { mode: "menu" | "text" | "photo" }) {
  const settings = useStore((s) => s.settings);
  const [stage, setStage] = useState<"menu" | "text" | "busy">(mode === "text" ? "text" : "menu");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [prog, setProg] = useState({ status: "", progress: 0 });
  const [fromPhoto, setFromPhoto] = useState(false);
  const [rot, setRot] = useState<0 | 90 | 180 | 270>(0);
  const file = useRef<File | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const toEditor = (d: RecipeDraft) => { closeSheet(); openSheet({ kind: "recipeEdit", draft: d }); };

  async function run(f: File, r: 0 | 90 | 180 | 270) {
    setErr(""); setStage("busy"); setProg({ status: "", progress: 0 });
    try {
      const t = await recognize(await prepareImage(f, r), setProg);
      setText(t); setFromPhoto(true);
      if (!t.trim()) setErr("Текст на фото не найден. Сфотографируйте ближе, при хорошем свете, или поверните фото.");
    } catch (e: any) {
      setErr("Не получилось распознать фото. " + (e?.message || ""));
    }
    setStage("text");
  }
  const onFile = (e: any) => { const f: File | undefined = e.target.files?.[0]; e.target.value = ""; if (!f) return; file.current = f; setRot(0); run(f, 0); };

  function parse() {
    const d = parseRecipeText(text, settings.customCatalog);
    if (!d.ingredients.length && !d.steps.length) { setErr("Не нашёл ни ингредиентов, ни шагов. Вставьте текст рецепта целиком: название, ингредиенты и способ приготовления."); return; }
    toEditor(d);
  }

  return (
    <Sheet title="Новый рецепт">
      {stage === "menu" && (
        <div style={{ paddingTop: 8 }}>
          <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          <button className="btn" onClick={() => toEditor({ name: "", ingredients: [{ name: "", amount: "" }], steps: [] })}>✍️ Написать самому</button>
          <button className="btn sec" onClick={() => setStage("text")}>📋 Вставить текст рецепта</button>
          <button className="btn sec" onClick={() => input.current?.click()}>📷 Сфотографировать страницу книги</button>
          <button className="btn ghost" onClick={() => { closeSheet(); openSheet({ kind: "ask" }); }}>✨ Придумать рецепт с ИИ</button>
          <p className="muted small">Текст можно взять с сайта, из заметок или мессенджера. Приложение само найдёт название, ингредиенты и шаги — вы сможете всё проверить и исправить.</p>
        </div>
      )}
      {stage === "busy" && (
        <div className="center" style={{ paddingTop: 40 }}>
          <div style={{ fontSize: 48 }}>📖</div>
          <h2>{statusText(prog.status)}</h2>
          <div className="split" style={{ height: 12 }}><i style={{ width: Math.max(4, Math.round(prog.progress * 100)) + "%" }} /></div>
          <p className="muted small">В первый раз скачивается русский язык (около 12 МБ). Не закрывайте приложение.</p>
        </div>
      )}
      {stage === "text" && (
        <>
          <h2 style={{ marginTop: 10 }}>{fromPhoto ? "Что прочитано" : "Вставьте текст рецепта"}</h2>
          <p className="muted mt0">{fromPhoto ? "Проверьте текст и исправьте ошибки, если они есть." : "Скопируйте рецепт и вставьте сюда: нажмите в поле и выберите «Вставить»."}</p>
          <textarea className="inp" rows={12} value={text} onChange={(e: any) => setText(e.target.value)} placeholder={"Название\n\nИнгредиенты:\n- 200 г муки\n- 2 яйца\n\nПриготовление:\n1. Смешайте…"} aria-label="Текст рецепта" />
          {err && <p className="err" role="alert">{err}</p>}
          <button className="btn" disabled={!text.trim()} onClick={parse}>Разобрать</button>
          {!text.trim() && <button className="btn sec" onClick={async () => { try { setText(await navigator.clipboard.readText()); } catch { setErr("Не удалось вставить автоматически — нажмите в поле и выберите «Вставить»."); } }}>📋 Вставить из буфера</button>}
          {file.current && <button className="btn ghost" onClick={() => { const r = (((rot + 90) % 360) as 0 | 90 | 180 | 270); setRot(r); run(file.current!, r); }}>↻ Повернуть фото и прочитать заново</button>}
        </>
      )}
    </Sheet>
  );
}

/** Редактор рецепта: новый (draft) или существующий (id). */
export function RecipeEdit({ id, draft }: { id?: string; draft?: RecipeDraft }) {
  const { recipes, settings } = useStore((s) => s);
  const old = id ? recipes.find((r) => r.id === id) : undefined;
  const init: RecipeDraft = draft || (old ? { name: old.name, minutes: old.minutes, servings: old.servings, kind: old.kind, ingredients: old.ingredients.map((i) => ({ ...i })), steps: [...old.steps] } : { name: "", ingredients: [{ name: "", amount: "" }], steps: [] });
  const [name, setName] = useState(init.name);
  const [minutes, setMinutes] = useState(init.minutes ? String(init.minutes) : "");
  const [servings, setServings] = useState(init.servings ? String(init.servings) : "2");
  const [kind, setKind] = useState(init.kind || "основное");
  const [ings, setIngs] = useState(init.ingredients.length ? init.ingredients : [{ name: "", amount: "" }]);
  const [steps, setSteps] = useState(init.steps.join("\n"));
  const [err, setErr] = useState("");
  const [photo, setPhoto] = useState<string | undefined>(old?.photo);
  const photoIn = useRef<HTMLInputElement>(null);
  async function onPhoto(e: any) {
    const f: File | undefined = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try { setPhoto(await compressPhoto(f)); } catch { setErr("Не получилось прочитать фото. Попробуйте другое."); }
  }

  const compiled = useMemo(() => compileRules(settings.rules, settings.customCatalog, settings.members), [settings]);
  const who = settings.members.map((m) => m.id);
  const cur: Recipe = { id: old?.id || "tmp", name, ingredients: ings.filter((i) => i.name.trim()), steps: steps.split("\n").map((s) => s.trim()).filter(Boolean), source: "manual", createdAt: 0 };
  const chk = checkRecipe(cur, compiled, who);

  const setIng = (k: number, p: Partial<{ name: string; amount: string }>) => setIngs((a) => a.map((x, i) => (i === k ? { ...x, ...p } : x)));
  const replaceWord = (word: string, to: string) => {
    const r = applyReplace(cur, word, to);
    setName(r.name); setIngs(r.ingredients.length ? r.ingredients : [{ name: "", amount: "" }]); setSteps(r.steps.join("\n"));
    toast(`Заменено на: ${to}`);
  };

  function save() {
    if (!name.trim()) { setErr("Впишите название рецепта."); return; }
    if (!cur.ingredients.length) { setErr("Добавьте хотя бы один ингредиент."); return; }
    if (!cur.steps.length) { setErr("Добавьте хотя бы один шаг приготовления."); return; }
    const r: Recipe = {
      ...(old || { id: uid(), source: "manual" as const, createdAt: Date.now() }),
      source: old && old.source === "base" ? "manual" : (old?.source || "manual"),
      photo,
      name: name.trim(), kind, minutes: toNum(minutes) || undefined, servings: toNum(servings) || 2,
      ingredients: cur.ingredients.map((i) => ({ name: i.name.trim(), amount: i.amount.trim() })), steps: cur.steps,
    };
    saveRecipes([r]);
    closeSheet();
    toast(old ? "Рецепт сохранён" : `Рецепт добавлен: ${r.name}`);
    if (!old) openSheet({ kind: "recipe", id: r.id });
  }

  return (
    <Sheet title={old ? "Изменить рецепт" : "Проверьте рецепт"}>
      <label className="f" htmlFor="rn">Название</label>
      <input id="rn" className="inp big" value={name} onChange={(e: any) => { setName(e.target.value); setErr(""); }} placeholder="Например, Сырники" />
      <input ref={photoIn} type="file" accept="image/*" hidden onChange={onPhoto} aria-label="Фото блюда" />
      {photo && <img className="dphoto" src={photo} alt="Фото блюда" />}
      <div className="row2">
        <button type="button" className="btn sec" onClick={() => photoIn.current?.click()}>{photo ? "📷 Другое фото блюда" : "📷 Фото блюда"}</button>
        {photo && <button type="button" className="btn ghost" onClick={() => setPhoto(undefined)}>Убрать фото</button>}
      </div>
      <div className="field-row">
        <div><label className="f" htmlFor="rm">Минут</label><input id="rm" className="inp" inputMode="numeric" value={minutes} onChange={(e: any) => setMinutes(e.target.value)} /></div>
        <div><label className="f" htmlFor="rs">Порций</label><input id="rs" className="inp" inputMode="numeric" value={servings} onChange={(e: any) => setServings(e.target.value)} /></div>
        <div><label className="f" htmlFor="rk">Вид блюда</label><select id="rk" className="inp" value={kind} onChange={(e: any) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
      </div>

      {chk.issues.map((i, k) => (
        <div key={k} className={"issue" + (i.rule.level === "little" && chk.verdict !== "hidden" ? " little" : "")}>
          {i.rule.level === "little" && chk.verdict !== "hidden" ? "🌻 " : "⚠️ "}{i.msg}
          {i.replace && <button className="btn sec" onClick={() => replaceWord(i.word, i.replace!)}>Заменить на {i.replace}</button>}
        </div>
      ))}
      {chk.verdict === "hidden" && <p className="muted small">Такой рецепт можно сохранить, но в подборе он показываться не будет.</p>}

      <h3 style={{ marginTop: 16 }}>Ингредиенты</h3>
      {ings.map((g, k) => (
        <div key={k} className="field-row" style={{ alignItems: "center" }}>
          <div style={{ flex: 3 }}><input className="inp" value={g.name} onChange={(e: any) => setIng(k, { name: e.target.value })} placeholder="Продукт" aria-label={`Ингредиент ${k + 1}`} /></div>
          <div style={{ flex: 2 }}><input className="inp" value={g.amount} onChange={(e: any) => setIng(k, { amount: e.target.value })} placeholder="200 г" aria-label={`Количество ${k + 1}`} /></div>
          <button type="button" className="ib" aria-label="Убрать ингредиент" onClick={() => setIngs((a) => (a.length > 1 ? a.filter((_, i) => i !== k) : [{ name: "", amount: "" }]))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn ghost" onClick={() => setIngs((a) => [...a, { name: "", amount: "" }])}>+ Ингредиент</button>
      <p className="muted small">Количества пишите так: «200 г», «2 шт», «1 ст. л.», «500 мл», «по вкусу» — тогда рецепт сможет считать, чего не хватает, и списывать продукты.</p>

      <h3 style={{ marginTop: 16 }}>Как готовить</h3>
      <textarea className="inp" rows={8} value={steps} onChange={(e: any) => setSteps(e.target.value)} placeholder={"Каждый шаг — с новой строки"} aria-label="Шаги" />
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" style={{ marginTop: 12 }} onClick={save}>Сохранить рецепт</button>
    </Sheet>
  );
}
