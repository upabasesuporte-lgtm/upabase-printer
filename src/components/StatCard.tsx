import type { ReactNode } from "react";

// Cartão de número no padrão calmo (fundo branco, ícone cinza).
// Cor do número segue uma regra única no sistema:
//   verde  = dinheiro que entra / resultado positivo
//   vermelho = dinheiro que sai, dívida, vencido, resultado negativo
//   âmbar  = atenção (em aberto, estoque baixo)
//   azul da marca = número informativo (quantidades, ticket médio)
// Valor zero fica neutro para não chamar atenção à toa.
export type StatTone = "default" | "positive" | "negative" | "warning" | "brand";

const TONE: Record<StatTone, string> = {
  default: "#111827",
  positive: "#059669",
  negative: "#dc2626",
  warning: "#d97706",
  brand: "#2547D6",
};

const isZero = (v: ReactNode) =>
  (typeof v === "string" || typeof v === "number") && !/[1-9]/.test(String(v));

// Tom pelo significado do rótulo (usado onde os cartões são gerados em série)
export function toneFor(label: string, value: string | number): StatTone {
  const l = label.toLowerCase();
  const negativeValue = String(value).trim().startsWith("-");
  if (/resultado|saldo estimado|lucro/.test(l)) return negativeValue ? "negative" : "positive";
  if (/sangria|fiado|saldo usado|zerad|vencid|despesa|contas a pagar|gasto/.test(l)) return "negative";
  if (/alerta|desconto|a pagar|baixo|abaixo/.test(l)) return "warning";
  if (/faturamento|receita|vendas|recebid|pago|aporte|crédito|credito/.test(l)) return "positive";
  return "brand";
}

export function StatCard({ label, value, sub, icon, tone = "default", footer, compact }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode;
  tone?: StatTone; footer?: ReactNode; compact?: boolean;
}) {
  const color = TONE[isZero(value) ? "default" : tone];
  return (
    <div className={`rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${compact ? "p-4" : "p-4 sm:p-5"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 truncate">{label}</span>
        {icon && <span className="flex-shrink-0 grayscale opacity-50 [&_svg]:w-4 [&_svg]:h-4">{icon}</span>}
      </div>
      <div className={`${compact ? "text-xl" : "text-xl sm:text-2xl"} font-bold tabular-nums tracking-tight mt-1.5 break-all`} style={{ color }}>
        {value}
      </div>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {footer}
    </div>
  );
}
