import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import type { UserPlanRecord } from "../lib/plans";

// Aviso nos últimos dias do teste grátis (antes de bloquear), com o caminho para assinar
export function TrialBanner({ plan }: { plan: UserPlanRecord | null }) {
  if (!plan || plan.is_lifetime || plan.plan !== "trial" || !plan.plan_expires_at) return null;
  const days = Math.ceil((new Date(plan.plan_expires_at).getTime() - Date.now()) / 86400000);
  if (days > 5 || days <= 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50">
      <Clock className="w-5 h-5 text-amber-600 shrink-0" />
      <p className="flex-1 min-w-[200px] text-sm text-amber-900">
        <b>{days === 1 ? "Último dia" : `Faltam ${days} dias`} do seu teste grátis.</b>{" "}
        Assine para continuar usando. Seus produtos, vendas e clientes continuam salvos.
      </p>
      <Link to="/planos" className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 shrink-0" style={{ color: "#fff" }}>
        Ver planos
      </Link>
    </div>
  );
}
