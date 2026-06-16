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

const PRIMARY = "#2563eb";
const GRAD    = "linear-gradient(135deg,#2563eb,#10b981)";
const PLAN_ORDER: PlanType[] = ["loja"];

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

const FEATURES_ALL_INCLUDED = [
  { emoji: "📊", label: "Dashboard completo",   desc: "Visualize todos os seus dados em tempo real" },
  { emoji: "🛍️", label: "PDV (Ponto de Venda)", desc: "Sistema completo de vendas e caixa" },
  { emoji: "📦", label: "Controle de estoque",  desc: "Gerencie produtos e quantidades" },
  { emoji: "💰", label: "Gestão financeira",    desc: "Controle de entradas, saídas e lucro" },
  { emoji: "📈", label: "Relatórios detalhados", desc: "Análise completa de vendas e desempenho" },
  { emoji: "📱", label: "Cardápio digital",     desc: "QR Code para acesso dos clientes" },
  { emoji: "👥", label: "Gestão de clientes",   desc: "Cadastro completo e histórico de pedidos" },
  { emoji: "🏪", label: "Gestão de mesas",      desc: "Controle de atendimento no salão" },
  { emoji: "📋", label: "Comandas",             desc: "Organização eficiente de pedidos" },
  { emoji: "💳", label: "Múltiplas formas de pagamento", desc: "Dinheiro, cartão, Pix e mais" },
  { emoji: "⚙️", label: "Configurações avançadas", desc: "Personalização completa do sistema" },
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
  const [annual,          setAnnual]          = useState(false);
  const [openFaq,         setOpenFaq]         = useState<number | null>(null);
  const [userEmail,       setUserEmail]       = useState<string | null>(null);
  const [hoveredPlan,     setHoveredPlan]     = useState<string | null>(null);
  const [hoveredCta,      setHoveredCta]      = useState<string | null>(null);
  const [expandedFeature, setExpandedFeature] = useState<number | null>(null);
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

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="pricing-hero" style={{
        textAlign: "center",
        padding: "60px 1rem 80px",
        background: `linear-gradient(135deg, rgba(37, 99, 235, 0.9) 0%, rgba(16, 185, 129, 0.9) 100%), url('https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2015%20de%20jun.%20de%202026,%2023_27_14.png')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: "#fff",
      }}>

        {/* Badge de destaque */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)",
          borderRadius: 999, padding: "5px 14px", marginBottom: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>15 dias grátis · Sem cartão</span>
        </div>

        {/* Título */}
        <h1 style={{
          fontSize: "clamp(28px, 5vw, 52px)", fontWeight: 900, lineHeight: 1.15,
          color: "#fff", margin: "0 auto 16px", maxWidth: 700, letterSpacing: "-0.02em",
        }}>
          Tudo que você precisa para gerenciar seu negócio
        </h1>

        {/* Subtítulo */}
        <p style={{
          fontSize: "clamp(15px, 2vw, 18px)", color: "rgba(255,255,255,0.85)",
          maxWidth: 560, margin: "0 auto 32px", lineHeight: 1.6,
        }}>
          Um plano único com acesso a todas as funcionalidades. Gestão completa para lojas,
          restaurantes, delivery e muito mais.
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

      {/* ── Plano com imagem lado a lado ──────────────────────────────────────── */}
      <section className="pricing-plans" style={{ padding: "0 1rem 80px" }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48,
          alignItems: "center",
        }}>
          {/* Esquerda — Imagem */}
          <div style={{
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          }}>
            <img
              src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2015%20de%20jun.%20de%202026,%2023_27_14.png"
              alt="Sistema UpaBase"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>

          {/* Direita — Plano */}
          <div style={{
            background: "#fff",
            border: `2px solid ${PRIMARY}`,
            borderRadius: 24,
            padding: "40px 32px",
            boxShadow: `0 20px 60px ${PRIMARY}30, 0 4px 16px rgba(0,0,0,0.08)`,
          }}>
            <div style={{ height: 5, background: PRIMARY, marginLeft: -32, marginRight: -32, marginTop: -40, marginBottom: 24 }} />

            <p style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "1.5px",
              textTransform: "uppercase", color: PRIMARY, marginBottom: 12,
            }}>
              Plano Loja
            </p>

            <h3 style={{
              fontSize: 24, fontWeight: 800, color: "#0f172a", marginBottom: 8, lineHeight: 1.3,
            }}>
              Acesso completo a todas as funcionalidades
            </h3>

            <p style={{ fontSize: 14, color: "#6B7280", marginBottom: 32, lineHeight: 1.6 }}>
              Um plano único com tudo que você precisa para gerenciar seu negócio de forma completa.
            </p>

            {/* Preço */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 1, marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: PRIMARY, marginTop: 10 }}>R$</span>
              <span style={{ fontSize: 64, fontWeight: 900, lineHeight: 1, color: PRIMARY }}>
                {Math.floor(annual ? 49.90 : 59.90)}
              </span>
              <span style={{ fontSize: 16, fontWeight: 700, color: PRIMARY, marginTop: 44 }}>
                ,{(annual ? 49.90 : 59.90).toFixed(2).split(".")[1]}
              </span>
              <span style={{ fontSize: 13, color: "#9CA3AF", fontWeight: 500, marginTop: 48 }}>
                /mês
              </span>
            </div>

            {/* Toggle Mensal/Anual */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
              <button
                onClick={() => setAnnual(false)}
                style={{
                  padding: "8px 16px", borderRadius: 8,
                  border: annual ? "1px solid #e5e7eb" : `1px solid ${PRIMARY}`,
                  background: annual ? "#fff" : `${PRIMARY}10`,
                  color: annual ? "#6B7280" : PRIMARY,
                  fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                Mensal
              </button>
              <button
                onClick={() => setAnnual(true)}
                style={{
                  padding: "8px 16px", borderRadius: 8,
                  border: !annual ? "1px solid #e5e7eb" : `1px solid ${PRIMARY}`,
                  background: !annual ? "#fff" : `${PRIMARY}10`,
                  color: !annual ? "#6B7280" : PRIMARY,
                  fontSize: 13, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                Anual {annual && <span style={{ marginLeft: 6, color: PRIMARY, fontWeight: 800 }}>−18%</span>}
              </button>
            </div>

            {annual && (
              <div style={{
                background: `${PRIMARY}12`, border: `1px solid ${PRIMARY}30`,
                borderRadius: 8, padding: "8px 12px", marginBottom: 24, display: "inline-block",
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: PRIMARY }}>
                  🎉 Economize R$ 120/ano
                </span>
              </div>
            )}

            {/* CTA */}
            {userEmail ? (
              <a
                href={getMpCheckoutUrl(annual ? PLAN_INFO.loja.mp_id_annual : PLAN_INFO.loja.mp_id_monthly, userEmail)}
                target="_blank"
                rel="noopener noreferrer"
                onMouseEnter={() => setHoveredCta("loja")}
                onMouseLeave={() => setHoveredCta(null)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", padding: "14px 0", marginBottom: 12,
                  background: hoveredCta === "loja" ? `linear-gradient(135deg, ${PRIMARY}dd, ${PRIMARY})` : PRIMARY,
                  color: "#fff", borderRadius: 12,
                  fontWeight: 700, fontSize: 14,
                  textDecoration: "none",
                  boxShadow: hoveredCta === "loja" ? `0 8px 24px ${PRIMARY}55` : `0 4px 14px ${PRIMARY}44`,
                  transition: "all 0.2s",
                  transform: hoveredCta === "loja" ? "translateY(-1px)" : "none",
                }}
              >
                Assinar agora <ArrowRight size={15} />
              </a>
            ) : (
              <Link
                to="/auth?register=1"
                onMouseEnter={() => setHoveredCta("loja")}
                onMouseLeave={() => setHoveredCta(null)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  width: "100%", padding: "14px 0", marginBottom: 12,
                  background: hoveredCta === "loja" ? `linear-gradient(135deg, ${PRIMARY}dd, ${PRIMARY})` : PRIMARY,
                  color: "#fff", borderRadius: 12,
                  fontWeight: 700, fontSize: 14,
                  textDecoration: "none",
                  boxShadow: hoveredCta === "loja" ? `0 8px 24px ${PRIMARY}55` : `0 4px 14px ${PRIMARY}44`,
                  transition: "all 0.2s",
                  transform: hoveredCta === "loja" ? "translateY(-1px)" : "none",
                }}
              >
                Testar grátis agora <ArrowRight size={15} />
              </Link>
            )}

            <p style={{ fontSize: 11, color: "#9CA3AF", textAlign: "center", marginTop: 8, marginBottom: 20 }}>
              {userEmail ? "Pagamento seguro via Mercado Pago" : "Sem cartão de crédito"}
            </p>

            <div style={{ borderTop: `1px solid ${PRIMARY}20`, margin: "20px 0" }} />

            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {PLAN_INFO.loja.features.map((feat, i) => (
                <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0" }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 5,
                    flexShrink: 0, marginTop: 2,
                    background: `${PRIMARY}15`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Check size={10} style={{ color: PRIMARY, strokeWidth: 3 }} />
                  </div>
                  <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.45 }}>{feat}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Funcionalidades incluídas (clicáveis) ────────────────────────────── */}
      <section className="pricing-section" style={{ padding: "0 1rem 80px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <h2 style={{
            textAlign: "center", fontSize: "clamp(20px,3vw,28px)", fontWeight: 800,
            color: "#0f172a", marginBottom: 8, letterSpacing: "-0.02em",
          }}>
            Funcionalidades do Sistema
          </h2>
          <p style={{ textAlign: "center", fontSize: 14, color: "#6B7280", marginBottom: 48 }}>
            Conheça cada aba e como funciona
          </p>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
          }}>
            {FEATURES_ALL_INCLUDED.map(({ emoji, label, desc }, i) => {
              const isExpanded = expandedFeature === i;
              return (
                <button
                  key={i}
                  onClick={() => setExpandedFeature(isExpanded ? null : i)}
                  style={{
                    background: "#fff", borderRadius: 16,
                    padding: "24px",
                    border: isExpanded ? `2px solid ${PRIMARY}` : "1px solid #e5e7eb",
                    boxShadow: isExpanded ? `0 12px 32px ${PRIMARY}20` : "0 2px 8px rgba(0,0,0,0.04)",
                    transition: "all 0.2s",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  onMouseEnter={e => {
                    if (!isExpanded) {
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)";
                      (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isExpanded) {
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
                      (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ fontSize: 28 }}>{emoji}</div>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 4, margin: 0 }}>
                        {label}
                      </h3>
                      <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.5, margin: 0 }}>
                        {desc}
                      </p>
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{
                      marginTop: 16, paddingTop: 16,
                      borderTop: `1px solid ${PRIMARY}20`,
                      fontSize: 13, lineHeight: 1.6, color: "#374151",
                    }}>
                      {label.includes("Dashboard") && "Visualize gráficos, métricas e KPIs em tempo real. Acompanhe vendas, lucro, estoque e desempenho do seu negócio."}
                      {label.includes("PDV") && "Sistema completo de vendas com suporte a múltiplas formas de pagamento, desconto, notas fiscais e histórico de transações."}
                      {label.includes("estoque") && "Controle quantidade de produtos em tempo real, receba alertas de baixo estoque e gerencie movimentações de produtos."}
                      {label.includes("financeira") && "Acompanhe entradas e saídas, crie orçamentos, visualize fluxo de caixa e projete resultados futuros."}
                      {label.includes("Relatórios") && "Exporte dados em PDF/Excel, crie relatórios customizados de vendas, clientes e desempenho financeiro."}
                      {label.includes("Cardápio") && "Crie cardápio digital com fotos, descrições e preços. Compartilhe QR Code para clientes acessarem."}
                      {label.includes("clientes") && "Cadastre clientes com telefone, endereço e histórico de compras. Acompanhe preferências e frequência."}
                      {label.includes("mesas") && "Controle mesas do seu estabelecimento, gerencie atendimento no salão e comandas por mesa."}
                      {label.includes("Comandas") && "Imprima comandas com os itens pedidos, envie diretamente para a cozinha e acompanhe preparação."}
                      {label.includes("pagamento") && "Aceite Dinheiro, Cartão Crédito/Débito, Pix, Fiado, Saldo em Casa e integração com iFood."}
                      {label.includes("Configurações") && "Personalize cores, logos, nomes de campos, permissões de usuários e integrações do seu sistema."}
                    </div>
                  )}
                </button>
              );
            })}
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
