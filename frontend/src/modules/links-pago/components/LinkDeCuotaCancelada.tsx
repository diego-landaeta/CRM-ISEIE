import { useState } from 'react';
import { LinkSimple, ArrowSquareOut } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';
import { generarPlan, listarLinks, type LinkDePago } from '../api/linksPago.api';
import EnviarLink from './EnviarLink';

/*
  «MANDAR LINK DE PAGO» DE UNA CUOTA QUE STRIPE YA NO COBRARÁ (CRM#1103).

  Va junto a cada cuota marcada «Cobro automático cancelado» en el plan de cuotas
  de la venta. Crea (o reutiliza, si ya tenía uno vivo) el link de ESA cuota: al
  pagarlo, el cobro salda esa cuota y no otra. Antes, el servidor anula en Stripe
  la factura de la cuota si seguía pagable (nunca dos maneras de pagar lo mismo).
  Creado, se manda como cualquier link: «Copiar mensaje» y, con WhatsApp
  conectado, «Enviar por WhatsApp».

  Solo con los links de pago encendidos y el permiso de crearlos.
*/

const errorDe = (e: unknown) => {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error de red: no se ha podido hablar con el servidor.';
};

export default function LinkDeCuotaCancelada({ conversionId, cuotaId, nombre }: {
  conversionId: number;
  cuotaId: number;
  nombre?: string | null;
}) {
  const { can } = usePermission();
  const encendidos = useLinksPagoEncendidos();
  const [creando, setCreando] = useState(false);
  const [link, setLink] = useState<LinkDePago | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!encendidos || !can('links_pago.crear')) return null;

  async function crear() {
    setCreando(true);
    setError(null);
    try {
      const r = await generarPlan(conversionId, [cuotaId]);
      const cuota = (r.data?.cuotas || []).find((c) => Number(c.id) === Number(cuotaId));
      if (!cuota?.link_id) throw new Error('No ha salido el link de la cuota. Recarga la venta.');
      const links = await listarLinks({ conversionId });
      const elLink = (links.data || []).find((l) => Number(l.id) === Number(cuota.link_id));
      setLink(elLink || ({ id: cuota.link_id, url: cuota.link_url, estado: cuota.link_estado || 'creado', importe: cuota.importe } as unknown as LinkDePago));
      window.dispatchEvent(new CustomEvent('links-pago:creado', { detail: { conversion_id: conversionId } }));
    } catch (e) {
      setError(errorDe(e));
    } finally { setCreando(false); }
  }

  if (link) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5" data-testid={`link-cuota-${cuotaId}`}>
        {link.url && (
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[11px] underline">
            Link de la cuota <ArrowSquareOut size={11} aria-hidden="true" />
          </a>
        )}
        <EnviarLink link={link} nombre={nombre} />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={crear} disabled={creando}
        className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-card text-[11px] font-semibold hover:bg-muted disabled:opacity-50">
        <LinkSimple size={12} weight="bold" aria-hidden="true" /> {creando ? 'Creando…' : 'Mandar link de pago'}
      </button>
      {error && <span role="alert" className="text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
