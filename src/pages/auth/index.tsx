import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  Eye, EyeOff, CheckCircle2, Gift,
  Monitor, Mic, Boxes, Banknote,
  QrCode, Wallet, FileText, BarChart3,
} from "lucide-react";
import { AvaliacoesPublicas } from "../../components/AvaliacoesPublicas";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908C16.658 14.013 17.64 11.705 17.64 9.205Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

// ─── SCREENSHOTS REAIS DO SISTEMA ────────────────────────────────────────────
// Substitua as URLs abaixo pelos prints reais enviados ao Supabase Storage

// ─── DADOS ────────────────────────────────────────────────────────────────────

const screens = [
  { id: "dashboard", label: "Dashboard",        url: "https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2015%20de%20jun.%20de%202026,%2023_27_14.png" },
  { id: "pdv",       label: "PDV",              url: "https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/pdv.png" },
  { id: "caixa",     label: "Caixa",            url: "https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/caixa.png" },
  { id: "cardapio",  label: "Cardápio Digital", url: "https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/cardapio%20digital.png" },
];

const features = [
  { icon: Monitor,   color: "#8b5cf6", text: "PDV Tudo em Um",                  desc: "Abre, vende e fecha sem trocar de aba. Atalhos rápidos para os mais vendidos." },
  { icon: Mic,       color: "#f59e0b", text: "Lançamento por Voz",               desc: "Fale o valor e a categoria — o sistema registra sozinho, sem digitar nada." },
  { icon: Boxes,     color: "#3b82f6", text: "Estoque Unificado",                desc: "PDV, mesas e cardápio compartilham o mesmo estoque — zero risco de vender o que não tem." },
  { icon: Banknote,  color: "#10b981", text: "Troco e Pagamento Automático",     desc: "Troco calculado na hora, todas as formas de pagamento, checkout completo na mesma tela." },
  { icon: QrCode,    color: "#06b6d4", text: "Cardápio Digital com Chat",        desc: "QR Code, alertas de pedido, despacho e chat com o cliente — sem aplicativo de terceiro." },
  { icon: Wallet,    color: "#22c55e", text: "Caixa e Finanças em Tempo Real",   desc: "Entradas, saídas e estimativa de lucro atualizados a cada venda no dashboard." },
  { icon: FileText,  color: "#f97316", text: "Contas a Pagar Simples ou Completa", desc: "Lance rápido por voz ou importe via XML de nota fiscal — do básico ao controle total." },
  { icon: BarChart3, color: "#a855f7", text: "Relatórios que Fazem Sentido",    desc: "Ranking de produtos, vendedores e clientes. Dados reais pra decisões reais." },
];

const honestCards = [
  { value: "Lançado em 2026", label: "em crescimento" },
  { value: "15 dias grátis",  label: "cancela quando quiser" },
  { value: "Suporte real",    label: "resposta rápida" },
];

// ─── PÁGINA ───────────────────────────────────────────────────────────────────

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [currentScreen, setCurrentScreen] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentScreen((s) => (s + 1) % screens.length), 3500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token) {
      setInviteToken(token);
      setMode("register");
    }
    // Vindo da página de planos: abre direto em criar conta
    if (params.get("register") === "1") {
      setMode("register");
    }
  }, []);

  function clearMessages() {
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    clearMessages();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/" },
    });
    if (error) {
      setErrorMessage("Erro ao entrar com Google. Tente novamente.");
      setGoogleLoading(false);
    }
  }

  async function handleLogin(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    clearMessages();

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      setErrorMessage("E-mail ou senha inválidos.");
      setLoading(false);
      return;
    }

    if (inviteToken) localStorage.setItem("pending_invite", inviteToken);
    setSuccessMessage("Login realizado com sucesso!");
    setTimeout(() => { window.location.href = "/"; }, 400);
    setLoading(false);
  }

  async function handleRegister(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    clearMessages();

    if (!companyName || !fullName || !email || !password) {
      setErrorMessage("Preencha todos os campos.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, company_name: companyName } },
    });

    if (error) {
      setErrorMessage(error.message);
      setLoading(false);
      return;
    }

    if (inviteToken) localStorage.setItem("pending_invite", inviteToken);
    setSuccessMessage("Conta criada! Verifique seu e-mail e depois faça login.");
    setTimeout(() => { setMode("login"); setPassword(""); }, 1200);
    setLoading(false);
  }

  function switchMode() {
    setMode(mode === "login" ? "register" : "login");
    clearMessages();
  }

  const activeScreen = screens[currentScreen];

  return (
    <div className="flex" style={{ height: "100vh", overflow: "hidden", background: "#ffffff", color: "#111" }}>

      {/* PAINEL ESQUERDO */}
      <div className="hidden lg:flex w-1/2 relative flex-col justify-between border-r" style={{ height: "100vh", overflowY: "auto", padding: "0px 40px 40px 40px", borderColor: "#e5e7eb", background: "#ffffff" }}>

        <div className="relative z-10 flex flex-col gap-4">

          {/* Logo */}
          <img
            src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2021%20de%20mai.%20de%202026,%2019_48_48.png"
            alt="Logo"
            style={{ height: 150, width: "auto", display: "block", alignSelf: "center", imageRendering: "auto", marginBottom: -20 }}
          />

          {/* Headline */}
          <div className="text-center">
            <h2 className="text-3xl font-bold leading-tight mb-2" style={{ color: "#111" }}>
              Seu negócio no{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#7B2FBE] to-[#00B4D8]">
                próximo nível
              </span>
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: "#6B7280" }}>
              Sistema completo para PDV, delivery e restaurantes — tudo em um só lugar.
            </p>
          </div>

          {/* Carrossel de telas */}
          <div>
            <div className="flex gap-2 mb-3">
              {screens.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentScreen(i)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={currentScreen === i
                    ? {
                        background: "#2563EB",
                        boxShadow: "0 4px 14px rgba(37,99,235,0.35)",
                        color: "#ffffff",
                        WebkitTextFillColor: "#ffffff"
                      }
                    : { background: "#F3F4F6", color: "#6B7280" }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="rounded-xl overflow-hidden shadow-xl" style={{ height: 350, border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(123,47,190,0.08)" }}>
              {activeScreen.url ? (
                <img
                  src={activeScreen.url}
                  alt={activeScreen.label}
                  className="w-full h-full"
                  style={{ objectFit: "contain", objectPosition: "center" }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2"
                  style={{ background: "#F8F9FA" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ border: "1px solid #e5e7eb" }}>
                    <span className="text-xs" style={{ color: "#9CA3AF" }}>📷</span>
                  </div>
                  <p className="text-xs" style={{ color: "#9CA3AF" }}>{activeScreen.label}</p>
                  <p className="text-[10px]" style={{ color: "#D1D5DB" }}>aguardando screenshot</p>
                </div>
              )}
            </div>
            <div className="flex justify-center gap-1.5 mt-3">
              {screens.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentScreen(i)}
                  style={{ borderRadius: 99, transition: "all 0.3s", width: currentScreen === i ? 16 : 6, height: 6, background: currentScreen === i ? "#2563EB" : "#D1D5DB" }}
                />
              ))}
            </div>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-2">
            {features.map(({ icon: Icon, color, text, desc }) => (
              <div key={text}
                className="flex items-start gap-2.5 rounded-xl p-2.5 border transition-all"
                style={{ background: `${color}06`, borderColor: `${color}20` }}>
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: `${color}15`, border: `1px solid ${color}30` }}>
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold leading-tight" style={{ color: "#111" }}>{text}</div>
                  <div className="text-[10px] leading-tight mt-0.5" style={{ color: "#9CA3AF" }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Avaliações reais — some automaticamente se não houver nenhuma aprovada */}
          <AvaliacoesPublicas />

          {/* Cards honestos */}
          <div className="grid grid-cols-3 gap-2 pt-4" style={{ borderTop: "1px solid #e5e7eb" }}>
            {honestCards.map(({ value, label }) => (
              <div key={value} className="rounded-xl overflow-hidden text-center" style={{ border: "1px solid #e5e7eb" }}>
                <div style={{ height: 3, background: "#2563EB" }} />
                <div className="p-3">
                  <p className="text-xs font-bold leading-tight" style={{ color: "#111" }}>{value}</p>
                  <p className="text-[10px] mt-0.5 leading-tight" style={{ color: "#9CA3AF" }}>{label}</p>
                </div>
              </div>
            ))}
          </div>

        </div>

        <div className="relative z-10 mt-6 space-y-1">
          <p className="text-xs" style={{ color: "#9CA3AF" }}>
            © {new Date().getFullYear()} Flowify POS. Todos os direitos reservados.
          </p>
          <p className="text-[10px]" style={{ color: "#D1D5DB" }}>
            Pagamentos processados pelo Mercado Pago · Hospedado na Vercel · Dados seguros no Supabase
          </p>
        </div>
      </div>

      {/* PAINEL DIREITO */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6" style={{ height: "100vh", overflowY: "auto", background: "#ffffff" }}>
        <div className="w-full max-w-md">

          {/* Logo mobile */}
          <div className="flex lg:hidden justify-center mb-8">
            <img
              src="https://omsjsgnyjjuvixwyevox.supabase.co/storage/v1/object/public/menu-assets/ChatGPT%20Image%2021%20de%20mai.%20de%202026,%2019_48_48.png"
              alt="Logo"
              style={{ height: 140, width: "auto", display: "block", imageRendering: "auto", maxWidth: "90%" }}
            />
          </div>

          {/* Invite banner */}
          {inviteToken && (
            <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: "rgba(123,47,190,0.08)", border: "1px solid rgba(123,47,190,0.25)" }}>
              <Gift size={16} style={{ color: "#7B2FBE", flexShrink: 0 }} />
              <p className="text-sm font-medium" style={{ color: "#7B2FBE" }}>
                Você foi convidado! Crie sua conta para ativar o acesso.
              </p>
            </div>
          )}

          <div className="rounded-2xl p-8 shadow-xl" style={{ background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 4px 32px rgba(0,0,0,0.07)" }}>

            <div className="mb-6">
              <h2 className="text-2xl font-bold" style={{ color: "#111" }}>
                {mode === "login" ? "Bem-vindo de volta" : "Crie sua conta"}
              </h2>
              <p className="text-sm mt-1" style={{ color: "#6B7280" }}>
                {mode === "login"
                  ? "Entre na sua conta para continuar"
                  : "Comece a usar o Flowify POS hoje mesmo"}
              </p>
            </div>

            {/* Botão Google */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleLoading || loading}
              className="w-full flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm py-2.5 px-4 rounded-lg transition-colors duration-200 mb-4"
              style={{ background: "#fff", color: "#374151", border: "1px solid #e5e7eb" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#F9FAFB")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
            >
              <GoogleIcon />
              {googleLoading ? "Redirecionando..." : "Continuar com Google"}
            </button>

            {/* Divisor */}
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t" style={{ borderColor: "#e5e7eb" }} />
              </div>
              <div className="relative flex justify-center">
                <span className="px-3 text-xs" style={{ background: "#fff", color: "#9CA3AF" }}>ou continue com e-mail</span>
              </div>
            </div>

            {/* Mensagens */}
            {errorMessage && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-600 text-sm p-3 rounded-lg">
                {errorMessage}
              </div>
            )}
            {successMessage && (
              <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm p-3 rounded-lg flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                {successMessage}
              </div>
            )}

            {/* Formulário */}
            <form onSubmit={mode === "login" ? handleLogin : handleRegister} className="space-y-3.5">

              {mode === "register" && (
                <>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                      Nome da empresa
                    </label>
                    <input
                      placeholder="Ex: Restaurante Bom Sabor"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-lg text-sm transition-all focus:outline-none focus:ring-1"
                      style={{ background: "#fff", border: "1px solid #e5e7eb", color: "#111" }}
                      onFocus={e => { e.currentTarget.style.borderColor = "#7B2FBE"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,47,190,0.1)"; }}
                      onBlur={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none"; }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>
                      Seu nome completo
                    </label>
                    <input
                      placeholder="Ex: João Silva"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-lg text-sm transition-all focus:outline-none focus:ring-1"
                      style={{ background: "#fff", border: "1px solid #e5e7eb", color: "#111" }}
                      onFocus={e => { e.currentTarget.style.borderColor = "#7B2FBE"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,47,190,0.1)"; }}
                      onBlur={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none"; }}
                    />
                  </div>
                </>
              )}

              <div>
                <p className="text-center text-xs mb-3" style={{ color: "#9CA3AF" }}>15 dias grátis · sem cartão de crédito</p>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "#374151" }}>E-mail</label>
                <input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg text-sm transition-all focus:outline-none"
                  style={{ background: "#fff", border: "1px solid #e5e7eb", color: "#111" }}
                  onFocus={e => { e.currentTarget.style.borderColor = "#7B2FBE"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,47,190,0.1)"; }}
                  onBlur={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium" style={{ color: "#374151" }}>Senha</label>
                  {mode === "login" && (
                    <button
                      type="button"
                      className="text-xs transition-colors"
                      style={{ color: "#7B2FBE" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#00B4D8")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#7B2FBE")}
                    >
                      Esqueci minha senha
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder={mode === "register" ? "Mínimo 8 caracteres" : "••••••••"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 pr-11 rounded-lg text-sm transition-all focus:outline-none"
                    style={{ background: "#fff", border: "1px solid #e5e7eb", color: "#111" }}
                    onFocus={e => { e.currentTarget.style.borderColor = "#7B2FBE"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(123,47,190,0.1)"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: "#9CA3AF" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#374151")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#9CA3AF")}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || googleLoading}
                className="w-full disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm py-2.5 rounded-lg transition-all duration-200 mt-1"
                style={{ background: "#2563EB", boxShadow: "0 4px 14px rgba(37,99,235,0.3)", color: "#FFFFFF", textDecoration: "none" }}
              >
                {loading
                  ? "Carregando..."
                  : mode === "login"
                  ? "Entrar"
                  : "Criar conta grátis"}
              </button>

              <Link
                to="/planos"
                className="block w-full text-center py-2.5 rounded-lg text-sm font-medium transition-all"
                style={{
                  border: "1px solid #e5e7eb",
                  color: "#6B7280",
                  backgroundColor: "transparent !important"
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "#2563EB";
                  (e.currentTarget as HTMLAnchorElement).style.color = "#2563EB";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "#e5e7eb";
                  (e.currentTarget as HTMLAnchorElement).style.color = "#6B7280";
                }}
              >
                Ver planos
              </Link>
            </form>

            <p className="mt-5 text-center text-sm" style={{ color: "#6B7280" }}>
              {mode === "login" ? "Não tem uma conta?" : "Já tem uma conta?"}{" "}
              <button
                onClick={switchMode}
                className="font-medium transition-colors"
                style={{ color: "#2563EB" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#1D4ED8")}
                onMouseLeave={e => (e.currentTarget.style.color = "#2563EB")}
              >
                {mode === "login" ? "Criar agora" : "Entrar"}
              </button>
            </p>
          </div>

          {/* Ver planos */}
          <div className="mt-4 text-center">
            <Link
              to="/planos"
              className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
              style={{ color: "#2563EB" }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#1D4ED8")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#2563EB")}
            >
              Ver planos e preços
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
          </div>

          {/* Termos e Privacidade */}
          <p className="mt-4 text-center text-xs leading-relaxed" style={{ color: "#9CA3AF" }}>
            Ao continuar, você concorda com nossos{" "}
            <Link to="/terms" className="underline underline-offset-2 transition-colors" style={{ color: "#6B7280" }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#374151")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#6B7280")}
            >
              Termos de Uso
            </Link>{" "}
            e{" "}
            <Link to="/privacy" className="underline underline-offset-2 transition-colors" style={{ color: "#6B7280" }}
              onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#374151")}
              onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.color = "#6B7280")}
            >
              Política de Privacidade
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
