import { Link } from "react-router-dom";
import { Zap, ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base">Flowify POS</span>
          </div>
          <Link
            to="/auth"
            className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Link>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-3">Política de Privacidade</h1>
          <p className="text-zinc-400 text-sm">Última atualização: {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8 text-zinc-300 text-sm leading-relaxed">

          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <p className="text-zinc-300">
              No Flowify POS, sua privacidade é nossa prioridade. Esta política descreve como
              coletamos, usamos e protegemos suas informações pessoais de acordo com a
              <strong className="text-white"> Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018)</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Informações que Coletamos</h2>
            <p className="mb-3">Coletamos os seguintes tipos de informações:</p>
            <div className="space-y-3">
              {[
                {
                  title: "Informações de cadastro",
                  desc: "Nome, e-mail, nome da empresa e senha (armazenada com criptografia).",
                },
                {
                  title: "Dados de uso",
                  desc: "Informações sobre como você utiliza a plataforma, como pedidos, produtos e relatórios gerados.",
                },
                {
                  title: "Dados técnicos",
                  desc: "Endereço IP, tipo de navegador, sistema operacional e páginas acessadas.",
                },
                {
                  title: "Cookies",
                  desc: "Utilizamos cookies essenciais para manter sua sessão ativa e melhorar sua experiência.",
                },
              ].map(({ title, desc }) => (
                <div key={title} className="flex gap-3">
                  <div className="w-1.5 h-1.5 bg-violet-500 rounded-full mt-1.5 flex-shrink-0" />
                  <p><strong className="text-white">{title}:</strong> {desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Como Usamos seus Dados</h2>
            <p className="mb-3">Utilizamos suas informações para:</p>
            <ul className="space-y-2 list-disc list-inside text-zinc-400">
              <li>Fornecer, operar e melhorar o serviço Flowify POS.</li>
              <li>Autenticar sua identidade e proteger sua conta.</li>
              <li>Enviar comunicações sobre atualizações, novidades e suporte.</li>
              <li>Gerar relatórios e estatísticas agregadas (sem identificação pessoal).</li>
              <li>Cumprir obrigações legais e regulatórias.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Compartilhamento de Dados</h2>
            <p className="mb-3">
              Não vendemos suas informações pessoais. Podemos compartilhar dados apenas nas seguintes situações:
            </p>
            <ul className="space-y-2 list-disc list-inside text-zinc-400">
              <li>
                <strong className="text-white">Prestadores de serviço:</strong> parceiros que nos auxiliam na operação da plataforma (como serviços de cloud e pagamento), sob acordos de confidencialidade.
              </li>
              <li>
                <strong className="text-white">Obrigação legal:</strong> quando exigido por lei, ordem judicial ou autoridade governamental.
              </li>
              <li>
                <strong className="text-white">Proteção de direitos:</strong> quando necessário para proteger nossos direitos ou a segurança de usuários.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Segurança dos Dados</h2>
            <p>
              Adotamos medidas técnicas e organizacionais para proteger seus dados, incluindo
              criptografia em trânsito (TLS/HTTPS), armazenamento seguro de senhas com hash e
              controles de acesso rigorosos. Contudo, nenhum sistema é 100% seguro — use senhas
              fortes e mantenha suas credenciais protegidas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Seus Direitos (LGPD)</h2>
            <p className="mb-3">Como titular dos dados, você tem o direito de:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                "Confirmar se tratamos seus dados",
                "Acessar seus dados pessoais",
                "Corrigir dados incompletos ou incorretos",
                "Solicitar anonimização ou exclusão",
                "Revogar consentimento a qualquer momento",
                "Portabilidade dos seus dados",
              ].map((right) => (
                <div key={right} className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm">
                  <div className="w-5 h-5 bg-violet-600/20 rounded flex items-center justify-center flex-shrink-0">
                    <div className="w-1.5 h-1.5 bg-violet-400 rounded-full" />
                  </div>
                  {right}
                </div>
              ))}
            </div>
            <p className="mt-4 text-zinc-400">
              Para exercer seus direitos, entre em contato: <span className="text-violet-400">privacidade@flowifypos.com.br</span>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Retenção de Dados</h2>
            <p>
              Mantemos seus dados enquanto sua conta estiver ativa. Após o cancelamento,
              os dados são retidos por 30 dias para eventuais recuperações e, em seguida,
              excluídos permanentemente, salvo obrigação legal de retenção.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Cookies</h2>
            <p>
              Utilizamos cookies essenciais para o funcionamento da plataforma (sessão de login)
              e cookies analíticos para entender como o serviço é utilizado. Você pode desativar
              cookies nas configurações do seu navegador, mas isso pode afetar o funcionamento
              de algumas funcionalidades.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Login com Google</h2>
            <p>
              Se você optar por entrar com sua conta Google, receberemos apenas as informações
              básicas do perfil (nome e e-mail) com seu consentimento explícito. Não acessamos
              outros dados da sua conta Google.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Alterações nesta Política</h2>
            <p>
              Podemos atualizar esta Política periodicamente. Notificaremos você sobre mudanças
              relevantes por e-mail ou através da plataforma. A data da última atualização
              sempre estará indicada no topo desta página.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Contato e DPO</h2>
            <p>
              Para questões sobre privacidade ou para exercer seus direitos, entre em contato
              com nosso Encarregado de Proteção de Dados (DPO):{" "}
              <span className="text-violet-400">privacidade@flowifypos.com.br</span>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-zinc-600">© {new Date().getFullYear()} Flowify POS. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/terms" className="text-zinc-400 hover:text-white transition-colors underline underline-offset-2">
              Termos de Uso
            </Link>
            <Link to="/auth" className="text-zinc-400 hover:text-white transition-colors">
              Voltar ao login
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
