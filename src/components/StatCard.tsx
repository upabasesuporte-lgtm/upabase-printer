import type { ReactNode } from "react";

// Cartão de número no padrão calmo (fundo branco, número escuro).
// A cor só aparece quando diz algo: tone pinta o número; o ícone fica cinza.
export type StatTone = "default" | "positive" | "negative" | "warning" | "brand";

const TONE: Record<StatTone, string> = {
  default: "#111827",
  positive: "#059669",
  negative: "#dc2626",
  warning: "#d97706",
  brand: "#2547D6",
};

export function StatCard({ label, value, sub, icon, tone = "default", footer, compact }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode;
  tone?: StatTone; footer?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={`rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${compact ? "p-4" : "p-4 sm:p-5"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 truncate">{label}</span>
        {icon && <span className="flex-shrink-0 grayscale opacity-50 [&_svg]:w-4 [&_svg]:h-4">{icon}</span>}
      </div>
      <div className={`${compact ? "text-xl" : "text-xl sm:text-2xl"} font-bold tabular-nums tracking-tight mt-1.5 break-all`} style={{ color: TONE[tone] }}>
        {value}
      </div>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {footer}
    </div>
  );
}
