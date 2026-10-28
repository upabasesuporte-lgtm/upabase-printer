// Suporte pelo WhatsApp (gratuito: link wa.me abre a conversa já com a mensagem)
export const SUPPORT_PHONE = "5518997066843";

export function supportWhatsAppUrl(message: string): string {
  return `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(message)}`;
}
