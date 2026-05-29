import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { Star, X, Upload, RefreshCw, CheckCircle2, Camera } from "lucide-react";

interface Props {
  open: boolean;
  userId: string;
  avatarUrl?: string | null;   // foto de perfil já salva
  onClose: () => void;
}

const inputCls =
  "w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/10 transition-all";

const LABELS = ["", "Ruim", "Regular", "Bom", "Ótimo", "Excelente!"];

export function AvaliacaoModal({ open, userId, avatarUrl, onClose }: Props) {
  const [nome, setNome]             = useState("");
  const [estrelas, setEstrelas]     = useState(0);
  const [hover, setHover]           = useState(0);
  const [texto, setTexto]           = useState("");
  const [consentido, setConsentido] = useState(false);
  const [fotoFile, setFotoFile]     = useState<File | null>(null);
  // fotoPreview: null = sem foto, string = URL para exibir
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [sucesso, setSucesso]       = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Toda vez que o modal abre: pré-carregar a foto de perfil existente
  useEffect(() => {
    if (open) {
      setFotoPreview(avatarUrl ?? null);
      setFotoFile(null);      // garante que não sobra arquivo de uma abertura anterior
    }
  }, [open, avatarUrl]);

  if (!open) return null;

  // Foto que será salva no banco:
  // • novo arquivo selecionado → faz upload
  // • nenhum arquivo mas preview === avatarUrl → reutiliza a URL do perfil diretamente
  // • nenhum dos dois → null
  async function resolverFotoUrl(): Promise<string | null> {
    if (fotoFile) {
      const ext  = fotoFile.name.split(".").pop() ?? "jpg";
      const path = `${userId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avaliacoes")
        .upload(path, fotoFile, { upsert: true, contentType: fotoFile.type });
      if (upErr) throw new Error("Erro ao enviar foto. Tente sem foto ou tente novamente.");
      const { data: pub } = supabase.storage.from("avaliacoes").getPublicUrl(path);
      return pub.publicUrl;
    }
    // sem novo arquivo: usa o preview que veio do perfil (se houver)
    return fotoPreview ?? null;
  }

  async function handleSubmit() {
    if (!nome.trim())  { setError("Informe seu nome.");                   return; }
    if (estrelas < 1)  { setError("Selecione a quantidade de estrelas."); return; }
    if (!texto.trim()) { setError("Escreva sua avaliação.");              return; }
    if (!consentido)   { setError("Aceite o termo para publicar.");       return; }

    setLoading(true);
    setError(null);

    let foto_url: string | null = null;
    try {
      foto_url = await resolverFotoUrl();
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
      return;
    }

    const { error: insErr } = await supabase.from("avaliacoes").insert({
      usuario_id: userId,
      nome:       nome.trim(),
      foto_url,
      estrelas,
      texto:      texto.trim(),
      aprovado:   false,
    });

    if (insErr) {
      setError("Erro ao enviar: " + insErr.message);
      setLoading(false);
      return;
    }

    setSucesso(true);
    setLoading(false);
  }

  function handleClose() {
    setSucesso(false);
    setNome(""); setEstrelas(0); setHover(0);
    setTexto(""); setConsentido(false);
    setFotoFile(null); setFotoPreview(null); setError(null);
    onClose();
  }

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFotoFile(file);
    setFotoPreview(URL.createObjectURL(file));
  }

  // Indica se a foto exibida veio do perfil (não é um novo upload)
  const usingAvatar = !!fotoPreview && !fotoFile;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-white">Deixar Avaliação</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Sua opinião nos ajuda a melhorar</p>
          </div>
          <button onClick={handleClose} className="p-1.5 text-zinc-400 hover:text-white rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {sucesso ? (
          /* ── Tela de sucesso ─────────────────────────────────────────────── */
          <div className="p-8 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-base font-bold text-white">Avaliação enviada!</p>
            <p className="text-sm text-zinc-400">
              Obrigado pelo feedback. Sua avaliação será revisada e publicada em breve.
            </p>
            <button onClick={handleClose}
              className="mt-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-bold transition-colors">
              Fechar
            </button>
          </div>
        ) : (
          /* ── Formulário ──────────────────────────────────────────────────── */
          <div className="p-6 space-y-4">

            {/* Foto — pré-carregada do perfil ou upload manual */}
            <div className="flex items-center gap-4">
              {/* Círculo clicável */}
              <div className="relative flex-shrink-0">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  title={fotoPreview ? "Clique para trocar a foto" : "Clique para adicionar foto"}
                  className="w-16 h-16 rounded-full border-2 flex items-center justify-center overflow-hidden transition-all group"
                  style={{
                    borderColor: usingAvatar ? "#10b981" : fotoFile ? "#7c3aed" : "#3f3f46",
                    borderStyle: fotoPreview ? "solid" : "dashed",
                  }}
                >
                  {fotoPreview ? (
                    <>
                      <img src={fotoPreview} className="w-full h-full object-cover" alt="preview" />
                      {/* Overlay de troca ao passar o mouse */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full">
                        <Camera className="w-5 h-5 text-white" />
                      </div>
                    </>
                  ) : (
                    <Upload className="w-5 h-5 text-zinc-600" />
                  )}
                </button>

                {/* Badge verde quando usa foto do perfil */}
                {usingAvatar && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-emerald-500 border-2 border-zinc-900 flex items-center justify-center">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </div>
                )}
              </div>

              {/* Texto descritivo */}
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-300">
                  {usingAvatar
                    ? "Foto do perfil"
                    : fotoFile
                      ? "Nova foto selecionada"
                      : "Foto do perfil"}
                  {" "}
                  <span className="text-zinc-600">(opcional)</span>
                </p>
                <p className="text-xs mt-0.5"
                  style={{ color: usingAvatar ? "#10b981" : "#52525b" }}>
                  {usingAvatar
                    ? "✓ Carregada automaticamente do perfil"
                    : fotoFile
                      ? "✓ Foto pronta para envio"
                      : "Nenhuma foto — clique no círculo para adicionar"}
                </p>
                {fotoPreview && (
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    className="text-xs text-violet-400 hover:text-violet-300 mt-0.5 transition-colors"
                  >
                    Clique para trocar →
                  </button>
                )}
              </div>

              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFoto} />
            </div>

            {/* Nome */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Seu nome *</label>
              <input
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Como quer ser identificado..."
                className={inputCls}
              />
            </div>

            {/* Estrelas */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-2">Avaliação *</label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEstrelas(s)}
                    onMouseEnter={() => setHover(s)}
                    onMouseLeave={() => setHover(0)}
                    className="p-1 transition-transform hover:scale-110 active:scale-95"
                  >
                    <Star className={`w-7 h-7 transition-colors ${(hover || estrelas) >= s ? "fill-amber-400 text-amber-400" : "text-zinc-700"}`} />
                  </button>
                ))}
                {estrelas > 0 && (
                  <span className="ml-1 text-xs font-semibold text-amber-400">{LABELS[estrelas]}</span>
                )}
              </div>
            </div>

            {/* Texto */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Sua opinião *</label>
              <textarea
                value={texto}
                onChange={e => setTexto(e.target.value)}
                placeholder="Conte como o sistema te ajudou no dia a dia..."
                rows={3}
                className={inputCls + " resize-none"}
              />
            </div>

            {/* Consent */}
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consentido}
                onChange={e => setConsentido(e.target.checked)}
                className="mt-0.5 w-4 h-4 flex-shrink-0 accent-violet-500"
              />
              <span className="text-xs text-zinc-400 leading-relaxed">
                Aceito que minha avaliação apareça publicamente no site, incluindo nome e foto.
              </span>
            </label>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition-colors"
            >
              {loading
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Enviando...</>
                : "Enviar Avaliação"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
