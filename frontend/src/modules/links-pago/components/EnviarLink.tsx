import { useEffect, useState } from 'react';
import { ChatText, WhatsappLogo } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { chatApi } from '@/modules/whatsapp/api/whatsapp.api';
import type { LinkDePago } from '../api/linksPago.api';
import { mensajeDelLink } from '../lib/mensajeDelLink';

// Como `errorDe` del asistente; aquí aparte para no importarse el uno al otro.
const errorDe = (e: unknown) => {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error de red: no se ha podido hablar con el servidor.';
};

/*
  MANDAR EL LINK SIN COPIARLO A MANO (CRM#983; Diego, 21/11/2026).

  «Que la gestora no tenga que copiar el link y pegarlo.» Y su aclaración:
    · «Enviar por WhatsApp» solo a quien tiene WhatsApp conectado en el CRM (lo
      mismo que mira el chat: `GET /whatsapp/conexion`, su línea). Sale en la
      conversación del CRM con el prospecto, con la plantilla del mensaje.
    · «Copiar mensaje», para todo el mundo: el link con la misma plantilla, para
      mandarlo a mano.
    · El link no es de un solo uso: se vuelve a copiar o a mandar las veces que
      haga falta, desde la ficha del prospecto, la de la venta y «Links de pago».
*/

// Una sola pregunta por pestaña cada minuto: la lista pinta un botón por link.
let conexion: { cuando: number; promesa: Promise<boolean> } | null = null;
export function _olvidarConexion() { conexion = null; }

function preguntarConexion(): Promise<boolean> {
  if (conexion && Date.now() - conexion.cuando < 60_000) return conexion.promesa;
  const promesa = chatApi.conexion()
    .then((r) => !!(r?.success && r.data?.configurado && r.data?.conectado))
    .catch(() => false);
  conexion = { cuando: Date.now(), promesa };
  return promesa;
}

/** ¿Tiene esta persona WhatsApp conectado en el CRM? null mientras se pregunta. */
export function useWhatsappConectado(activo = true) {
  const { can } = usePermission();
  const puede = activo && can('whatsapp.usar');
  const [conectado, setConectado] = useState<boolean | null>(puede ? null : false);
  useEffect(() => {
    if (!puede) { setConectado(false); return undefined; }
    let vigente = true;
    preguntarConexion().then((c) => { if (vigente) setConectado(c); });
    return () => { vigente = false; };
  }, [puede]);
  return conectado;
}

export async function copiarMensaje(link: Parameters<typeof mensajeDelLink>[0], nombre?: string | null) {
  const texto = mensajeDelLink(link, nombre);
  try {
    await navigator.clipboard.writeText(texto);
    toast({ title: 'Mensaje copiado', description: 'El link con su mensaje: pégalo en WhatsApp o en un correo.' });
    return true;
  } catch {
    toast({ title: 'No se ha podido copiar', description: texto, variant: 'destructive' });
    return false;
  }
}

/** Manda el link con su plantilla en la conversación del CRM con el prospecto (o en la que se diga). */
export async function enviarPorWhatsapp(link: LinkDePago, { leadId, nombre, conversacionId, usuarioId }: {
  leadId?: number | null; nombre?: string | null; conversacionId?: number | null; usuarioId?: number | null;
}) {
  let conv = conversacionId ?? null;
  if (!conv) {
    if (!leadId) throw new Error('Este link no tiene prospecto: cópialo y mándalo a mano.');
    const r = await chatApi.abrir(leadId, usuarioId);
    if (!r?.success || !r.data?.id) throw new Error(r?.error || 'No se ha podido abrir la conversación de WhatsApp.');
    conv = r.data.id;
  }
  const r = await chatApi.enviar(conv, mensajeDelLink(link, nombre), null, usuarioId);
  if (!r?.success) throw new Error(r?.error || 'WhatsApp no ha aceptado el mensaje.');
  return conv;
}

const boton = 'inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50';

/**
 * «Copiar mensaje» y, con WhatsApp conectado, «Enviar por WhatsApp». Para un link
 * vivo de la lista o de la ficha.
 */
export default function EnviarLink({ link, nombre, conversacionId, usuarioId, alEnviar }: {
  link: LinkDePago;
  nombre?: string | null;
  conversacionId?: number | null;
  usuarioId?: number | null;
  alEnviar?: () => void;
}) {
  const vivo = (link.estado === 'creado' || link.estado === 'abierto') && !!link.url;
  const conectado = useWhatsappConectado(vivo && !!(link.lead_id || conversacionId));
  const [enviando, setEnviando] = useState(false);
  if (!vivo) return null;
  const quien = nombre ?? link.lead_nombre ?? null;

  async function enviar() {
    setEnviando(true);
    try {
      await enviarPorWhatsapp(link, { leadId: link.lead_id, nombre: quien, conversacionId, usuarioId });
      toast({ title: 'Link enviado por WhatsApp', description: 'Ha salido en la conversación del CRM, con su mensaje.' });
      alEnviar?.();
    } catch (e) {
      toast({ title: 'No se ha podido enviar', description: `${errorDe(e)} Puedes copiar el mensaje y mandarlo a mano.`, variant: 'destructive' });
    } finally { setEnviando(false); }
  }

  return (
    <>
      <button type="button" onClick={() => copiarMensaje(link, quien)} className={boton} title="El link con su mensaje, para pegarlo donde quieras">
        <ChatText size={13} weight="bold" aria-hidden="true" /> Copiar mensaje
      </button>
      {conectado && (
        <button type="button" onClick={enviar} disabled={enviando} className={boton}>
          <WhatsappLogo size={13} weight="bold" aria-hidden="true" /> {enviando ? 'Enviando…' : 'Enviar por WhatsApp'}
        </button>
      )}
    </>
  );
}
