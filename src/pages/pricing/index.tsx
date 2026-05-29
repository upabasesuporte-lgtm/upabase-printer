import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Check, Lock, ChevronDown, Shield,
  Monitor, Mic, Boxes, Banknote,
  QrCode, Wallet, FileText, BarChart3,
  Users, UtensilsCrossed, Zap, HeadphonesIcon,
  ArrowRight,
} from "lucide-react";

// ─── Paleta ───────────────────────────────────────────────────────────────────
const PRIMARY   = "#7B2FBE";
const SECONDARY = "#00B4D8";
const GRAD      = `linear-gradient(135deg, ${PRIMARY}, ${SECONDARY})`;
const GRAD_90   = `linear-gradient(90deg,  ${PRIMARY}, ${SECONDARY})`;

// ─── Preços ───────────────────────────────────────────────────────────────────
const MONTHLY_PRICE  = 97;
const ANNUAL_MONTHLY = 79.90;
const ANNUAL_TOTAL   = 958.80;

// ─── Features ─────────────────────────────────────────────────────────────────
const features = [
  { icon: Monitor,          text: "PDV completo em uma tela só" },
  { icon: Zap,              text: "Atalhos para os produtos mais vendidos" },
  { icon: UtensilsCrossed,  text: "Mesas — prático, simples e intuitivo" },
  { icon: Boxes,            text: "Estoque unificado — PDV, mesas e cardápio" },
  { icon: QrCode,           text: "Cardápio digital com QR Code e chat" },
  { icon: Wallet,           text: "Caixa completo com relatórios" },
  { icon: Users,            text: "Controle de clientes e fidelização" },
  { icon: FileText,         text: "Contas a pagar — lançamento por voz ou completo" },
  { icon: BarChart3,        text: "Dashboard com entradas, saídas e lucro" },
  { icon: HeadphonesIcon,   text: "Suporte e configuração incluso" },
];

// ─── Garantias ────────────────────────────────────────────────────────────────
const guarantees = [
  { icon: Zap,              title: "15 dias grátis",       desc: "Sem cartão de crédito" },
  { icon: Lock,             title: "Cancela quando quiser",desc: "Sem fidelidade" },
  { icon: HeadphonesIcon,   title: "Suporte real",         desc: "Resposta rápida" },
  { icon: Shield,           title: "Dados seguros",        desc: "Criptografados no Supabase" },
];

// ─── FAQ ──────────────────────────────────────────────────────────────────────
const faqs = [
  {
    q: "Preciso de cartão para começar?",
    a: "Não. Os 15 dias de teste são completamente grátis e sem cartão. Você só informa o pagamento quando decidir continuar.",
  },
  {
    q: "Posso cancelar a qualquer momento?",
    a: "Sim, sem multa e sem burocracia. Basta entrar em contato e cancelamos na hora.",
  },
  {
    q: "O que está incluso no suporte?",
    a: "Ajuda com configuração inicial, treinamento e suporte contínuo via chat. Resposta rápida em dias úteis.",
  },
  {
    q: "Funciona no celular e no computador?",
    a: "Sim. O sistema roda no navegador — computador, tablet ou celular, sem precisar instalar nada.",
  },
];

// ─── Componente ───────────────────────────────────────────────────────────────
export default function PricingPage() {
  const [annual,   setAnnual]   = useState(false);
  const [openFaq,  setOpenFaq]  = useState<number | null>(null);

  const price  = annual ? ANNUAL_MONTHLY : MONTHLY_PRICE;
  const priceDisplay = annual
    ? `${ANNUAL_MONTHLY.toFixed(2).replace(".", ",")}`
    : `${MONTHLY_PRICE}`;
  const priceNote = annual
    ? `R$ ${ANNUAL_MONTHLY.toFixed(2).replace(".", ",")}/mês · cobrado R$ ${ANNUAL_TOTAL.toFixed(2).replace(".", ",")} /ano`
    : "cobrado mensalmente";

  return (
    <div style={{ background: "#F8F9FA", minHeight: "100vh", fontFamily: "inherit" }}>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section style={{ textAlign: "center", padding: "8px 1rem 32px" }}>

        {/* Logo grande */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: -20 }}>
          <img
            src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2021%20de%20mai.%20de%202026,%2019_48_48.png"
            alt="Logo"
            style={{ height: 200, width: "auto" }}
          />
        </div>

        {/* Toggle Mensal / Anual */}
        <div style={{
          display: "inline-flex",
          background: "#e5e7eb", borderRadius: 14,
          padding: 4, gap: 2,
        }}>
          {[
            { label: "Mensal",  isAnnual: false },
            { label: "Anual",   isAnnual: true  },
          ].map(({ label, isAnnual }) => {
            const active = annual === isAnnual;
            return (
              <button
                key={label}
                onClick={() => setAnnual(isAnnual)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "9px 20px", borderRadius: 11,
                  border: "none", cursor: "pointer",
                  fontSize: 13, fontWeight: 600,
                  background: active ? "#fff" : "transparent",
                  color: active ? "#111" : "#6B7280",
                  boxShadow: active ? "0 1px 6px rgba(0,0,0,0.12)" : "none",
                  transition: "all 0.2s",
                }}
              >
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
      </section>

      {/* ── Card do plano ───────────────────────────────────────────────────── */}
      <section style={{ padding: "0 1rem 64px", display: "flex", justifyContent: "center" }}>
        <div style={{
          width: "100%", maxWidth: 480,
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 20,
          boxShadow: "0 4px 32px rgba(0,0,0,0.07)",
          overflow: "hidden",
          position: "relative",
        }}>

          {/* Faixa gradiente superior */}
          <div style={{ height: 3, background: GRAD_90 }} />

          <div style={{ padding: "28px 28px 32px" }}>

            {/* Nome do plano + badge */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: "1.5px",
                textTransform: "uppercase", color: "#9CA3AF",
              }}>
                Plano Restaurante
              </span>
              <span style={{
                background: GRAD, color: "#fff",
                fontSize: 10, fontWeight: 700,
                padding: "3px 12px", borderRadius: 999,
              }}>
                Tudo incluso
              </span>
            </div>

            {/* Preço */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 2, marginBottom: 4 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: PRIMARY, marginTop: 12 }}>R$</span>
              <span style={{
                fontSize: 72, fontWeight: 900, lineHeight: 1,
                background: GRAD, WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent", backgroundClip: "text",
              }}>
                {annual ? "79" : "97"}
              </span>
              {annual && (
                <span style={{ fontSize: 18, fontWeight: 700, color: PRIMARY, marginTop: 50 }}>,90</span>
              )}
              <span style={{ fontSize: 14, color: "#9CA3AF", fontWeight: 500, marginTop: 52 }}>/mês</span>
            </div>

            <p style={{ fontSize: 12, color: annual ? PRIMARY : "#9CA3AF", fontWeight: annual ? 600 : 400, marginBottom: 24 }}>
              {priceNote}
            </p>

            {/* Botão CTA */}
            <Link
              to="/auth?register=1"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", padding: "14px 0",
                background: GRAD, color: "#fff",
                borderRadius: 12, fontWeight: 700, fontSize: 15,
                textDecoration: "none",
                boxShadow: `0 4px 16px rgba(123,47,190,0.35)`,
                transition: "opacity 0.2s",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              Começar 15 dias grátis <ArrowRight size={16} />
            </Link>

            {/* Sublinha segurança */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              marginTop: 10, marginBottom: 24,
            }}>
              <Lock size={11} style={{ color: "#9CA3AF" }} />
              <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                Sem cartão agora · Cancela quando quiser
              </span>
            </div>

            {/* Divisória */}
            <div style={{ borderTop: "1px solid #F3F4F6", marginBottom: 24 }} />

            {/* Lista de features */}
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {features.map(({ text }, i) => (
                <li key={text}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 0",
                  }}>
                    {/* Ícone check ciano */}
                    <div style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                      background: `${SECONDARY}18`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Check size={11} style={{ color: SECONDARY, strokeWidth: 3 }} />
                    </div>
                    <span style={{ fontSize: 13.5, color: "#374151" }}>{text}</span>
                  </div>
                  {/* Separador entre itens */}
                  {i < features.length - 1 && (
                    <div style={{ borderTop: "1px solid #F9FAFB", marginLeft: 32 }} />
                  )}
                </li>
              ))}
            </ul>

          </div>
        </div>
      </section>

      {/* ── Cards de garantia (2×2) ─────────────────────────────────────────── */}
      <section style={{ padding: "0 1rem 64px" }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <h2 style={{
            textAlign: "center", fontSize: 16, fontWeight: 700,
            color: "#111", marginBottom: 20,
          }}>
            Por que a gente?
          </h2>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
          }}>
            {guarantees.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: "#fff", border: "1px solid #e5e7eb",
                borderRadius: 14, padding: "18px 16px",
              }}>
                {/* Ícone com gradiente */}
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: GRAD,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 10,
                }}>
                  <Icon size={16} style={{ color: "#fff" }} />
                </div>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 3 }}>{title}</p>
                <p style={{ fontSize: 12, color: "#6B7280" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────────────── */}
      <section style={{ padding: "0 1rem 80px" }}>
        <div style={{ maxWidth: 480, margin: "0 auto" }}>
          <h2 style={{
            textAlign: "center", fontSize: 16, fontWeight: 700,
            color: "#111", marginBottom: 24,
          }}>
            Perguntas frequentes
          </h2>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, overflow: "hidden" }}>
            {faqs.map(({ q, a }, i) => {
              const open = openFaq === i;
              return (
                <div key={q} style={{ borderBottom: i < faqs.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center",
                      justifyContent: "space-between", gap: 12,
                      padding: "16px 20px", background: "none", border: "none",
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "#111" }}>{q}</span>
                    <ChevronDown
                      size={16}
                      style={{
                        color: PRIMARY, flexShrink: 0,
                        transition: "transform 0.25s",
                        transform: open ? "rotate(180deg)" : "rotate(0deg)",
                      }}
                    />
                  </button>
                  <div style={{
                    overflow: "hidden", maxHeight: open ? 200 : 0,
                    transition: "max-height 0.3s ease",
                  }}>
                    <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.7, padding: "0 20px 16px" }}>
                      {a}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA final ───────────────────────────────────────────────────────── */}
      <section style={{ background: GRAD, padding: "64px 1rem", textAlign: "center" }}>
        <h2 style={{
          fontSize: 26, fontWeight: 900, color: "#fff",
          marginBottom: 10, letterSpacing: "-0.5px",
        }}>
          Pronto para começar?
        </h2>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.8)", marginBottom: 32 }}>
          15 dias grátis. Sem cartão. Cancela quando quiser.
        </p>
        <Link
          to="/auth?register=1"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#fff", color: PRIMARY,
            padding: "14px 32px", borderRadius: 12,
            fontWeight: 700, fontSize: 15, textDecoration: "none",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
          }}
        >
          Criar conta grátis <ArrowRight size={16} />
        </Link>
      </section>

      {/* ── Rodapé ──────────────────────────────────────────────────────────── */}
      <footer style={{
        background: "#fff", borderTop: "1px solid #e5e7eb",
        padding: "32px 1rem", textAlign: "center",
      }}>
        {/* Pills de confiança */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          flexWrap: "wrap", gap: 10, marginBottom: 20,
        }}>
          {["Mercado Pago", "Vercel", "Supabase"].map(name => (
            <div key={name} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#F8F9FA", border: "1px solid #e5e7eb",
              borderRadius: 999, padding: "5px 14px",
            }}>
              <Shield size={12} style={{ color: SECONDARY }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{name}</span>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 4 }}>
          © {new Date().getFullYear()} Flowify POS. Todos os direitos reservados.
        </p>
        <p style={{ fontSize: 11, color: "#D1D5DB" }}>
          Pagamentos processados pelo Mercado Pago · Hospedado na Vercel · Dados seguros no Supabase
        </p>
      </footer>

    </div>
  );
}
