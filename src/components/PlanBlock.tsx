import { useNavigate } from "react-router-dom";
import { Lock, LogOut, ArrowRight, AlertTriangle } from "lucide-react";
import type { UserPlanRecord } from "../lib/plans";
import { isPlanValid } from "../lib/plans";

interface Props {
  plan: UserPlanRecord | null;
  userEmail: string | null;
  onLogout: () => void;
}

export function PlanBlock({ plan, userEmail, onLogout }: Props) {
  const navigate = useNavigate();

  const isSuspended  = plan?.plan === "suspended";
  const isExpired    = plan && !isPlanValid(plan) && !isSuspended;
  const hasNoPlan    = !plan;

  const title = isSuspended
    ? "Assinatura Suspensa"
    : isExpired
      ? "Seu período de trial encerrou"
      : "Acesso necessário";

  const subtitle = isSuspended
    ? "Sua assinatura foi suspensa. Renove para continuar usando o sistema."
    : isExpired
      ? "Os 15 dias grátis terminaram. Escolha um plano para continuar."
      : "Você precisa de um plano ativo para acessar o sistema.";

  return (
    <div style={{
      minHeight: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      textAlign: "center",
      background: "transparent",
    }}>
      <div style={{
        background: "#18181b",
        border: "1px solid rgba(39,39,42,0.8)",
        borderRadius: 24,
        padding: "48px 40px",
        maxWidth: 460,
        width: "100%",
        boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: "50%",
          background: isSuspended
            ? "rgba(239,68,68,0.12)"
            : "rgba(245,158,11,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 20px",
          border: isSuspended
            ? "1px solid rgba(239,68,68,0.3)"
            : "1px solid rgba(245,158,11,0.3)",
        }}>
          {isSuspended
            ? <AlertTriangle size={28} style={{ color: "#ef4444" }} />
            : <Lock size={28} style={{ color: "#f59e0b" }} />}
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 10 }}>
          {title}
        </h2>
        <p style={{ fontSize: 14, color: "#71717a", lineHeight: 1.6, marginBottom: 32 }}>
          {subtitle}
        </p>

        {userEmail && (
          <p style={{ fontSize: 12, color: "#52525b", marginBottom: 24 }}>
            Conta: {userEmail}
          </p>
        )}

        <button
          onClick={() => navigate("/planos")}
          style={{
            width: "100%",
            padding: "14px 0",
            background: "linear-gradient(135deg,#7B2FBE,#00B4D8)",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 12,
            boxShadow: "0 4px 16px rgba(123,47,190,0.4)",
          }}
        >
          Ver Planos e Preços <ArrowRight size={16} />
        </button>

        <button
          onClick={onLogout}
          style={{
            width: "100%",
            padding: "10px 0",
            background: "transparent",
            color: "#52525b",
            border: "1px solid rgba(63,63,70,0.5)",
            borderRadius: 12,
            fontWeight: 500,
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <LogOut size={14} /> Sair da conta
        </button>
      </div>
    </div>
  );
}
