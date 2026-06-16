import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ArrowRight, Lock, Shield, Zap, Headphones, Cloud, HardDrive } from "lucide-react";
import { PLAN_INFO, getMpCheckoutUrl } from "../../lib/plans";
import { supabase } from "../../lib/supabase";

const PRIMARY = "#2563eb";

interface BenefitCard {
  emoji: string;
  title: string;
  desc: string;
}

interface GuaranteeCard {
  icon: React.ReactNode;
  title: string;
  desc: string;
}

interface FAQItem {
  q: string;
  a: string;
}

const BENEFITS: BenefitCard[] = [
  {
    emoji: "💰",
    title: "Controle financeiro completo",
    desc: "Acompanhe entradas, saídas, lucro e movimentações em tempo real.",
  },
  {
    emoji: "📦",
    title: "Estoque inteligente",
    desc: "Controle produtos e movimentações automaticamente.",
  },
  {
    emoji: "🖥️",
    title: "PDV moderno",
    desc: "Venda rapidamente com uma interface intuitiva.",
  },
  {
    emoji: "📈",
    title: "Relatórios completos",
    desc: "Tome decisões com base em dados reais.",
  },
];

const FEATURES = [
  {
    title: "Caixa e PDV",
    desc: "Controle abertura de caixa, vendas, sangrias, reforços e fechamento.",
    images: [
      "https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/caixa.png",
      "https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/pdv.png",
    ],
  },
  {
    title: "Cardápio Digital",
    desc: "Receba pedidos online sem pagar comissão para marketplaces.",
    images: ["https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/cardapio%20digital.png"],
  },
  {
    title: "Gestão de Mesas",
    desc: "Organize comandas e acompanhe ocupação em tempo real.",
    images: ["https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/mesas.png"],
  },
  {
    title: "Controle de Estoque",
    desc: "Movimentação automática de produtos e ingredientes.",
    images: ["https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/estoque.png"],
  },
  {
    title: "Relatórios",
    desc: "Visualize vendas, lucro e desempenho do negócio.",
    images: ["https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/relatorios.png"],
  },
];

const CREDIBILITY = [
  { title: "✅ Testado em operação real" },
  { title: "✅ Atualizações constantes" },
  { title: "✅ Suporte humano" },
  { title: "✅ Desenvolvimento ativo" },
];

const GUARANTEES: GuaranteeCard[] = [
  { icon: <Zap size={24} />, title: "15 dias grátis", desc: "Sem limitações" },
  { icon: <Lock size={24} />, title: "Sem fidelidade", desc: "Cancele quando quiser" },
  { icon: <Cloud size={24} />, title: "Sem cartão", desc: "Comece agora" },
  { icon: <ArrowRight size={24} />, title: "Cancelamento imediato", desc: "Sem taxas" },
  { icon: <Headphones size={24} />, title: "Suporte humano", desc: "Atendimento rápido" },
  { icon: <Shield size={24} />, title: "Dados protegidos", desc: "Criptografia avançada" },
];

const FAQS: FAQItem[] = [
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

export default function PricingPage() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [caixaPdvImageIndex, setCaixaPdvImageIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isAnnual, setIsAnnual] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });

    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", overflowX: "hidden" }}>
      {/* ── HERO ─────────────────────────────────────────────────────────────────── */}
      <section
        style={{
          paddingTop: "80px",
          paddingBottom: "60px",
          paddingLeft: "1rem",
          paddingRight: "1rem",
          maxWidth: "1200px",
          margin: "0 auto",
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              background: "#f0f4ff",
              border: `1px solid ${PRIMARY}20`,
              borderRadius: "999px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, color: PRIMARY }}>
              ✨ 15 dias grátis • Sem cartão
            </span>
          </div>
        </div>

        {/* Título */}
        <h1
          style={{
            fontSize: "clamp(32px, 6vw, 56px)",
            fontWeight: 900,
            lineHeight: 1.2,
            textAlign: "center",
            color: "#0f172a",
            marginBottom: "16px",
            maxWidth: "900px",
            margin: "0 auto 16px",
            letterSpacing: "-0.02em",
          }}
        >
          Tudo o que sua empresa precisa em um só lugar
        </h1>

        {/* Subtítulo */}
        <p
          style={{
            fontSize: "clamp(16px, 2.5vw, 20px)",
            color: "#6B7280",
            textAlign: "center",
            maxWidth: "700px",
            margin: "0 auto 24px",
            lineHeight: 1.6,
          }}
        >
          Controle vendas, estoque, clientes, financeiro e delivery com uma plataforma simples, completa e feita para pequenas empresas.
        </p>

        {/* Tipos de negócios */}
        <p
          style={{
            fontSize: "14px",
            color: "#6B7280",
            textAlign: "center",
            maxWidth: "700px",
            margin: "0 auto 32px",
            lineHeight: 1.6,
          }}
        >
          🏪 Lojas • 🛒 Mercadinhos • 👟 Calçados • 👕 Roupas • 🍔 Restaurantes • 🛵 Delivery
        </p>

        {/* Benefícios */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "20px",
            marginBottom: "40px",
          }}
        >
          {["15 dias grátis", "Sem cartão de crédito", "Suporte humano", "Cancele quando quiser"].map((benefit) => (
            <div
              key={benefit}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#374151",
              }}
            >
              <Check size={16} color={PRIMARY} strokeWidth={3} />
              {benefit}
            </div>
          ))}
        </div>

        {/* Botões */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "12px",
            marginBottom: "60px",
          }}
        >
          <Link
            to="/auth?register=1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "14px 32px",
              background: PRIMARY,
              color: "#fff",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "15px",
              textDecoration: "none",
              boxShadow: `0 4px 16px ${PRIMARY}40`,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-2px)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 8px 24px ${PRIMARY}50`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 4px 16px ${PRIMARY}40`;
            }}
          >
            Testar grátis <ArrowRight size={16} />
          </Link>
          <button
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "14px 32px",
              background: "#f3f4f6",
              color: "#111",
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "15px",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#e5e7eb";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }}
          >
            Ver demonstração
          </button>
        </div>

        {/* Mockup */}
        <div
          style={{
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.1)",
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
          }}
        >
          <img
            src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2015%20de%20jun.%20de%202026,%2023_27_14.png"
            alt="UpaBase Dashboard"
            style={{
              width: "100%",
              height: "auto",
              display: "block",
            }}
          />
        </div>
      </section>

      {/* ── BENEFÍCIOS ───────────────────────────────────────────────────────────── */}
      <section
        style={{
          padding: "80px 1rem",
          background: "#f9fafb",
        }}
      >
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "60px" }}>
            <h2
              style={{
                fontSize: "clamp(28px, 5vw, 40px)",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              Por que escolher nossa plataforma?
            </h2>
            <p
              style={{
                fontSize: "16px",
                color: "#6B7280",
                maxWidth: "500px",
                margin: "0 auto",
                lineHeight: 1.6,
              }}
            >
              Tudo que você precisa para administrar seu negócio sem complicação.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "24px",
            }}
          >
            {BENEFITS.map((benefit, i) => (
              <div
                key={i}
                style={{
                  background: "#fff",
                  borderRadius: "12px",
                  padding: "32px 24px",
                  border: "1px solid #e5e7eb",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = PRIMARY;
                  (e.currentTarget as HTMLDivElement).style.boxShadow = `0 12px 24px rgba(37, 99, 235, 0.12)`;
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-4px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "#e5e7eb";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                }}
              >
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>{benefit.emoji}</div>
                <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", marginBottom: "8px" }}>
                  {benefit.title}
                </h3>
                <p style={{ fontSize: "14px", color: "#6B7280", margin: 0, lineHeight: 1.5 }}>
                  {benefit.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

{/* ── FUNCIONALIDADES ──────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 1rem", background: "#f9fafb" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "80px" }}>
            <h2
              style={{
                fontSize: "clamp(28px, 5vw, 40px)",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              Funcionalidades que impulsionam seu negócio
            </h2>
          </div>

          {FEATURES.map((feature, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: isMobile ? "column" : i % 2 === 0 ? "row" : "row-reverse",
                gap: isMobile ? "24px" : "60px",
                alignItems: isMobile ? "stretch" : "center",
                marginBottom: isMobile ? "80px" : "120px",
              }}
            >
              {i % 2 === 0 ? (
                <>
                  <div>
                    <h3
                      style={{
                        fontSize: "32px",
                        fontWeight: 800,
                        color: "#0f172a",
                        marginBottom: "16px",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {feature.title}
                    </h3>
                    <p
                      style={{
                        fontSize: "16px",
                        color: "#6B7280",
                        lineHeight: 1.7,
                        marginBottom: "24px",
                      }}
                    >
                      {feature.desc}
                    </p>
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                      {["Interface intuitiva", "Rápido", "Confiável"].map((tag, j) => (
                        <span
                          key={j}
                          style={{
                            padding: "6px 12px",
                            background: "#f0f4ff",
                            border: `1px solid ${PRIMARY}20`,
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: PRIMARY,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div
                    style={{
                      background: "#fff",
                      borderRadius: "12px",
                      border: "1px solid #e5e7eb",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    <img
                      src={feature.images && feature.images.length > 0 ? feature.images[i === 0 ? caixaPdvImageIndex : 0] : ""}
                      alt={feature.title}
                      style={{
                        width: "100%",
                        height: isMobile ? "250px" : "400px",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                    {feature.images && feature.images.length > 1 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "16px",
                          left: "50%",
                          transform: "translateX(-50%)",
                          display: "flex",
                          gap: "8px",
                        }}
                      >
                        {feature.images.map((_, imgIdx) => (
                          <button
                            key={imgIdx}
                            onClick={() => setCaixaPdvImageIndex(imgIdx)}
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              background: caixaPdvImageIndex === imgIdx ? PRIMARY : "rgba(255,255,255,0.5)",
                              border: "none",
                              cursor: "pointer",
                              transition: "all 0.2s",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      background: "#fff",
                      borderRadius: "12px",
                      border: "1px solid #e5e7eb",
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    <img
                      src={feature.images && feature.images.length > 0 ? feature.images[i === 0 ? caixaPdvImageIndex : 0] : ""}
                      alt={feature.title}
                      style={{
                        width: "100%",
                        height: isMobile ? "250px" : "400px",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                    {feature.images && feature.images.length > 1 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "16px",
                          left: "50%",
                          transform: "translateX(-50%)",
                          display: "flex",
                          gap: "8px",
                        }}
                      >
                        {feature.images.map((_, imgIdx) => (
                          <button
                            key={imgIdx}
                            onClick={() => setCaixaPdvImageIndex(imgIdx)}
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              background: caixaPdvImageIndex === imgIdx ? PRIMARY : "rgba(255,255,255,0.5)",
                              border: "none",
                              cursor: "pointer",
                              transition: "all 0.2s",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h3
                      style={{
                        fontSize: "32px",
                        fontWeight: 800,
                        color: "#0f172a",
                        marginBottom: "16px",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {feature.title}
                    </h3>
                    <p
                      style={{
                        fontSize: "16px",
                        color: "#6B7280",
                        lineHeight: 1.7,
                        marginBottom: "24px",
                      }}
                    >
                      {feature.desc}
                    </p>
                    <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                      {["Interface intuitiva", "Rápido", "Confiável"].map((tag, j) => (
                        <span
                          key={j}
                          style={{
                            padding: "6px 12px",
                            background: "#f0f4ff",
                            border: `1px solid ${PRIMARY}20`,
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: PRIMARY,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── CREDIBILIDADE ────────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 1rem", background: "#fff" }}>
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "60px" }}>
            <h2
              style={{
                fontSize: "clamp(28px, 5vw, 40px)",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "16px",
                letterSpacing: "-0.02em",
              }}
            >
              Desenvolvido em operação real
            </h2>
            <p
              style={{
                fontSize: "16px",
                color: "#6B7280",
                maxWidth: "600px",
                margin: "0 auto",
                lineHeight: 1.6,
              }}
            >
              Nosso sistema é utilizado e aprimorado continuamente em uma operação real, garantindo funcionalidades práticas para o dia a dia de restaurantes, lanchonetes e delivery.
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "24px",
            }}
          >
            {CREDIBILITY.map((item, i) => (
              <div
                key={i}
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "12px",
                  padding: "28px 20px",
                  textAlign: "center",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#0f172a",
                }}
              >
                {item.title}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLANO ÚNICO ──────────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 1rem", background: "#f9fafb" }}>
        <div style={{ maxWidth: "700px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <h2
              style={{
                fontSize: "clamp(28px, 5vw, 40px)",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              Um único plano. Tudo incluso.
            </h2>
            <p
              style={{
                fontSize: "16px",
                color: "#6B7280",
                marginBottom: "0",
              }}
            >
              Sem limitações e sem cobranças escondidas.
            </p>
          </div>

          <div
            style={{
              background: "#fff",
              border: `2px solid ${PRIMARY}`,
              borderRadius: "16px",
              padding: "48px 40px",
              textAlign: "center",
            }}
          >
            {/* Toggle Mensal/Anual */}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "32px" }}>
              <div
                style={{
                  display: "inline-flex",
                  background: "#f3f4f6",
                  borderRadius: "12px",
                  padding: "4px",
                  gap: "2px",
                }}
              >
                {[
                  { label: "Mensal", isAnnual: false },
                  { label: "Anual", isAnnual: true },
                ].map(({ label, isAnnual: annual }) => (
                  <button
                    key={label}
                    onClick={() => setIsAnnual(annual)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "8px 16px",
                      borderRadius: "10px",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 600,
                      background: isAnnual === annual ? "#fff" : "transparent",
                      color: isAnnual === annual ? PRIMARY : "#6B7280",
                      boxShadow: isAnnual === annual ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                      transition: "all 0.2s",
                    }}
                  >
                    {label}
                    {annual && <span style={{ color: PRIMARY, fontWeight: 700 }}>−18%</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Preço */}
            <div style={{ marginBottom: "32px" }}>
              <div
                style={{
                  fontSize: "48px",
                  fontWeight: 900,
                  color: PRIMARY,
                  lineHeight: 1,
                  marginBottom: "4px",
                }}
              >
                R$ {isAnnual ? "49,90" : "59,90"}
              </div>
              <p style={{ fontSize: "16px", color: "#6B7280", margin: 0 }}>
                por mês {isAnnual && <span style={{ fontSize: "13px" }}>(cobrado anualmente)</span>}
              </p>
              {isAnnual && (
                <p
                  style={{
                    fontSize: "12px",
                    color: PRIMARY,
                    marginTop: "8px",
                    fontWeight: 600,
                }}
                >
                  🎉 Economize R$ 120/ano
                </p>
              )}
            </div>

            {/* Features */}
            <div
              style={{
                textAlign: "left",
                marginBottom: "40px",
                paddingTop: "32px",
                paddingBottom: "32px",
                borderTop: "1px solid #e5e7eb",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              {[
                "Dashboard completo",
                "Caixa",
                "PDV",
                "Produtos",
                "Estoque",
                "Mesas",
                "Clientes",
                "Relatórios",
                "Cardápio Digital",
                "Backup automático",
                "Atualizações",
                "Suporte",
              ].map((feature, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    paddingTop: "12px",
                    paddingBottom: "12px",
                    fontSize: "15px",
                    color: "#374151",
                  }}
                >
                  <Check size={18} color={PRIMARY} strokeWidth={3} />
                  {feature}
                </div>
              ))}
            </div>

            {/* CTA */}
            <Link
              to="/auth?register=1"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
                padding: "16px 0",
                background: PRIMARY,
                color: "#fff",
                borderRadius: "8px",
                fontWeight: 700,
                fontSize: "15px",
                textDecoration: "none",
                boxShadow: `0 4px 16px ${PRIMARY}40`,
                transition: "all 0.2s",
                marginBottom: "16px",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-2px)";
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 8px 24px ${PRIMARY}50`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
                (e.currentTarget as HTMLAnchorElement).style.boxShadow = `0 4px 16px ${PRIMARY}40`;
              }}
            >
              Começar teste grátis
            </Link>

            <p
              style={{
                fontSize: "13px",
                color: "#6B7280",
                margin: 0,
              }}
            >
              15 dias grátis • Sem cartão de crédito
            </p>
          </div>
        </div>
      </section>

      {/* ── GARANTIAS ────────────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 1rem", background: "#fff" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "60px" }}>
            <h2
              style={{
                fontSize: "clamp(28px, 5vw, 40px)",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              Sem risco. Sem complicação.
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "24px",
            }}
          >
            {GUARANTEES.map((guarantee, i) => (
              <div
                key={i}
                style={{
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: "12px",
                  padding: "28px 24px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: "44px",
                    height: "44px",
                    borderRadius: "8px",
                    background: `${PRIMARY}10`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 12px",
                    color: PRIMARY,
                  }}
                >
                  {guarantee.icon}
                </div>
                <h3
                  style={{
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#0f172a",
                    marginBottom: "4px",
                  }}
                >
                  {guarantee.title}
                </h3>
                <p
                  style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    margin: 0,
                  }}
                >
                  {guarantee.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 1rem", background: "#f9fafb" }}>
        <div style={{ maxWidth: "700px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "60px" }}>
            <h2
              style={{
                fontSize: "clamp(28px, 5vw, 40px)",
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              Perguntas frequentes
            </h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {FAQS.map((faq, i) => {
              const isOpen = openFaq === i;
              return (
                <button
                  key={i}
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  style={{
                    background: "#fff",
                    border: isOpen ? `2px solid ${PRIMARY}` : "1px solid #e5e7eb",
                    borderRadius: "12px",
                    padding: "20px 24px",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isOpen) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = PRIMARY + "40";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isOpen) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e7eb";
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "15px",
                        fontWeight: 600,
                        color: isOpen ? PRIMARY : "#0f172a",
                      }}
                    >
                      {faq.q}
                    </span>
                    <ChevronDown
                      size={18}
                      style={{
                        color: PRIMARY,
                        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.2s",
                        flexShrink: 0,
                      }}
                    />
                  </div>
                  {isOpen && (
                    <p
                      style={{
                        fontSize: "14px",
                        color: "#6B7280",
                        marginTop: "12px",
                        marginBottom: 0,
                        lineHeight: 1.6,
                      }}
                    >
                      {faq.a}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ────────────────────────────────────────────────────────────── */}
      <section
        style={{
          padding: "80px 1rem",
          background: `linear-gradient(135deg, ${PRIMARY} 0%, #10b981 100%)`,
        }}
      >
        <div style={{ maxWidth: "700px", margin: "0 auto", textAlign: "center" }}>
          <h2
            style={{
              fontSize: "clamp(28px, 5vw, 40px)",
              fontWeight: 800,
              color: "#fff",
              marginBottom: "16px",
              letterSpacing: "-0.02em",
            }}
          >
            Comece a organizar seu negócio hoje
          </h2>
          <p
            style={{
              fontSize: "16px",
              color: "rgba(255,255,255,0.85)",
              marginBottom: "32px",
              lineHeight: 1.6,
            }}
          >
            Experimente gratuitamente e descubra como simplificar sua operação.
          </p>

          <Link
            to="/auth?register=1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "14px 32px",
              background: "#fff",
              color: PRIMARY,
              borderRadius: "8px",
              fontWeight: 700,
              fontSize: "15px",
              textDecoration: "none",
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
            }}
          >
            Testar grátis agora <ArrowRight size={16} />
          </Link>

          <p
            style={{
              fontSize: "13px",
              color: "rgba(255,255,255,0.7)",
              marginTop: "16px",
              marginBottom: 0,
            }}
          >
            15 dias grátis • Sem cartão • Cancelamento quando quiser
          </p>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "40px 1rem", textAlign: "center", background: "#fff" }}>
        <p style={{ fontSize: "12px", color: "#9CA3AF", marginBottom: "12px" }}>
          © {new Date().getFullYear()} UpaBase · Pagamentos via{" "}
          <span style={{ fontWeight: 600, color: PRIMARY }}>Mercado Pago</span>
          {" "}· Dados seguros com{" "}
          <span style={{ fontWeight: 600, color: PRIMARY }}>Supabase</span>
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "24px" }}>
          <Link to="/privacy" style={{ fontSize: "11px", color: "#9CA3AF", textDecoration: "none" }}>
            Privacidade
          </Link>
          <Link to="/terms" style={{ fontSize: "11px", color: "#9CA3AF", textDecoration: "none" }}>
            Termos
          </Link>
          <Link to="/auth" style={{ fontSize: "11px", color: "#9CA3AF", textDecoration: "none" }}>
            Entrar
          </Link>
        </div>
      </footer>
    </div>
  );
}
