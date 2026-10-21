import type { ReactNode } from "react";

// Título das abas em linha única (sem o quadro grande) com as ações à direita.
// Padrão visual definido no piloto da aba Estoque.
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
        {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

// Abas/alternância no padrão da marca (fundo cinza, selecionada branca)
export const segWrap = "flex p-1 bg-gray-200/60 rounded-xl";
export const segBtn = (active: boolean) =>
  `flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${active ? "bg-white text-brand-700 shadow-sm" : "text-gray-500 hover:text-gray-800"}`;

// Botões no padrão da marca. Texto branco vai por style porque o tema claro
// reescreve a classe text-white.
export const btnPrimary = "inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
export const btnSecondary = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border border-gray-200 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors";
export const WHITE_TEXT = { color: "#fff" } as const;
