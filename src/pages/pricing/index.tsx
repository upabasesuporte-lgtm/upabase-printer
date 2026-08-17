import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  ArrowRight,
  LayoutDashboard,
  Wallet,
  ShoppingCart,
  BookOpen,
  LayoutGrid,
  Package,
  Boxes,
  Truck,
  Building2,
  Users,
  Receipt,
  BarChart3,
} from "lucide-react";
import { PLAN_INFO } from "../../lib/plans";

const BLUE = "#2451f5";
const PURPLE = "#7c3aed";
const AQUA = "#0fb8a4";
const AQUA_LIGHT = "#e3faf5";
const INK = "#12141f";
const INK_SOFT = "#5b6072";
const BG_SOFT = "#f4f6fc";
const LINE = "#e4e7f2";
const MONO = "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace";

const TICKET_ITEMS = [
  "Dashboard",
  "Caixa",
  "Vendas / PDV",
  "Catálogo digital",
  "Mesas",
  "Produtos",
  "Estoque",
  "Compras",
  "Fornecedores",
  "Clientes",
  "Contas a pagar",
  "Relatórios",
  "Configurações",
];

const FEATURES_GRID = [
  { icon: LayoutDashboard, title: "Dashboard", desc: "Visão geral do negócio em tempo real." },
  { icon: Wallet, title: "Caixa", desc: "Abertura, sangria e fechamento sem dor de cabeça." },
  { icon: ShoppingCart, title: "Vendas / PDV", desc: "Ponto de venda rápido para o dia a dia." },
  { icon: BookOpen, title: "Catálogo digital", desc: "Cardápio online para pedidos sem garçom." },
  { icon: LayoutGrid, title: "Mesas", desc: "Controle de ocupação e pedidos por mesa." },
  { icon: Package, title: "Produtos", desc: "Cadastro completo, com fichas e variações." },
  { icon: Boxes, title: "Estoque", desc: "Entradas, saídas e alertas de nível baixo." },
  { icon: Truck, title: "Compras", desc: "Pedidos de reposição direto com fornecedores." },
  { icon: Building2, title: "Fornecedores", desc: "Histórico e contatos organizados." },
  { icon: Users, title: "Clientes", desc: "Base de clientes com histórico de compras." },
  { icon: Receipt, title: "Contas a pagar", desc: "Vencimentos e pagamentos sob controle." },
  { icon: BarChart3, title: "Relatórios", desc: "Números claros para decidir com dados." },
];

const FAQS = [
  {
    q: "Preciso informar cartão para testar?",
    a: "Não. Os 15 dias de teste são completamente grátis e sem cartão. Você só informa o pagamento quando decidir continuar.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Sim, sem multa e sem burocracia. Basta entrar em contato e cancelamos na hora.",
  },
  {
    q: "Funciona no celular?",
    a: "Sim. O sistema roda no navegador — computador, tablet ou celular, sem precisar instalar nada.",
  },
  {
    q: "Possui suporte?",
    a: "Sim, suporte humano via chat. Respondemos rapidamente em dias úteis para ajudar.",
  },
  {
    q: "Posso acessar de vários dispositivos?",
    a: "Sim, acesse de qualquer lugar — computador, tablet ou smartphone, tudo sincronizado.",
  },
  {
    q: "Possui cardápio digital?",
    a: "Sim, crie seu cardápio digital com fotos, descrições e preços. Compartilhe o QR Code com seus clientes.",
  },
];

const fmt = (n: number) => n.toFixed(2).replace(".", ",");

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const plan = PLAN_INFO.loja;
  const amount = isAnnual ? plan.price_annual_monthly : plan.price_monthly;
  const savingsPct = Math.round((1 - plan.price_annual_total / (plan.price_monthly * 12)) * 100);

  return (
    <div style={{ position: "relative", background: BG_SOFT, minHeight: "100vh", overflowX: "hidden" }}>
      <style>{`
        .up-dots{
          position:absolute; inset:0; z-index:0; pointer-events:none;
          background-image: radial-gradient(rgba(18,20,31,0.07) 1px, transparent 1px);
          background-size: 24px 24px;
        }
        .up-ambient{ position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; }
        .up-blob{ position:absolute; border-radius:50%; filter:blur(80px); }
        .up-blob-blue{ width:460px; height:460px; top:-160px; left:-120px; background:radial-gradient(circle, ${BLUE}, transparent 70%); opacity:.35; animation: up-float-a 17s ease-in-out infinite; }
        .up-blob-purple{ width:400px; height:400px; top:60px; right:-160px; background:radial-gradient(circle, ${PURPLE}, transparent 70%); opacity:.3; animation: up-float-b 19s ease-in-out infinite; }
        .up-blob-aqua{ width:380px; height:380px; top:520px; left:38%; background:radial-gradient(circle, ${AQUA}, transparent 70%); opacity:.28; animation: up-float-c 21s ease-in-out infinite; }
        @keyframes up-float-a{ 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(40px,50px) scale(1.06); } }
        @keyframes up-float-b{ 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(-35px,45px) scale(1.05); } }
        @keyframes up-float-c{ 0%,100%{ transform:translate(-50%,0) scale(1); } 50%{ transform:translate(-50%,-40px) scale(1.08); } }
        @media (prefers-reduced-motion: reduce){ .up-blob{ animation:none; } }

        .up-toggle-btn{ position:relative; z-index:2; border:none; background:transparent; cursor:pointer; font-weight:700; font-size:14px; padding:10px 22px; border-radius:999px; color:${INK_SOFT}; transition:color .2s ease; display:flex; align-items:center; gap:7px; font-family:inherit; }
        .up-toggle-btn.active{ color:#fff; }
        .up-toggle-thumb{ position:absolute; top:4px; left:4px; height:calc(100% - 8px); width:calc(50% - 4px); border-radius:999px; background:linear-gradient(120deg, ${BLUE}, ${PURPLE}); transition:transform .28s cubic-bezier(.65,0,.35,1); z-index:1; }

        .up-cta-btn{ display:block; text-align:center; background:linear-gradient(120deg, ${BLUE}, ${PURPLE}); color:#fff; font-weight:700; font-size:15px; padding:14px 0; border-radius:12px; box-shadow:0 14px 26px -12px rgba(36,81,245,0.55); transition:transform .15s ease, box-shadow .15s ease; border:none; cursor:pointer; text-decoration:none; }
        .up-cta-btn:hover{ transform:translateY(-2px); box-shadow:0 18px 30px -12px rgba(36,81,245,0.6); }

        .up-feat-card{ background:#fff; border:1px solid ${LINE}; border-radius:14px; padding:20px 18px; transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
        .up-feat-card:hover{ transform:translateY(-3px); box-shadow:0 16px 28px -18px rgba(18,20,31,0.25); border-color:transparent; }

        .up-grid{ display:grid; grid-template-columns:repeat(4, 1fr); gap:14px; }
        @media (max-width: 760px){ .up-grid{ grid-template-columns:repeat(2,1fr); } .up-trust{ gap:16px 22px!important; font-size:12.5px!important; } }

        .up-faq{ border-bottom:1px solid ${LINE}; padding:18px 0; }
        .up-faq summary{ cursor:pointer; font-weight:600; font-size:15.5px; list-style:none; display:flex; justify-content:space-between; align-items:center; gap:12px; color:${INK}; }
        .up-faq summary::-webkit-details-marker{ display:none; }
        .up-faq .up-plus{ width:22px; height:22px; border-radius:50%; background:${BG_SOFT}; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:15px; color:${INK_SOFT}; transition:transform .2s ease; }
        .up-faq[open] .up-plus{ transform:rotate(45deg); }
        .up-faq p{ margin-top:12px; color:${INK_SOFT}; font-size:14.5px; line-height:1.6; }
      `}</style>

      <div className="up-ambient" aria-hidden="true">
        <div className="up-blob up-blob-blue" />
        <div className="up-blob up-blob-purple" />
        <div className="up-blob up-blob-aqua" />
      </div>
      <div className="up-dots" aria-hidden="true" />

      {/* ── HERO + TOGGLE ─────────────────────────────────────────────────── */}
      <section style={{ position: "relative", zIndex: 2, padding: "44px 1rem 4px", textAlign: "center" }}>
        <h1
          style={{
            fontSize: "clamp(24px, 3.6vw, 32px)",
            fontWeight: 700,
            lineHeight: 1.15,
            maxWidth: 540,
            margin: "0 auto",
            letterSpacing: "-0.02em",
            color: INK,
          }}
        >
          Seu negócio,{" "}
          <span
            style={{
              background: `linear-gradient(100deg, ${BLUE}, ${PURPLE})`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            em um sistema só.
          </span>
        </h1>
      </section>

      <div style={{ position: "relative", zIndex: 2, display: "flex", justifyContent: "center", alignItems: "center", gap: 14, flexWrap: "wrap", margin: "22px 0 28px" }}>
        <div
          style={{
            position: "relative",
            display: "inline-flex",
            background: "#fff",
            border: `1px solid ${LINE}`,
            borderRadius: 999,
            padding: 4,
            boxShadow: "0 8px 20px -12px rgba(18,20,31,0.15)",
          }}
        >
          <div className="up-toggle-thumb" style={{ transform: isAnnual ? "translateX(100%)" : "translateX(0)" }} />
          <button className={`up-toggle-btn${!isAnnual ? " active" : ""}`} onClick={() => setIsAnnual(false)}>
            Mensal
          </button>
          <button className={`up-toggle-btn${isAnnual ? " active" : ""}`} onClick={() => setIsAnnual(true)}>
            Anual
          </button>
        </div>
        <span
          style={{
            background: AQUA_LIGHT,
            color: "#0a8a7a",
            fontSize: 12.5,
            fontWeight: 700,
            padding: "5px 11px",
            borderRadius: 999,
            whiteSpace: "nowrap",
          }}
        >
          Economize {savingsPct}% no anual
        </span>
      </div>

      {/* ── RECEIPT PRICING CARD ─────────────────────────────────────────── */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", justifyContent: "center", padding: "0 1rem 10px" }}>
        <div
          style={{
            width: "100%",
            maxWidth: 380,
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 30px 60px -25px rgba(18,20,31,0.25)",
            padding: "0 0 26px",
            transform: "rotate(-0.6deg)",
          }}
        >
          <div
            style={{
              height: 16,
              background:
                `radial-gradient(circle at 10px 0, transparent 9px, #fff 9.5px) top left/20px 16px repeat-x, ${BG_SOFT}`,
              borderRadius: "18px 18px 0 0",
            }}
          />

          <div style={{ textAlign: "center", padding: "22px 30px 16px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", color: INK_SOFT, fontWeight: 600 }}>
              UPABASE · RECIBO DO PLANO
            </div>
            <h3 style={{ fontSize: 20, marginTop: 6, color: INK }}>{plan.label}</h3>
          </div>

          <div style={{ borderTop: `1.5px dashed ${LINE}`, margin: "0 26px" }} />

          <ul style={{ padding: "16px 30px 6px", listStyle: "none" }}>
            {TICKET_ITEMS.map((item) => (
              <li key={item} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 13.5, color: INK, padding: "5px 0" }}>
                <span style={{ color: AQUA, fontWeight: 700, fontSize: 13 }}>✓</span>
                {item}
                <span style={{ flex: 1, borderBottom: "1px dotted #c9cce0", transform: "translateY(-3px)" }} />
              </li>
            ))}
          </ul>

          <div style={{ borderTop: `1.5px dashed ${LINE}`, margin: "0 26px" }} />

          <div style={{ padding: "18px 30px 4px", textAlign: "center" }}>
            <div style={{ fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: INK_SOFT, fontWeight: 600 }}>
              Total
            </div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 6, marginTop: 6, fontFamily: MONO }}>
              <span style={{ fontSize: 20, fontWeight: 600, alignSelf: "flex-start", marginTop: 4, color: INK }}>R$</span>
              <span style={{ fontSize: 46, fontWeight: 700, lineHeight: 1, color: INK }}>{fmt(amount)}</span>
              <span style={{ fontSize: 14, color: INK_SOFT, fontWeight: 500 }}>/mês</span>
            </div>
            <div style={{ fontSize: 12.5, color: INK_SOFT, marginTop: 8, minHeight: 16, fontFamily: MONO }}>
              {isAnnual ? `cobrado 1x ao ano · R$ ${fmt(plan.price_annual_total)}` : " "}
            </div>
          </div>

          <Link
            to="/auth?register=1"
            className="up-cta-btn"
            style={{ margin: "20px 30px 0", width: "calc(100% - 60px)" }}
          >
            Começar teste grátis
          </Link>
          <div style={{ textAlign: "center", fontSize: 12, color: INK_SOFT, margin: "12px 30px 0" }}>
            <b style={{ color: INK }}>15 dias grátis</b> · sem cartão de crédito
          </div>

          <div
            style={{
              margin: "20px 30px 0",
              height: 34,
              background: `repeating-linear-gradient(90deg, ${INK} 0 2px, transparent 2px 5px, ${INK} 5px 6px, transparent 6px 9px, ${INK} 9px 12px, transparent 12px 14px)`,
              opacity: 0.85,
            }}
          />
          <div
            style={{
              height: 16,
              transform: "scaleY(-1)",
              background:
                `radial-gradient(circle at 10px 0, transparent 9px, #fff 9.5px) top left/20px 16px repeat-x, ${BG_SOFT}`,
              borderRadius: "0 0 18px 18px",
            }}
          />
        </div>
      </div>

      <div className="up-trust" style={{ position: "relative", zIndex: 2, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 28, padding: "34px 0 10px", fontSize: 13.5, fontWeight: 600, color: INK_SOFT }}>
        {["15 dias grátis", "Sem cartão de crédito", "Cancele quando quiser"].map((t) => (
          <span key={t} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Check size={16} color={AQUA} strokeWidth={3} />
            {t}
          </span>
        ))}
      </div>

      {/* ── FEATURES GRID ─────────────────────────────────────────────────── */}
      <section style={{ position: "relative", zIndex: 2, padding: "90px 1rem 40px" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <div style={{ textAlign: "center", maxWidth: 600, margin: "0 auto 48px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "#0a8a7a",
                background: AQUA_LIGHT,
                padding: "7px 14px",
                borderRadius: 999,
                marginBottom: 22,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: PURPLE }} />
              Tudo incluso
            </div>
            <h2 style={{ fontSize: "clamp(26px,3.4vw,36px)", marginBottom: 12, color: INK, letterSpacing: "-0.02em" }}>
              Um sistema, do balcão ao relatório
            </h2>
            <p style={{ color: INK_SOFT, fontSize: 16 }}>Nenhum recurso fica de fora e nenhum módulo é vendido à parte.</p>
          </div>

          <div className="up-grid">
            {FEATURES_GRID.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="up-feat-card">
                <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, background: BG_SOFT, color: BLUE }}>
                  <Icon size={18} />
                </div>
                <h4 style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4, color: INK }}>{title}</h4>
                <p style={{ fontSize: 12.5, color: INK_SOFT, lineHeight: 1.45, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section style={{ position: "relative", zIndex: 2, padding: "70px 1rem" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontSize: "clamp(24px,3vw,32px)", marginBottom: 36, color: INK }}>
            Perguntas frequentes
          </h2>
          {FAQS.map((faq, i) => (
            <details key={faq.q} className="up-faq" open={i === 0}>
              <summary>
                {faq.q}
                <span className="up-plus">+</span>
              </summary>
              <p>{faq.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── FOOTER CTA ────────────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          margin: "20px 24px 24px",
          padding: "60px 24px",
          borderRadius: 28,
          textAlign: "center",
          background: "linear-gradient(135deg, #14163a, #241a4d 55%, #0f2c3f)",
          color: "#fff",
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            content: '""',
            position: "absolute",
            inset: 0,
            background: `radial-gradient(400px 240px at 50% -10%, ${AQUA}59, transparent 70%)`,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2 style={{ fontSize: "clamp(24px,3.4vw,34px)", marginBottom: 10 }}>Comece a organizar seu negócio hoje</h2>
          <p style={{ color: "#c7c9e0", fontSize: 15, marginBottom: 26 }}>
            15 dias grátis, sistema completo, sem cartão de crédito.
          </p>
          <Link to="/auth?register=1" className="up-cta-btn" style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "auto", padding: "15px 34px" }}>
            Começar teste grátis <ArrowRight size={16} />
          </Link>
        </div>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer style={{ position: "relative", zIndex: 2, textAlign: "center", padding: "0 1rem 40px" }}>
        <p style={{ fontSize: 12, color: INK_SOFT, marginBottom: 12 }}>
          © {new Date().getFullYear()} Upabase · Pagamentos via{" "}
          <span style={{ fontWeight: 600, color: BLUE }}>Mercado Pago</span> · Dados seguros com{" "}
          <span style={{ fontWeight: 600, color: BLUE }}>Supabase</span>
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
          <Link to="/privacy" style={{ fontSize: 11, color: INK_SOFT, textDecoration: "none" }}>
            Privacidade
          </Link>
          <Link to="/terms" style={{ fontSize: 11, color: INK_SOFT, textDecoration: "none" }}>
            Termos
          </Link>
          <Link to="/auth" style={{ fontSize: 11, color: INK_SOFT, textDecoration: "none" }}>
            Entrar
          </Link>
        </div>
      </footer>
    </div>
  );
}
