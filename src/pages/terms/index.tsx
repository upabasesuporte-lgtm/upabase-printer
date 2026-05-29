import { Link } from "react-router-dom";
import { Zap, ArrowLeft } from "lucide-react";

export default function TermsPage() {
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
          <h1 className="text-3xl font-bold mb-3">Termos de Uso</h1>
          <p className="text-zinc-400 text-sm">Última atualização: {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</p>
        </div>

        <div className="prose prose-invert max-w-none space-y-8 text-zinc-300 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">1. Aceitação dos Termos</h2>
            <p>
              Ao acessar ou usar o Flowify POS, você concorda em ficar vinculado a estes Termos de Uso.
              Se você não concorda com algum destes termos, não utilize nosso serviço.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">2. Descrição do Serviço</h2>
            <p>
              O Flowify POS é uma plataforma de gestão para estabelecimentos comerciais que oferece
              funcionalidades de ponto de venda (PDV), controle de estoque, gestão de clientes,
              emissão de relatórios e cardápio digital.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">3. Cadastro e Conta</h2>
            <p>
              Para utilizar o Flowify POS, você deve criar uma conta fornecendo informações precisas
              e completas. Você é responsável por manter a confidencialidade de suas credenciais de
              acesso e por todas as atividades realizadas na sua conta.
            </p>
            <ul className="mt-3 space-y-2 list-disc list-inside text-zinc-400">
              <li>Você deve ter pelo menos 18 anos para criar uma conta.</li>
              <li>Cada conta é para uso de uma única empresa.</li>
              <li>Notifique-nos imediatamente sobre qualquer uso não autorizado da sua conta.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">4. Uso Aceitável</h2>
            <p>Você concorda em não utilizar o serviço para:</p>
            <ul className="mt-3 space-y-2 list-disc list-inside text-zinc-400">
              <li>Violar qualquer lei ou regulamento aplicável.</li>
              <li>Transmitir conteúdo fraudulento, enganoso ou prejudicial.</li>
              <li>Tentar acessar dados de outros usuários sem autorização.</li>
              <li>Interferir na operação normal da plataforma.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">5. Pagamento e Planos</h2>
            <p>
              O Flowify POS pode oferecer planos gratuitos e pagos. Os valores, condições de
              pagamento e benefícios de cada plano são descritos na página de preços. Reservamo-nos
              o direito de alterar os preços com aviso prévio de 30 dias.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">6. Propriedade Intelectual</h2>
            <p>
              Todo o conteúdo, código, design e funcionalidades do Flowify POS são de propriedade
              exclusiva de Flowify POS e são protegidos por leis de direitos autorais e propriedade
              intelectual. É vedada a reprodução, distribuição ou criação de obras derivadas sem
              autorização prévia por escrito.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">7. Limitação de Responsabilidade</h2>
            <p>
              O Flowify POS não se responsabiliza por danos indiretos, incidentais ou consequentes
              decorrentes do uso ou impossibilidade de uso do serviço. Nossa responsabilidade total
              não excederá o valor pago pelo usuário nos últimos 12 meses.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">8. Rescisão</h2>
            <p>
              Podemos suspender ou encerrar sua conta a qualquer momento por violação destes termos.
              Você pode cancelar sua conta a qualquer momento através das configurações. Após o
              cancelamento, seus dados serão mantidos por 30 dias antes da exclusão definitiva.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">9. Alterações nos Termos</h2>
            <p>
              Podemos atualizar estes Termos periodicamente. Notificaremos você sobre mudanças
              significativas por e-mail ou através da plataforma. O uso contínuo do serviço após
              as alterações constitui aceitação dos novos termos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-3">10. Contato</h2>
            <p>
              Dúvidas sobre estes Termos de Uso podem ser enviadas para:{" "}
              <span className="text-violet-400">suporte@flowifypos.com.br</span>
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-zinc-600">© {new Date().getFullYear()} Flowify POS. Todos os direitos reservados.</p>
          <div className="flex items-center gap-4 text-xs">
            <Link to="/privacy" className="text-zinc-400 hover:text-white transition-colors underline underline-offset-2">
              Política de Privacidade
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
