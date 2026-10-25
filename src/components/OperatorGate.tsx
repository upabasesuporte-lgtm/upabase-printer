// Tela "Quem está operando?" + janela de PIN para ações sensíveis.
// Só aparece quando a conta tem operadores cadastrados (ver lib/operators.ts).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, ShieldCheck, User, X, Delete } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";
import {
  useOperators, operatorsEnabled, setCurrentOperator, finishApproval,
  verifyOperatorPin, verifyManagerPin, ROLE_LABEL, type Operator,
} from "../lib/operators";

function PinPad({ value, onChange, onSubmit, isLight }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; isLight: boolean;
}) {
  // Teclado físico também funciona (números, Backspace, Enter). Captura antes
  // dos atalhos das páginas (ex.: Enter/F1 do PDV) para nada disparar por trás.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); if (value.length < 6) onChange(value + e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); onChange(value.slice(0, -1)); }
      else if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
      else if (e.key !== "Escape") e.preventDefault();
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [value, onChange, onSubmit]);

  const key = isLight
    ? "bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-900"
    : "bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white";
  return (
    <div>
      <div className="flex justify-center gap-2.5 mb-5 h-4">
        {Array.from({ length: Math.max(4, value.length) }).map((_, i) => (
          <span key={i} className="w-3.5 h-3.5 rounded-full transition-colors"
            style={{ background: i < value.length ? "#315DFB" : isLight ? "#E5E7EB" : "#3f3f46" }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {["1","2","3","4","5","6","7","8","9"].map(n => (
          <button key={n} type="button" onClick={() => value.length < 6 && onChange(value + n)}
            className={`h-14 rounded-xl text-xl font-bold transition-colors ${key}`}>{n}</button>
        ))}
        <button type="button" onClick={() => onChange("")} className={`h-14 rounded-xl text-xs font-semibold ${key}`}>Limpar</button>
        <button type="button" onClick={() => value.length < 6 && onChange(value + "0")} className={`h-14 rounded-xl text-xl font-bold ${key}`}>0</button>
        <button type="button" onClick={() => onChange(value.slice(0, -1))} className={`h-14 rounded-xl flex items-center justify-center ${key}`}>
          <Delete className="w-5 h-5" />
        </button>
      </div>
      <button type="button" onClick={onSubmit} disabled={value.length < 4}
        className="mt-3 w-full h-12 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-opacity"
        style={{ background: "linear-gradient(135deg, #7C3FFA 0%, #315DFB 55%, #00B8C8 100%)" }}>
        Entrar
      </button>
    </div>
  );
}

export function OperatorGate() {
  const s = useOperators();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const [picked, setPicked] = useState<Operator | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const locked = operatorsEnabled(s) && !s.current;
  useEffect(() => { if (!locked) { setPicked(null); setPin(""); setErr(null); } }, [locked]);
  useEffect(() => { setPin(""); setErr(null); }, [s.approval]);

  const panel = isLight ? "bg-white border border-gray-200" : "bg-zinc-900 border border-zinc-800";
  const text = isLight ? "text-gray-900" : "text-white";
  const muted = isLight ? "text-gray-500" : "text-zinc-400";

  async function submitLogin() {
    if (!picked || pin.length < 4 || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await verifyOperatorPin(picked.id, pin);
      if (r.ok) setCurrentOperator(picked);
      else { setErr("PIN incorreto"); setPin(""); }
    } catch (e: any) { setErr("Erro ao conferir PIN: " + (e?.message ?? e)); }
    finally { setBusy(false); }
  }

  async function submitApproval() {
    if (pin.length < 4 || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await verifyManagerPin(pin);
      if (r.ok) finishApproval(true);
      else { setErr("PIN de dono/gerente incorreto"); setPin(""); }
    } catch (e: any) { setErr("Erro ao conferir PIN: " + (e?.message ?? e)); }
    finally { setBusy(false); }
  }

  if (locked) {
    return createPortal(
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: isLight ? "rgba(243,244,246,0.97)" : "rgba(9,9,11,0.97)" }}>
        <div className={`w-full max-w-sm rounded-3xl p-6 shadow-2xl ${panel}`}>
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4" style={{ color: "#315DFB" }} />
            <h2 className={`text-lg font-black ${text}`}>Quem está operando?</h2>
          </div>
          {!picked ? (
            <>
              <p className={`text-xs mb-4 ${muted}`}>Toque no seu nome</p>
              <div className="grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-auto">
                {s.operators.map(o => (
                  <button key={o.id} onClick={() => { setPicked(o); setPin(""); setErr(null); }}
                    className={`rounded-2xl p-3 text-left transition-colors ${isLight ? "bg-gray-50 hover:bg-gray-100 border border-gray-200" : "bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"}`}>
                    <User className="w-4 h-4 mb-1.5" style={{ color: "#315DFB" }} />
                    <p className={`text-sm font-bold truncate ${text}`}>{o.name}</p>
                    <p className={`text-[11px] ${muted}`}>{ROLE_LABEL[o.role]}</p>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <button onClick={() => { setPicked(null); setPin(""); setErr(null); }} className={`text-xs mb-4 underline ${muted}`}>
                ← trocar ({picked.name} · {ROLE_LABEL[picked.role]})
              </button>
              <p className={`text-xs mb-3 ${muted}`}>Digite seu PIN</p>
              <PinPad value={pin} onChange={setPin} onSubmit={submitLogin} isLight={isLight} />
            </>
          )}
          {err && <p className="text-xs text-red-500 mt-3 text-center font-semibold">{err}</p>}
        </div>
      </div>,
      document.body,
    );
  }

  if (s.approval) {
    return createPortal(
      <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/60">
        <div className={`w-full max-w-sm rounded-3xl p-6 shadow-2xl ${panel}`}>
          <div className="flex items-start gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 mt-0.5" style={{ color: "#315DFB" }} />
            <div className="flex-1">
              <h2 className={`text-base font-black ${text}`}>Autorização necessária</h2>
              <p className={`text-xs mt-0.5 ${muted}`}>{s.approval.reason} — peça o PIN do dono ou gerente.</p>
            </div>
            <button onClick={() => finishApproval(false)} className={muted}><X className="w-5 h-5" /></button>
          </div>
          <div className="mt-4">
            <PinPad value={pin} onChange={setPin} onSubmit={submitApproval} isLight={isLight} />
          </div>
          {err && <p className="text-xs text-red-500 mt-3 text-center font-semibold">{err}</p>}
        </div>
      </div>,
      document.body,
    );
  }

  return null;
}
