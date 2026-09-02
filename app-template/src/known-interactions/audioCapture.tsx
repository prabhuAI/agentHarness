import { useEffect, useMemo, useRef, useState } from "react";
import { customStateRepository, primaryRecordLabel, type CustomFeatureProps } from "../custom-feature-api.js";

type SavedAudio = { id: string; recordId: string; dataUrl: string; duration: number };

export default function AudioCapture({ records, onSelectRecord }: CustomFeatureProps) {
  const repository = useMemo(() => customStateRepository("audio-capture"), []);
  const [selected, setSelected] = useState(records[0]?.id ?? "");
  const [saved, setSaved] = useState<SavedAudio[]>(() => repository.list().map((item) => ({
    id: item.id, recordId: String(item.values.recordId ?? ""), dataUrl: String(item.values.dataUrl ?? ""), duration: Number(item.values.duration ?? 0),
  })));
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const current = saved.find((item) => item.recordId === selected);

  useEffect(() => { if (!records.some((record) => record.id === selected)) setSelected(records[0]?.id ?? ""); }, [records, selected]);
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);

  const refresh = () => setSaved(repository.list().map((item) => ({
    id: item.id, recordId: String(item.values.recordId ?? ""), dataUrl: String(item.values.dataUrl ?? ""), duration: Number(item.values.duration ?? 0),
  })));
  const start = async () => {
    if (!selected) return;
    const targetRecordId = selected;
    setError("");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = []; started.current = Date.now(); setElapsed(0);
      const mediaRecorder = new MediaRecorder(stream.current);
      recorder.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        const duration = Math.max(.1, (Date.now() - started.current) / 1000);
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = String(reader.result ?? ""); const old = repository.list().find((item) => item.values.recordId === targetRecordId);
          if (old) repository.update(old.id, { recordId: targetRecordId, dataUrl, duration });
          else repository.create({ recordId: targetRecordId, dataUrl, duration });
          refresh();
        };
        reader.readAsDataURL(new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" }));
        stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
      };
      mediaRecorder.start(); setRecording(true);
    } catch { setError("Microphone access was unavailable. Check browser permission and try again."); }
  };
  const stop = () => { recorder.current?.stop(); setRecording(false); };
  const remove = () => { if (!current) return; repository.remove(current.id); refresh(); };
  const waveformSeed = current?.dataUrl ?? "";

  if (records.length === 0) return <section aria-label="Audio practice"><p>Add a practice record before recording audio.</p></section>;
  return <section aria-label="Audio practice" style={{ margin: "18px 0", padding: 18, border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)" }}>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 2fr", gap: 18 }}>
      <div><strong>Practice clips</strong><div role="list" style={{ display: "grid", gap: 8, marginTop: 10 }}>
        {records.map((record) => <button key={record.id} role="listitem" aria-pressed={record.id === selected} onClick={() => { setSelected(record.id); onSelectRecord(record.id); }}
          style={{ padding: 10, textAlign: "left", borderRadius: 9, border: "1px solid var(--border)", background: record.id === selected ? "var(--surface-alt)" : "var(--surface)" }}>
          {primaryRecordLabel(record)}{saved.some((item) => item.recordId === record.id) ? " · recorded" : ""}
        </button>)}
      </div></div>
      <div><div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {!recording ? <button onClick={start}>Record microphone</button> : <button onClick={stop}>Stop recording</button>}
        <output aria-live="polite">{recording ? `Recording ${elapsed.toFixed(1)}s` : current ? `${current.duration.toFixed(1)}s saved` : "No clip yet"}</output>
      </div>
      {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      <svg viewBox="0 0 520 90" role="img" aria-label="Recording waveform" style={{ display: "block", width: "100%", height: 90, margin: "14px 0", borderRadius: 10, background: "var(--surface-alt)" }}>
        {Array.from({ length: 86 }, (_, index) => { const sample = waveformSeed.charCodeAt(index % Math.max(waveformSeed.length, 1)) || 64; const height = 5 + sample % 34; return <line key={index} x1={index * 6 + 3} x2={index * 6 + 3} y1={45 - height} y2={45 + height} stroke="currentColor" strokeWidth="2" />; })}
      </svg>
      {current ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}><audio controls src={current.dataUrl}>Audio playback is unavailable.</audio><button onClick={remove}>Delete clip</button></div>
        : <p style={{ color: "var(--muted)" }}>Record a clip to play it back and compare attempts.</p>}
      </div>
    </div>
  </section>;
}
