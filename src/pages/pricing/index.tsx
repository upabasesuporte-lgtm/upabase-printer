import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Check, Lock, ChevronDown, Shield, HeadphonesIcon, Zap, ArrowRight, Star } from "lucide-react";
import { PLAN_INFO, PlanType, getMpCheckoutUrl } from "../../lib/plans";
import { supabase } from "../../lib/supabase";

const PRIMARY   = "#7B2FBE";
const GRAD      = `linear-gradient(135deg, ${PRIMARY}, #00B4D8)`;
const GRAD_90   = `linear-gradient(90deg,  ${PRIMARY}, #00B4D8)`;

const guarantees = [
  { icon: Zap,            title: "15 dias grátis",        desc: "Sem cartão de crédito" },
  { icon: Lock,           title: "Cancela quando quiser", desc: "Sem fidelidade" },
  { icon: HeadphonesIcon, title: "Suporte real",          desc: "Resposta rápida" },
  { icon: Shield,         title: "Dados seguros",         desc: "Criptografados no Supabase" },
];

const faqs = [
  { q: "Preciso de cartão para começar?",
    a: "Não. Os 15 dias de teste são completamente grátis e sem cartão. Você só informa o pagamento quando decidir continuar." },
  { q: "Posso cancelar a qualquer momento?",
    a: "Sim, sem multa e sem burocracia. Basta entrar em contato e cancelamos na hora." },
  { q: "Posso trocar de plano depois?",
    a: "Sim. Entre em contato com o suporte e migramos seu plano sem perda de dados." },
  { q: "Funciona no celular e no computador?",
    a: "Sim. O sistema roda no navegador — computador, tablet ou celular, sem precisar instalar nada." },
];

const PLAN_ORDER: PlanType[] = ["loja", "delivery", "pro"];

export default function PricingPage() {
  const [annual,  setAnnual]  = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  return (
    <div style={{ background: "#F8F9FA", minHeight: "100vh", fontFamily: "inherit" }}>

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section style={{ textAlign: "center", padding: "8px 1rem 32px" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: -20 }}>
          <img
            src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2021%20de%20mai.%20de%202026,%2019_48_48.png"
            alt="Logo" style={{ height: 200, width: "auto" }}
          />
        </div>

        <p style={{ fontSize: 14, color: "#6B7280", marginBottom: 24 }}>
          Escolha o plano ideal para o seu negócio
        </p>

        {/* Toggle Mensal / Anual */}
        <div style={{ display: "inline-flex", background: "#e5e7eb", borderRadius: 14, padding: 4, gap: 2 }}>
          {[{ label: "Mensal", isAnnual: false }, { label: "Anual", isAnnual: true }].map(({ label, isAnnual }) => {
            const active = annual === isAnnual;
            return (
              <button key={label} onClick={() => setAnnual(isAnnual)} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "9px 20px", borderRadius: 11, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600,
                background: active ? "#fff" : "transparent",
                color: active ? "#111" : "#6B7280",
                boxShadow: active ? "0 1px 6px rgba(0,0,0,0.12)" : "none",
                transition: "all 0.2s",
              }}>
                {label}
                {isAnnual && (
                  <span style={{ background: GRAD, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999 }}>
                    −18%
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Cards dos planos ──────────────────────────────────────────────────── */}
      <section style={{ padding: "0 1rem 64px" }}>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 20,
          justifyContent: "center", maxWidth: 1100, margin: "0 auto",
        }}>
          {PLAN_ORDER.map(key => {
            const p = PLAN_INFO[key];
            const price  = annual ? p.price_annual_monthly : p.price_monthly;
            const mpId   = annual ? p.mp_id_annual : p.mp_id_monthly;
            const isHighlight = p.highlight;

            return (
              <div key={key} style={{
                width: "100%", maxWidth: 330,
                background: "#fff",
                border: isHighlight ? `2px solid ${p.color}` : "1px solid #e5e7eb",
                borderRadius: 20,
                boxShadow: isHighlight
                  ? `0 8px 40px ${p.color}22`
                  : "0 4px 20px rgba(0,0,0,0.06)",
                overflow: "hidden",
                position: "relative",
                transition: "transform 0.2s",
              }}>
                {/* Faixa cor do plano */}
                <div style={{ height: 4, background: p.color }} />

                {isHighlight && (
                  <div style={{
                    position: "absolute", top: 16, right: 16,
                    background: p.color, color: "#fff",
                    fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    display: "flex", alignItems: "center", gap: 4,
                  }}>
                    <Star size={9} /> Mais popular
                  </div>
                )}

                <div style={{ padding: "24px 24px 28px" }}>
                  {/* Nome + descrição */}
                  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: p.color, marginBottom: 4 }}>
                    {p.label}
                  </p>
                  <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 20 }}>
                    {p.description}
                  </p>

                  {/* Preço */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 2, marginBottom: 4 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: p.color, marginTop: 10 }}>R$</span>
                    <span style={{
                      fontSize: 58, fontWeight: 900, lineHeight: 1, color: p.color,
                    }}>
                      {String(Math.floor(price))}
                    </span>
                    {!Number.isInteger(price) && (
                      <span style={{ fontSize: 16, fontWeight: 700, color: p.color, marginTop: 38 }}>
                        ,{String(price.toFixed(2)).split(".")[1]}
                      </span>
                    )}
                    <span style={{ fontSize: 13, color: "#9CA3AF", fontWeight: 500, marginTop: 42 }}>/mês</span>
                  </div>

                  {annual && (
                    <p style={{ fontSize: 12, color: p.color, fontWeight: 600, marginBottom: 20 }}>
                      R$ {p.price_annual_total.toFixed(2).replace(".", ",")} cobrado anualmente
                    </p>
                  )}
                  {!annual && <div style={{ marginBottom: 20 }} />}

                  {/* CTA — se logado vai direto pro MP, senão vai pro cadastro */}
                  {userEmail ? (
                    <a
                      href={getMpCheckoutUrl(mpId, userEmail)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", padding: "13px 0",
                        background: p.color, color: "#fff",
                        borderRadius: 12, fontWeight: 700, fontSize: 14,
                        textDecoration: "none", boxShadow: `0 4px 14px ${p.color}44`,
                        transition: "opacity 0.2s",
                      }}
                    >
                      Assinar {p.label} <ArrowRight size={15} />
                    </a>
                  ) : (
                    <Link
                      to="/auth?register=1"
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        width: "100%", padding: "13px 0",
                        background: p.color, color: "#fff",
                        borderRadius: 12, fontWeight: 700, fontSize: 14,
                        textDecoration: "none", boxShadow: `0 4px 14px ${p.color}44`,
                      }}
                    >
                      Começar 15 dias grátis <ArrowRight size={15} />
                    </Link>
                  )}

                  <p style={{ fontSize: 11, color: "#9CA3AF", textAlign: "center", marginTop: 8 }}>
                    {userEmail ? "Pagamento via Mercado Pago" : "Sem cartão de crédito agora"}
                  </p>

                  {/* Divisória */}
                  <div style={{ borderTop: "1px solid #F3F4F6", margin: "20px 0" }} />

                  {/* Features */}
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {p.features.map((feat, i) => (
                      <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0" }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1,
                          background: `${p.color}18`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <Check size={10} style={{ color: p.color, strokeWidth: 3 }} />
                        </div>
                        <span style={{ fontSize: 13, color: "#374151", lineHeight: 1.4 }}>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Garantias ─────────────────────────────────────────────────────────── */}
      <section style={{ padding: "0 1rem 64px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontSize: 22, fontWeight: 800, color: "#111", marginBottom: 32 }}>
            Sem risco. Sem complicação.
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
            {guarantees.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: "#fff", borderRadius: 16, padding: "20px 24px",
                border: "1px solid #e5e7eb", textAlign: "center",
                minWidth: 160, flex: "1 1 160px", maxWidth: 220,
              }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${PRIMARY}12`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <Icon size={18} style={{ color: PRIMARY }} />
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#111", marginBottom: 4 }}>{title}</p>
                <p style={{ fontSize: 12, color: "#9CA3AF" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────────── */}
      <section style={{ padding: "0 1rem 80px" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <h2 style={{ textAlign: "center", fontSize: 22, fontWeight: 800, color: "#111", marginBottom: 32 }}>
            Perguntas frequentes
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {faqs.map(({ q, a }, i) => {
              const open = openFaq === i;
              return (
                <div key={i} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "16px 20px", background: "none", border: "none", cursor: "pointer",
                      textAlign: "left", gap: 12,
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>{q}</span>
                    <ChevronDown size={16} style={{ color: "#9CA3AF", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
                  </button>
                  {open && (
                    <div style={{ padding: "0 20px 16px" }}>
                      <p style={{ fontSize: 13.5, color: "#6B7280", lineHeight: 1.6, margin: 0 }}>{a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid #e5e7eb", padding: "24px 1rem", textAlign: "center" }}>
        <p style={{ fontSize: 12, color: "#9CA3AF" }}>
          © 2025 UpaBase · Pagamentos via{" "}
          <span style={{ fontWeight: 600, color: PRIMARY }}>Mercado Pago</span>
          {" "}· Dados seguros com{" "}
          <span style={{ fontWeight: 600, color: PRIMARY }}>Supabase</span>
        </p>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "center", gap: 16 }}>
          <Link to="/privacy" style={{ fontSize: 11, color: "#9CA3AF", textDecoration: "none" }}>Privacidade</Link>
          <Link to="/terms"   style={{ fontSize: 11, color: "#9CA3AF", textDecoration: "none" }}>Termos</Link>
          <Link to="/auth"    style={{ fontSize: 11, color: "#9CA3AF", textDecoration: "none" }}>Entrar</Link>
        </div>
      </footer>
    </div>
  );
}
