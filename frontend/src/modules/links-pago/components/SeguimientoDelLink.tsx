import { useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { renovarLink, type LinkDePago } from '../api/linksPago.api';
import { errorDe } from './CrearLinkAsistente';

/*
  SEGUIMIENTO DE LOS LINKS QUE NO SE PAGAN (CRM#984; Diego, 21/11/2026).

  Lo que se ve de cada link en «Links de pago» y en la tarjeta de la ficha:
  cuándo lo abrió el alumno, qué recordatorios le han salido, si se avisó a la
  gestora y, si está caducado, «Renovar» (un link nuevo igual, con un clic).
*/

const fecha = (d: string | null | undefined) =>
  (d ? new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** «abierto el 21/11 10:30 · recordatorio de 24 h enviado · renovado en el n.º 12». Nada si no hay nada que contar. */
export function DatosDeSeguimiento({ link }: { link: LinkDePago }) {
  const partes: string[] = [];
  if (link.abierto_el) partes.push(`abierto el ${fecha(link.abierto_el)}${link.estado === 'abierto' ? ' sin pagar' : ''}`);
  if (link.aviso_gestora_el) partes.push('aviso a la gestora enviado');
  const recordatorios = [link.recordatorio_24h_el && '24 h', link.recordatorio_72h_el && '72 h'].filter(Boolean);
  if (recordatorios.length) partes.push(`recordatorio de ${recordatorios.join(' y ')} al alumno`);
  if (link.renovado_de) partes.push(`renueva el n.º ${link.renovado_de}`);
  if (link.renovado_por) partes.push(`renovado en el n.º ${link.renovado_por}`);
  if (!partes.length) return null;
  return <span className="text-xs text-muted-foreground basis-full" data-seguimiento={link.id} data-recorrido="links-seguimiento-fila">{partes.join(' · ')}</span>;
}

/** «Renovar» un caducado: crea uno nuevo igual y lo copia para mandarlo. */
export function BotonRenovar({ link, onRenovado }: { link: LinkDePago; onRenovado?: (nuevo: LinkDePago) => void }) {
  const { can } = usePermission();
  const [busy, setBusy] = useState(false);
  if (link.estado !== 'caducado' || link.renovado_por || !can('links_pago.crear')) return null;

  async function renovar() {
    setBusy(true);
    try {
      const r = await renovarLink(link.id);
      const nuevo = r.data;
      let copiado = false;
      if (nuevo?.url) { try { await navigator.clipboard.writeText(nuevo.url); copiado = true; } catch { /* se ve en la lista */ } }
      toast({ title: 'Link renovado', description: copiado ? 'El nuevo está copiado: pégalo en el chat o en el correo.' : 'El nuevo ya está en la lista.' });
      if (nuevo) onRenovado?.(nuevo);
    } catch (e) {
      toast({ title: 'No se ha podido renovar', description: errorDe(e), variant: 'destructive' });
    } finally { setBusy(false); }
  }

  return (
    <button type="button" onClick={renovar} disabled={busy} data-recorrido="links-renovar"
      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50">
      <ArrowClockwise size={13} weight="bold" aria-hidden="true" /> {busy ? 'Renovando…' : 'Renovar'}
    </button>
  );
}
