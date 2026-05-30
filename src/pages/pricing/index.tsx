import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Check, X, ChevronDown, ArrowRight, Star,
  BarChart3, Package, Wallet, ShoppingBag, QrCode, Store,
  Zap, Lock, Headphones, Shield, Cloud, RefreshCw,
} from "lucide-react";
import { PLAN_INFO, PlanType, getMpCheckoutUrl } from "../../lib/plans";
import { supabase } from "../../lib/supabase";

// ─── Constantes ───────────────────────────────────────────────────────────────

const PRIMARY = "#7B2FBE";
const GRAD    = "linear-gradient(135deg,#7B2FBE,#00B4D8)";
const PLAN_ORDER: PlanType[] = ["loja", "delivery", "pro"];

const ANNUAL_SAVINGS: Record<PlanType, number> = {
  loja:     (59.90 - 49.90) * 12,   // 120
  delivery: (79.90 - 65.90) * 12,   // 168
  pro:      (97.00 - 79.90) * 12,   // 205.20
};

// ─── Dados estáticos ──────────────────────────────────────────────────────────

const TRUST_BADGES = [
  "✓ 15 dias grátis",
  "✓ Sem cartão de crédito",
  "✓ Cancele quando quiser",
  "✓ Suporte humano",
];

const COMPARISON_FEATURES = [
  { label: "Dashboard completo",   loja: true,  delivery: true,  pro: true  },
  { label: "PDV (Ponto de Venda)", loja: true,  delivery: true,  pro: true  },
  { label: "Controle de estoque",  loja: true,  delivery: true,  pro: true  },
  { label: "Financeiro",           loja: true,  delivery: true,  pro: true  },
  { label: "Relatórios",           loja: true,  delivery: true,  pro: true  },
  { label: "Cardápio digital",     loja: false, delivery: true,  pro: true  },
  { label: "QR Code",              loja: false, delivery: true,  pro: true  },
  { label: "Pedidos online",       loja: false, delivery: true,  pro: true  },
  { label: "Chat com cliente",     loja: false, delivery: true,  pro: true  },
  { label: "Gestão de mesas",      loja: false, delivery: false, pro: true  },
  { label: "Comandas",             loja: false, delivery: false, pro: true  },
  { label: "Atendimento no salão", loja: false, delivery: false, pro: true  },
];

const DIFFERENTIALS = [
  { icon: BarChart3,   emoji: "📈", title: "Relatórios Inteligentes",  desc: "Acompanhe vendas e resultados em tempo real." },
  { icon: Package,     emoji: "📦", title: "Controle de Estoque",      desc: "Evite perdas e mantenha tudo organizado." },
  { icon: Wallet,      emoji: "💰", title: "Gestão Financeira",        desc: "Controle entradas, saídas e lucro." },
  { icon: ShoppingBag, emoji: "🍔", title: "Pedidos Online",           desc: "Receba pedidos sem depender de marketplaces." },
  { icon: QrCode,      emoji: "📱", title: "Cardápio Digital",         desc: "QR Code para acesso rápido dos clientes." },
  { icon: Store,       emoji: "🏪", title: "Gestão Completa",          desc: "Tudo centralizado em um único lugar." },
];

const GUARANTEES = [
  { icon: Zap,         title: "15 dias grátis",       desc: "Teste todas as funcionalidades." },
  { icon: Lock,        title: "Cancele quando quiser", desc: "Sem fidelidade." },
  { icon: Headphones,  title: "Suporte humano",        desc: "Atendimento rápido." },
  { icon: Shield,      title: "Dados seguros",         desc: "Criptografia e proteção avançada." },
  { icon: Cloud,       title: "Backup automático",     desc: "Seus dados protegidos diariamente." },
  { icon: RefreshCw,   title: "Sistema em nuvem",      desc: "Acesse de qualquer lugar." },
];

const FAQS = [
  { q: "Preciso de cartão para testar?",
    a: "Não. Os 15 dias de teste são completamente grátis e sem cartão. Você só informa o pagamento quando decidir continuar." },
  { q: "Posso cancelar quando quiser?",
    a: "Sim, sem multa e sem burocracia. Basta entrar em contato e cancelamos na hora." },
  { q: "Funciona no celular?",
    a: "Sim. O sistema roda no navegador — computador, tablet ou celular, sem precisar instalar nada." },
  { q: "Preciso instalar algo?",
    a: "Não. É 100% online. Basta abrir o navegador e acessar. Funciona em qualquer dispositivo." },
  { q: "Meus dados ficam seguros?",
    a: "Sim. Utilizamos criptografia avançada e backup automático diário. Seus dados são protegidos com a infraestrutura do Supabase." },
  { q: "Como funciona o suporte?",
    a: "Suporte humano via chat. Respondemos rapidamente em dias úteis para ajudar com configuração, dúvidas e tudo mais." },
  { q: "Posso migrar para outro plano depois?",
    a: "Sim. Entre em contato com o suporte e migramos seu plano sem perda de dados." },
  { q: "Quanto tempo dura o teste grátis?",
    a: "15 dias com acesso completo a todas as funcionalidades, sem nenhum custo e sem precisar informar cartão." },
];

// ─── Componente principal ────────────────────────────────────────────────────

export default function PricingPage() {
  const [annual,      setAnnual]      = useState(false);
  const [openFaq,     setOpenFaq]     = useState<number | null>(null);
  const [userEmail,   setUserEmail]   = useState<string | null>(null);
  const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
  const [hoveredCta,  setHoveredCta]  = useState<string | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  // Injetar keyframes CSS para animações
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(24px); }
        to   { opacity: 1; transform: translateY(0);    }
      }
      @keyframes shimmer {
        0%   { background-position: -200% center; }
        100% { background-position:  200% center; }
      }
      @keyframes float {
        0%, 100% { transform: translateY(0);   }
        50%      { transform: translateY(-6px); }
      }
      .pricing-hero    { animation: fadeInUp 0.6s ease both; }
      .pricing-plans   { animation: fadeInUp 0.6s ease 0.15s both; }
      .pricing-section { animation: fadeInUp 0.6s ease 0.3s both; }
      .plan-card-highlight { animation: float 4s ease-in-out infinite; }
    `;
    document.head.appendChild(style);
    styleRef.current = style;
    return () => { if (styleRef.current) document.head.removeChild(styleRef.current); };
  }, []);

  const fmt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ background: "#F8F9FA", minHeight: "100vh", fontFamily: "inherit", overflowX: "hidden" }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(248,249,250,0.9)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 24px",
      }}>
        <img
          src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2021%20de%20mai.%20de%202026,%2019_48_48.png"
          alt="Logo" style={{ height: 52, width: "auto" }}
        />
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link to="/auth" style={{ fontSize: 13, fontWeight: 600, color: "#6B7280", textDecoration: "none" }}>
            Entrar
          </Link>
          <Link to="/auth?register=1" style={{
            fontSize: 13, fontWeight: 700, color: "#fff",
            background: GRAD, padding: "8px 18px", borderRadius: 10,
            textDecoration: "none", boxShadow: "0 2px 10px rgba(123,47,190,0.3)",
          }}>
            Testar grátis
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="pricing-hero" style={{
        textAlign: "center",
        padding: "64px 1rem 0",
        background: "linear-gradient(180deg,rgba(123,47,190,0.04) 0%,transparent 100%)",
      }}>
        {/* Logo grande */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <img
            src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2021%20de%20mai.%20de%202026,%2019_48_48.png"
            alt="Logo" style={{ height: 160, width: "auto" }}
          />
        </div>

        {/* Badge de destaque */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(123,47,190,0.08)", border: "1px solid rgba(123,47,190,0.2)",
          borderRadius: 999, padding: "5px 14px", marginBottom: 20,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: PRIMARY }}>15 dias grátis · Sem cartão</span>
        </div>

        {/* Título */}
        <h1 style={{
          fontSize: "clamp(28px, 5vw, 52px)", fontWeight: 900, lineHeight: 1.15,
          color: "#0f172a", margin: "0 auto 16px", maxWidth: 700, letterSpacing: "-0.02em",
        }}>
          Controle seu negócio em{" "}
          <span style={{ background: GRAD, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", display: "inline-block" }}>
            um único sistema
          </span>
        </h1>

        {/* Subtítulo */}
        <p style={{
          fontSize: "clamp(15px, 2vw, 18px)", color: "#6B7280",
          maxWidth: 560, margin: "0 auto 32px", lineHeight: 1.6,
        }}>
          Gestão completa para lojas, restaurantes e delivery. Controle vendas, estoque,
          financeiro, pedidos online e muito mais.
        </p>

        {/* Selos de confiança */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "8px 20px",
          justifyContent: "center", marginBottom: 40,
        }}>
          {TRUST_BADGES.map(b => (
            <span key={b} style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{b}</span>
          ))}
        </div>

        {/* Toggle Mensal / Anual */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 56 }}>
          <div style={{
            display: "inline-flex", background: "#e5e7eb",
            borderRadius: 14, padding: 4, gap: 2, position: "relative",
          }}>
            {[
              { label: "Mensal", isAnnual: false },
              { label: "Anual",  isAnnual: true  },
            ].map(({ label, isAnnual }) => {
              const active = annual === isAnnual;
              return (
                <button key={label} onClick={() => setAnnual(isAnnual)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 22px", borderRadius: 11,
                  border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600,
                  background: active ? "#fff" : "transparent",
                  color: active ? "#111" : "#6B7280",
                  boxShadow: active ? "0 1px 6px rgba(0,0,0,0.12)" : "none",
                  transition: "all 0.2s",
                }}>
                  {label}
                  {isAnnual && (
                    <span style={{
                      background: GRAD, color: "#fff",
                      fontSize: 10, fontWeight: 700,
                      padding: "2px 8px", borderRadius: 999,
                    }}>
                      −18%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Cards dos planos ─────────────────────────────────────────────────── */}
      <section className="pricing-plans" style={{ padding: "0 1rem 80px" }}>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 24,
          justifyContent: "center", maxWidth: 1080, margin: "0 auto",
          alignItems: "flex-start",
        }}>
          {PLAN_ORDER.map((key, idx) => {
            const p          = PLAN_INFO[key];
            const price      = annual ? p.price_annual_monthly : p.price_monthly;
            const mpId       = annual ? p.mp_id_annual : p.mp_id_monthly;
            const isHigh     = p.highlight;
            const savings    = ANNUAL_SAVINGS[key];
            const isHovered  = hoveredPlan === key;
            const isCtaHov   = hoveredCta === key;

            const intPart    = Math.floor(price);
            const decPart    = price.toFixed(2).split(".")[1];
            const hasDecimal = decPart !== "00";

            return (
              <div
                key={key}
                className={isHigh ? "plan-card-highlight" : ""}
                onMouseEnter={() => setHoveredPlan(key)}
                onMouseLeave={() => setHoveredPlan(null)}
                style={{
                  width: "100%",
                  maxWidth: isHigh ? 360 : 320,
                  background: "#fff",
                  border: isHigh
                    ? `2px solid ${p.color}`
                    : isHovered
                      ? `2px solid ${p.color}66`
                      : "1px solid #e5e7eb",
                  borderRadius: 24,
                  boxShadow: isHigh
                    ? `0 20px 60px ${p.color}30, 0 4px 16px rgba(0,0,0,0.08)`
                    : isHovered
                      ? `0 12px 40px rgba(0,0,0,0.12)`
                      : "0 2px 12px rgba(0,0,0,0.06)",
                  overflow: "hidden",
                  position: "relative",
                  transition: "all 0.25s ease",
                  transform: isHigh
                    ? undefined
                    : isHovered ? "translateY(-6px)" : "translateY(0)",
                  zIndex: isHigh ? 2 : 1,
                  marginTop: isHigh ? -8 : 0,
                }}
              >
                {/* Faixa superior */}
                <div style={{ height: 5, background: p.color }} />

                {/* Badge "Mais popular" */}
                {isHigh && (
                  <div style={{
                    position: "absolute", top: 18, right: 18,
                    background: p.color, color: "#fff",
                    fontSize: 10, fontWeight: 800, padding: "4px 12px",
                    borderRadius: 999, display: "flex", alignItems: "center", gap: 4,
                    boxShadow: `0 2px 8px ${p.color}66`,
                    letterSpacing: "0.5px", textTransform: "uppercase",
                  }}>
                    <Star size={8} fill="white" /> Mais popular
                  </div>
                )}

                <div style={{ padding: isHigh ? "28px 28px 32px" : "24px 24px 28px" }}>

                  {/* Nome do plano */}
                  <p style={{
                    fontSize: 11, fontWeight: 800, letterSpacing: "1.5px",
                    textTransform: "uppercase", color: p.color, marginBottom: 6,
                  }}>
                    {p.label}
                  </p>
                  <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 24, lineHeight: 1.5 }}>
                    {p.description}
                  </p>

                  {/* Preço */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 1, marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: p.color, marginTop: 10 }}>R$</span>
                    <span style={{ fontSize: isHigh ? 64 : 56, fontWeight: 900, lineHeight: 1, color: p.color }}>
                      {intPart}
                    </span>
                    {hasDecimal && (
                      <span style={{ fontSize: 16, fontWeight: 700, color: p.color, marginTop: isHigh ? 44 : 38 }}>
                        ,{decPart}
                      </span>
                    )}
                    <span style={{ fontSize: 13, color: "#9CA3AF", fontWeight: 500, marginTop: isHigh ? 48 : 42 }}>
                      /mês
                    </span>
                  </div>

                  {/* Economia anual */}
                  {annual ? (
                    <div style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: `${p.color}12`, border: `1px solid ${p.color}30`,
                      borderRadius: 8, padding: "5px 10px", marginBottom: 22,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: p.color }}>
                        🎉 Economize R$ {fmt(savings)}/ano
                      </span>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 22 }}>
                      cobrado mensalmente
                    </p>
                  )}

                  {/* CTA */}
                  {userEmail ? (
                    <a
                      href={getMpCheckoutUrl(mpId, userEmail)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onMouseEnter={() => setHoveredCta(key)}
                      onMouseLeave={() => setHoveredCta(null)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", padding: "14px 0",
                        background: isCtaHov
                          ? `linear-gradient(135deg, ${p.color}dd, ${p.color})`
                          : p.color,
                        color: "#fff", borderRadius: 12,
                        fontWeight: 700, fontSize: 14,
                        textDecoration: "none",
                        boxShadow: isCtaHov
                          ? `0 8px 24px ${p.color}55`
                          : `0 4px 14px ${p.color}44`,
                        transition: "all 0.2s",
                        transform: isCtaHov ? "translateY(-1px)" : "none",
                      }}
                    >
                      Assinar {p.label} <ArrowRight size={15} />
                    </a>
                  ) : (
                    <Link
                      to="/auth?register=1"
                      onMouseEnter={() => setHoveredCta(key)}
                      onMouseLeave={() => setHoveredCta(null)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", padding: "14px 0",
                        background: isCtaHov
                          ? `linear-gradient(135deg, ${p.color}dd, ${p.color})`
                          : p.color,
                        color: "#fff", borderRadius: 12,
                        fontWeight: 700, fontSize: 14,
                        textDecoration: "none",
                        boxShadow: isCtaHov
                          ? `0 8px 24px ${p.color}55`
                          : `0 4px 14px ${p.color}44`,
                        transition: "all 0.2s",
                        transform: isCtaHov ? "translateY(-1px)" : "none",
                      }}
                    >
                      Testar grátis agora <ArrowRight size={15} />
                    </Link>
                  )}

                  <p style={{ fontSize: 11, color: "#9CA3AF", textAlign: "center", marginTop: 8 }}>
                    {userEmail ? "Pagamento seguro via Mercado Pago" : "Sem cartão de crédito"}
                  </p>

                  {/* Divisória */}
                  <div style={{ borderTop: `1px solid ${p.color}20`, margin: "20px 0" }} />

                  {/* Features do plano */}
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {p.features.map((feat, i) => (
                      <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "6px 0" }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 5,
                          flexShrink: 0, marginTop: 1,
                          background: `${p.color}15`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <Check size={10} style={{ color: p.color, strokeWidth: 3 }} />
                        </div>
                        <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.45 }}>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Comparação de recursos ───────────────────────────────────────────── */}
      <section className="pricing-section" style={{ padding: "0 1rem 80px" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <h2 style={{
            textAlign: "center", fontSize: "clamp(20px,3vw,28px)", fontWeight: 800,
            color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em",
          }}>
            Compare os planos
          </h2>
          <p style={{ textAlign: "center", fontSize: 14, color: "#6B7280", marginBottom: 40 }}>
            Veja o que cada plano inclui
          </p>

          <div style={{
            background: "#fff", borderRadius: 20,
            border: "1px solid #e5e7eb",
            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
            overflow: "hidden",
          }}>
            {/* Cabeçalho */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 80px 80px 80px",
              background: "#F8FAFC", borderBottom: "1px solid #e5e7eb",
              padding: "16px 24px",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.8px" }}>
                Recurso
              </span>
              {PLAN_ORDER.map(k => (
                <span key={k} style={{
                  fontSize: 12, fontWeight: 800, color: PLAN_INFO[k].color,
                  textAlign: "center", textTransform: "uppercase", letterSpacing: "0.8px",
                }}>
                  {k === "loja" ? "Loja" : k === "delivery" ? "Delivery" : "Pro"}
                </span>
              ))}
            </div>

            {/* Linhas */}
            {COMPARISON_FEATURES.map(({ label, loja, delivery, pro }, i) => (
              <div key={label} style={{
                display: "grid", gridTemplateColumns: "1fr 80px 80px 80px",
                padding: "13px 24px",
                background: i % 2 === 0 ? "#fff" : "#FAFBFC",
                borderBottom: i < COMPARISON_FEATURES.length - 1 ? "1px solid #F3F4F6" : "none",
                alignItems: "center",
              }}>
                <span style={{ fontSize: 13.5, color: "#374151", fontWeight: 500 }}>{label}</span>
                {[loja, delivery, pro].map((has, ci) => {
                  const planColor = PLAN_INFO[PLAN_ORDER[ci]].color;
                  return (
                    <div key={ci} style={{ display: "flex", justifyContent: "center" }}>
                      {has ? (
                        <div style={{
                          width: 24, height: 24, borderRadius: 8,
                          background: `${planColor}15`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <Check size={13} style={{ color: planColor, strokeWidth: 2.5 }} />
                        </div>
                      ) : (
                        <div style={{
                          width: 24, height: 24, borderRadius: 8,
                          background: "#F3F4F6",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <X size={12} style={{ color: "#D1D5DB", strokeWidth: 2.5 }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Diferenciais ─────────────────────────────────────────────────────── */}
      <section className="pricing-section" style={{
        padding: "80px 1rem",
        background: "linear-gradient(180deg,#F0F4FF 0%,#F8F9FA 100%)",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <h2 style={{
            textAlign: "center", fontSize: "clamp(20px,3vw,28px)", fontWeight: 800,
            color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em",
          }}>
            Por que escolher o Upabase?
          </h2>
          <p style={{ textAlign: "center", fontSize: 14, color: "#6B7280", marginBottom: 48 }}>
            Tudo que você precisa para gerir seu negócio em um só lugar
          </p>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
          }}>
            {DIFFERENTIALS.map(({ emoji, title, desc }, i) => (
              <div key={i} style={{
                background: "#fff", borderRadius: 16,
                padding: "24px 22px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                transition: "box-shadow 0.2s, transform 0.2s",
              }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 12 }}>{emoji}</div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{title}</h3>
                <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.55, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Garantias ────────────────────────────────────────────────────────── */}
      <section className="pricing-section" style={{ padding: "80px 1rem" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <h2 style={{
            textAlign: "center", fontSize: "clamp(20px,3vw,28px)", fontWeight: 800,
            color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em",
          }}>
            Sem risco. Sem complicação.
          </h2>
          <p style={{ textAlign: "center", fontSize: 14, color: "#6B7280", marginBottom: 48 }}>
            Começar é simples e você pode cancelar a qualquer momento
          </p>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
          }}>
            {GUARANTEES.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: "#fff", borderRadius: 16,
                padding: "22px 20px", border: "1px solid #e5e7eb",
                textAlign: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: `${PRIMARY}10`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto 14px",
                }}>
                  <Icon size={20} style={{ color: PRIMARY }} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>{title}</p>
                <p style={{ fontSize: 12, color: "#9CA3AF", margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Final ────────────────────────────────────────────────────────── */}
      <section style={{ padding: "0 1rem 80px" }}>
        <div style={{
          maxWidth: 640, margin: "0 auto",
          background: GRAD,
          borderRadius: 24, padding: "48px 32px",
          textAlign: "center",
          boxShadow: "0 16px 48px rgba(123,47,190,0.35)",
        }}>
          <h2 style={{ fontSize: "clamp(20px,3vw,28px)", fontWeight: 800, color: "#fff", marginBottom: 12 }}>
            Pronto para começar?
          </h2>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.8)", marginBottom: 28 }}>
            15 dias grátis, sem cartão de crédito, sem compromisso.
          </p>
          <Link to="/auth?register=1" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "14px 32px",
            background: "#fff", color: PRIMARY,
            borderRadius: 12, fontWeight: 800, fontSize: 15,
            textDecoration: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
            transition: "transform 0.15s",
          }}>
            Testar grátis agora <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      <section className="pricing-section" style={{
        padding: "0 1rem 80px",
        background: "linear-gradient(180deg,#F8F9FA 0%,#F0F4FF 100%)",
        paddingTop: 80,
      }}>
        <div style={{ maxWidth: 680, margin: "0 auto" }}>
          <h2 style={{
            textAlign: "center", fontSize: "clamp(20px,3vw,28px)", fontWeight: 800,
            color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em",
          }}>
            Perguntas frequentes
          </h2>
          <p style={{ textAlign: "center", fontSize: 14, color: "#6B7280", marginBottom: 40 }}>
            Tudo que você precisa saber antes de começar
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {FAQS.map(({ q, a }, i) => {
              const open = openFaq === i;
              return (
                <div key={i} style={{
                  background: "#fff", borderRadius: 14,
                  border: open ? `1px solid ${PRIMARY}40` : "1px solid #e5e7eb",
                  overflow: "hidden",
                  boxShadow: open ? `0 4px 16px rgba(123,47,190,0.1)` : "0 1px 4px rgba(0,0,0,0.04)",
                  transition: "all 0.2s",
                }}>
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center",
                      justifyContent: "space-between",
                      padding: "18px 22px", background: "none", border: "none",
                      cursor: "pointer", textAlign: "left", gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: open ? PRIMARY : "#0f172a" }}>
                      {q}
                    </span>
                    <div style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                      background: open ? `${PRIMARY}15` : "#F3F4F6",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.2s",
                    }}>
                      <ChevronDown
                        size={15}
                        style={{
                          color: open ? PRIMARY : "#9CA3AF",
                          transform: open ? "rotate(180deg)" : "none",
                          transition: "transform 0.2s",
                        }}
                      />
                    </div>
                  </button>
                  {open && (
                    <div style={{ padding: "0 22px 18px" }}>
                      <p style={{ fontSize: 13.5, color: "#6B7280", lineHeight: 1.65, margin: 0 }}>{a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "28px 1rem", textAlign: "center", background: "#fff" }}>
        <p style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 10 }}>
          © {new Date().getFullYear()} UpaBase · Pagamentos via{" "}
          <span style={{ fontWeight: 600, color: PRIMARY }}>Mercado Pago</span>
          {" "}· Dados seguros com{" "}
          <span style={{ fontWeight: 600, color: PRIMARY }}>Supabase</span>
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 20 }}>
          <Link to="/privacy" style={{ fontSize: 11, color: "#9CA3AF", textDecoration: "none" }}>Privacidade</Link>
          <Link to="/terms"   style={{ fontSize: 11, color: "#9CA3AF", textDecoration: "none" }}>Termos</Link>
          <Link to="/auth"    style={{ fontSize: 11, color: "#9CA3AF", textDecoration: "none" }}>Entrar</Link>
        </div>
      </footer>
    </div>
  );
}
