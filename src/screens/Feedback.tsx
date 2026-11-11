// «Сообщить об ошибке»: ровно три способа — голос, вложения и текст. Сообщение анонимное.
import { useEffect, useRef, useState } from "react";
import { Header } from "../components/ui";
import { askConsent } from "../lib/consent";
import { FILE_ACCEPT, LIMITS, feedbackReady, fileProblem, pickAudioType, sendReport, transcribe, voiceSupported } from "../lib/feedback";
import { goPage } from "../lib/ui";
import { VERSION } from "./More";

type Voice = "idle" | "rec" | "work";

export function Feedback() {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [voice, setVoice] = useState<Voice>("idle");
  const [sec, setSec] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const rec = useRef<{ r: MediaRecorder; s: MediaStream; t: ReturnType<typeof setInterval> } | null>(null);
  const back = () => goPage(null);
  const ready = feedbackReady();

  // Ушли с экрана — микрофон выключаем
  useEffect(() => () => { if (rec.current) { clearInterval(rec.current.t); rec.current.s.getTracks().forEach((x) => x.stop()); } }, []);

  async function startVoice() {
    setMsg("");
    if (!(await askConsent("feedback"))) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = pickAudioType();
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = async () => {
        if (rec.current) clearInterval(rec.current.t);
        s.getTracks().forEach((x) => x.stop()); rec.current = null;
        const blob = new Blob(chunks, { type: r.mimeType || type || "audio/webm" });
        if (blob.size < 1000) { setVoice("idle"); return setMsg("Ничего не записалось. Скажите что-нибудь и попробуйте снова."); }
        setVoice("work");
        try {
          const said = await transcribe(blob);
          if (!said) setMsg("Речь не распознана. Попробуйте говорить ближе к телефону или напишите текстом.");
          else { setText((t) => (t.trim() ? t.trimEnd() + "\n" : "") + said); setMsg("Текст добавлен. Проверьте его и поправьте, если нужно."); }
        } catch (e) { setMsg((e as Error).message); }
        setVoice("idle");
      };
      r.start();
      let n = 0; setSec(0);
      const t = setInterval(() => { n++; setSec(n); if (n >= LIMITS.voiceSec) r.state === "recording" && r.stop(); }, 1000);
      rec.current = { r, s, t }; setVoice("rec");
    } catch {
      setMsg("Нет доступа к микрофону. Разрешите его в настройках телефона или напишите текстом.");
    }
  }
  const stopVoice = () => { if (rec.current?.r.state === "recording") rec.current.r.stop(); };

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      const p = fileProblem(f);
      if (p) bad.push(p); else if (next.length >= LIMITS.files) bad.push("Файлов должно быть не больше пяти."); else next.push(f);
    }
    setFiles(next); setMsg(bad[0] || "");
  }

  async function submit() {
    setMsg("");
    if (!text.trim() && !files.length) return setMsg("Напишите, что случилось, или приложите файл.");
    if (!(await askConsent("feedback"))) return;
    setBusy(true);
    try { await sendReport(text, files, VERSION); setSent(true); setText(""); setFiles([]); }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="screen">
        <Header title="Сообщить об ошибке" screen="more" onBack={back} backText="Ещё" />
        <div className="card" role="status"><h3>Спасибо, сообщение отправлено</h3><p className="small mt0">Оно анонимное, ответа не будет. Если проблема важная, напишите ещё раз с подробностями.</p></div>
        <button className="btn sec" onClick={() => { setSent(false); setMsg(""); }}>Написать ещё</button>
      </div>
    );
  }
  return (
    <div className="screen">
      <Header title="Сообщить об ошибке" screen="more" onBack={back} backText="Ещё" />
      <p className="muted mt0">Опишите, что пошло не так: голосом, текстом или приложите скриншот. Сообщение анонимное, но его увидят все, кто откроет страницу проекта на GitHub. Не указывайте имя, телефон и данные о здоровье.</p>
      {!ready && <p className="small" role="alert">Приём сообщений пока не подключён, отправить не получится.</p>}

      <label className="f" htmlFor="fb-text">Что случилось</label>
      <textarea id="fb-text" className="inp" style={{ minHeight: 140 }} maxLength={LIMITS.text} value={text} onChange={(e: any) => setText(e.target.value)} placeholder="Например: нажал «Добавить», а продукт не появился" />
      <p className="small muted" style={{ margin: "4px 0 0", textAlign: "right" }}>{text.length} из {LIMITS.text}</p>

      {voiceSupported() && (
        voice === "rec"
          ? <button className="btn danger" style={{ marginTop: 8 }} onClick={stopVoice} aria-label="Остановить запись">⏹ Остановить запись · {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}</button>
          : <button className="btn sec" style={{ marginTop: 8 }} disabled={voice === "work" || busy || !ready} onClick={startVoice}>{voice === "work" ? "Распознаю речь…" : "🎙 Надиктовать"}</button>
      )}

      <label className="f" htmlFor="fb-file">Скриншоты и файлы (до {LIMITS.files}, каждый до 5 МБ)</label>
      <input id="fb-file" className="inp" type="file" multiple accept={FILE_ACCEPT} onChange={(e: any) => { addFiles(e.target.files); e.target.value = ""; }} />
      {files.length > 0 && (
        <div className="list" style={{ marginTop: 8 }}>
          {files.map((f, i) => (
            <div key={f.name + i} className="li">
              <span className="ico">{f.type.startsWith("image/") ? "🖼" : "📄"}</span>
              <div className="main"><div className="name">{f.name}</div><div className="meta">{Math.max(1, Math.round(f.size / 1024))} КБ</div></div>
              <button className="link" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Убрать ${f.name}`}>Убрать</button>
            </div>
          ))}
        </div>
      )}

      {msg && <p className="small" role="status" style={{ marginTop: 10 }}>{msg}</p>}
      <button className="btn" style={{ marginTop: 14 }} disabled={busy || voice !== "idle" || !ready} onClick={submit}>{busy ? "Отправляю…" : "Отправить"}</button>
    </div>
  );
}
