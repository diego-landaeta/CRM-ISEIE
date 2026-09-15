import client from '@/shared/api/client';

// Abrir la conversación DENTRO del CRM, no en WhatsApp Web.
//
// Antes cada botón de WhatsApp lanzaba `wa.me` en otra pestaña: se salía del
// CRM, no quedaba registro de nada, y con varias sesiones enlazadas abría la
// del navegador —que puede ser la personal de quien pulsa—, no la del CRM.
//
// Ahora se abre el chat del propio CRM. Si algo va mal se devuelve `false` y
// quien llama decide qué decir; nunca se abre WhatsApp por detrás como premio
// de consolación, porque eso es justo lo que confunde.

interface Abierto { id: number }

/**
 * Abre —o crea— la conversación de un prospecto y devuelve a dónde ir.
 * `leadId` es lo preferible: ata la conversación a su ficha. Con solo el
 * teléfono también vale, para un cliente que no tenga prospecto detrás.
 */
export async function abrirChatCrm(
  { leadId, telefono }: { leadId?: number | null; telefono?: string | null },
): Promise<string | null> {
  try {
    const cuerpo = leadId ? { leadId } : { telefono };
    if (!leadId && !telefono) return null;
    const r = await client.post('/whatsapp/chats', cuerpo) as { success: boolean; data?: Abierto };
    if (!r.success || !r.data?.id) return null;
    return `/whatsapp/chat?conv=${r.data.id}`;
  } catch {
    return null;
  }
}
