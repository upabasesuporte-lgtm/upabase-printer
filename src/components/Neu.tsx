// Peças do estilo 3D suave (aro branco, face levemente afundada, sombra funda),
// usadas em Custo e Lucro, Dashboard e nas próximas telas. As classes .neu,
// .neu-sm, .neu-btn, .neu-in e .neu-lift ficam em index.css.
import type React from "react";

type IconT = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

// Cores: azul (vendas/informação), coral (custo/saída), azul-marinho, lilás, verde (lucro)
export const CARD_SKINS: Record<"sky" | "amber" | "emerald" | "red" | "violet" | "green", { tile: string; icon: string; pill: string; glow: string; value: string }> = {
  green: { tile: "linear-gradient(145deg,#e6f9ef,#c9f0dc)", icon: "#12b76a", pill: "linear-gradient(135deg,#4ade80,#12b76a)", glow: "rgba(18,183,106,.45)", value: "#0e9f5c" },
  sky: { tile: "linear-gradient(145deg,#eef0ff,#dfe3ff)", icon: "#4f5bd5", pill: "linear-gradient(135deg,#7b86f5,#4f5bd5)", glow: "rgba(79,91,213,.45)", value: "#3f4ab8" },
  amber: { tile: "linear-gradient(145deg,#fff0ee,#ffdcd8)", icon: "#f2545b", pill: "linear-gradient(135deg,#ff8a65,#f2545b)", glow: "rgba(242,84,91,.45)", value: "#e0484f" },
  emerald: { tile: "linear-gradient(145deg,#eceef5,#dadeea)", icon: "#1e2235", pill: "linear-gradient(135deg,#4b5578,#1e2235)", glow: "rgba(30,34,53,.45)", value: "#1e2235" },
  red: { tile: "linear-gradient(145deg,#ffe8ea,#ffd0d5)", icon: "#c81e3a", pill: "linear-gradient(135deg,#f2545b,#c81e3a)", glow: "rgba(200,30,58,.45)", value: "#c81e3a" },
  violet: { tile: "linear-gradient(145deg,#f3efff,#e5dcff)", icon: "#7950f2", pill: "linear-gradient(135deg,#b197fc,#7950f2)", glow: "rgba(121,80,242,.45)", value: "#6741d9" },
};
export type SkinTone = keyof typeof CARD_SKINS;

export const TIER_STYLE: Record<"ouro" | "prata" | "bronze", { bg: string; fg: string }> = {
  ouro: { bg: "#fef3c7", fg: "#92400e" },
  prata: { bg: "#f1f5f9", fg: "#334155" },
  bronze: { bg: "#ffedd5", fg: "#9a3412" },
};

// Quadradinho do ícone com relevo
export function Tile({ tone, icon: Icon, size = "md" }: { tone: SkinTone; icon: IconT; size?: "sm" | "md" }) {
  const box = size === "sm" ? "w-9 h-9 rounded-xl" : "w-10 h-10 rounded-2xl";
  return (
    <span className={`${box} flex items-center justify-center shrink-0`}
      style={{ background: CARD_SKINS[tone].tile, boxShadow: "inset 2px 2px 5px rgba(255,255,255,.85), inset -2px -2px 5px rgba(0,0,0,.06), 3px 3px 8px rgba(163,177,198,.35)" }}>
      <Icon className={size === "sm" ? "w-4 h-4" : "w-5 h-5"} style={{ color: CARD_SKINS[tone].icon }} />
    </span>
  );
}

// Cartão principal com cara de botão: ícone, valor, pílula e detalhes
export function NeuStatCard({ tone, icon: Icon, label, value, rating, ratingLabel, stats = [], sub, tier, tierTitle }: {
  tone: SkinTone; icon: IconT; label: string; value: string;
  rating?: string; ratingLabel?: string; stats?: { l: string; v: string }[]; sub?: string;
  tier?: "ouro" | "prata" | "bronze"; tierTitle?: string;
}) {
  const skin = CARD_SKINS[tone];
  return (
    <div className="neu-btn neu-lift rounded-[30px] px-4 py-3.5 min-w-0 flex flex-col gap-2.5">
      <div className="flex items-center gap-3 min-w-0">
        {/* quadradinho do ícone: aro claro e fundo afundado */}
        <span className="w-12 h-12 sm:w-14 sm:h-14 rounded-[18px] flex items-center justify-center shrink-0"
          style={{
            background: skin.tile, border: "2px solid rgba(255,255,255,.9)",
            boxShadow: "inset 3px 3px 6px rgba(0,0,0,.08), inset -2px -2px 5px rgba(255,255,255,.7), 4px 4px 10px rgba(140,152,176,.35), -3px -3px 8px rgba(255,255,255,.9)",
          }}>
          <Icon className="w-6 h-6 sm:w-7 sm:h-7" style={{ color: skin.icon }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 truncate">
            {label}
            {tier && (
              <span title={tierTitle} className="text-[9px] font-black px-1.5 py-0.5 rounded-md cursor-help normal-case tracking-normal"
                style={{ background: TIER_STYLE[tier].bg, color: TIER_STYLE[tier].fg }}>{tier}</span>
            )}
          </p>
          <p className="text-lg sm:text-2xl font-black tabular-nums tracking-tight whitespace-nowrap leading-tight" style={{ color: skin.value }}>{value}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 min-w-0">
        {rating ? (
          <span className="text-[11px] sm:text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap tabular-nums"
            style={{ background: skin.pill, color: "#fff", boxShadow: `0 6px 14px -5px ${skin.glow}, inset 0 1px 1px rgba(255,255,255,.35)` }}>
            {rating} {ratingLabel && <span className="font-medium opacity-90">{ratingLabel}</span>}
          </span>
        ) : <span className="text-[11px] text-gray-500 truncate">{sub}</span>}
        {/* pontinhos */}
        <span className="hidden sm:flex gap-1 pr-1" aria-hidden>
          {[0, 1, 2, 3].map(i => <span key={i} className="w-1 h-1 rounded-full bg-gray-300" />)}
        </span>
      </div>
      {(stats.length > 0 || (rating && sub)) && (
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-gray-500">
          {rating && sub && <span className="whitespace-nowrap">{sub}</span>}
          {stats.map(st => (
            <span key={st.l} className="whitespace-nowrap">{st.l} <b className="font-semibold text-gray-700 tabular-nums">{st.v}</b></span>
          ))}
        </div>
      )}
    </div>
  );
}
