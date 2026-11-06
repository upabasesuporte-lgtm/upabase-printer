import type { ReactNode } from "react";

// Título das abas em linha única (sem o quadro grande) com as ações à direita.
// Padrão visual definido no piloto da aba Estoque.
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="neu rounded-[26px] px-4 py-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-black text-[#1e2235] tracking-tight">{title}</h1>
        {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

// Abas/alternância no padrão 3D suave (trilho afundado, escolhida em relevo azul suave)
export const segWrap = "flex gap-1 p-1.5 neu-in rounded-2xl";
export const segBtn = (active: boolean) =>
  `flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${active ? "neu-sm text-brand-700" : "border-2 border-transparent text-gray-500 hover:text-gray-800"}`;

// Botões no padrão da marca. Texto branco vai por style porque o tema claro
// reescreve a classe text-white.
export const btnPrimary = "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-brand-600 hover:bg-brand-700 shadow-[0_6px_14px_-6px_rgba(49,93,251,.6)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
export const btnSecondary = "neu-sm neu-lift inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-semibold text-gray-700 hover:text-[#1e2235] disabled:opacity-40";
export const WHITE_TEXT = { color: "#fff" } as const;
