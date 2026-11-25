import { useEffect, useState } from 'react';
import { UserMinus, WarningCircle, ClockCounterClockwise } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import { formatDate } from '@/shared/lib/format';
import { hoyEnMadrid } from '@/shared/lib/fechas';
import { bajaAlumnoApi, type BajaDeLaVenta, type MotivoBaja } from '../api/bajaAlumno.api';

/*
  «Dar de baja al alumno» en la ficha de la venta (Diego, 25/11/2026, sobre
  CRM#1113 / CRM-ISEIE#767).

  Fecha de baja, motivo (desistimiento en plazo, baja voluntaria, impago, otro)
  y nota. Desde esa fecha la venta deja de contar como activa en Productos ›
  Formaciones › Alumnos. Se puede cambiar y deshacer; cada paso queda en el
  historial con quién y cuándo.

  NO anula facturas ni toca cobros, cuotas ni el cobro automático (si quedan
  cuotas por cobrar, lo avisa) y NO da de baja en Moodle: eso lo hacen las
  tutoras o Make.

  Darla o deshacerla pide `conversions.baja_alumno`; sin él, solo se ve.
  Sin la migración en el servidor (`disponible: false`), no se pinta.
*/

const eur = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
const cuando = (t: string | null | undefined) => (t
  ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '');

const ACCION: Record<string, string> = { baja: 'Dado de baja', cambio: 'Baja cambiada', deshecha: 'Baja deshecha' };

type Edicion = { fecha: string; motivo: MotivoBaja | ''; nota: string };

export default function BajaAlumnoCard({ conversionId }: { conversionId: number }) {
  const { can } = usePermission();
  const puede = can('conversions.baja_alumno');
  const [datos, setDatos] = useState<BajaDeLaVenta | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    bajaAlumnoApi.leer(conversionId)
      .then((r) => { if (vivo && r?.success && r.data) setDatos(r.data); })
      .catch(() => { /* sin permiso o sin el módulo: no se enseña */ });
    return () => { vivo = false; };
  }, [conversionId]);

  if (!datos || !datos.disponible) return null;
  const { baja, avisos, historial } = datos;

  function abrir() {
    setEdicion(baja
      ? { fecha: baja.fecha, motivo: baja.motivo, nota: baja.nota || '' }
      : { fecha: hoyEnMadrid(), motivo: '', nota: '' });
  }

  function fallo(titulo: string, err: unknown) {
    const e = err as { data?: { error?: string }; message?: string };
    toast({ title: titulo, description: e?.data?.error || e?.message, variant: 'destructive' });
  }

  async function guardar() {
    if (!edicion) return;
    if (!edicion.fecha || !edicion.motivo) {
      toast({ title: 'Faltan datos', description: 'Elige la fecha de baja y el motivo.', variant: 'destructive' });
      return;
    }
    if (edicion.motivo === 'otro' && !edicion.nota.trim()) {
      toast({ title: 'Falta el motivo', description: 'Con «Otro», escribe el motivo en la nota.', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const r = await bajaAlumnoApi.dar(conversionId, { fecha: edicion.fecha, motivo: edicion.motivo, nota: edicion.nota.trim() || null });
      if (r?.data) setDatos(r.data);
      setEdicion(null);
      toast({ title: baja ? 'Baja cambiada' : 'Alumno dado de baja', description: 'Las facturas, los cobros y Moodle no se han tocado.' });
    } catch (err) { fallo('No se pudo guardar la baja', err); } finally { setGuardando(false); }
  }

  async function deshacer() {
    setGuardando(true);
    try {
      const r = await bajaAlumnoApi.deshacer(conversionId);
      if (r?.data) setDatos(r.data);
      setEdicion(null);
      toast({ title: 'Baja deshecha', description: 'Vuelve a contar como alumno.' });
    } catch (err) { fallo('No se pudo deshacer la baja', err); } finally { setGuardando(false); }
  }

  const quedanCuotas = avisos.cuotas_pendientes > 0;
  const idBase = `baja-venta-${conversionId}`;

  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-3 text-sm" aria-labelledby={`${idBase}-titulo`}>
      <h3 id={`${idBase}-titulo`} className="font-semibold flex items-center gap-1.5">
        <UserMinus size={15} weight="bold" /> Baja del alumno
      </h3>

      {baja ? (
        <div className="rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning-soft-foreground space-y-0.5" role="status">
          <p className="font-semibold">
            {baja.fecha > hoyEnMadrid() ? 'Baja programada' : 'De baja'} desde el {formatDate(baja.fecha)} · {baja.motivo_texto}
          </p>
          {baja.nota && <p className="whitespace-pre-line">{baja.nota}</p>}
          {baja.por && <p className="opacity-80">Apuntada por {baja.por}{baja.at ? ` · ${cuando(baja.at)}` : ''}</p>}
        </div>
      ) : (
        !edicion && <p className="text-[12px] text-muted-foreground">El alumno sigue en curso.</p>
      )}

      {puede && !edicion && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={abrir} disabled={guardando}
            className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted disabled:opacity-50">
            {baja ? 'Cambiar la baja' : 'Dar de baja al alumno'}
          </button>
          {baja && (
            <button type="button" onClick={deshacer} disabled={guardando}
              className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted disabled:opacity-50">
              Deshacer la baja
            </button>
          )}
        </div>
      )}

      {puede && edicion && (
        <div className="space-y-2.5 rounded-md border border-border p-3">
          <label className="block text-[12px]" htmlFor={`${idBase}-fecha`}>
            <span className="text-muted-foreground">Fecha de baja</span>
            <input id={`${idBase}-fecha`} type="date" value={edicion.fecha}
              onChange={(e) => setEdicion({ ...edicion, fecha: e.target.value })}
              className="mt-1 block h-8 w-full rounded-md border border-border bg-background px-2 text-sm" />
          </label>
          <label className="block text-[12px]" htmlFor={`${idBase}-motivo`}>
            <span className="text-muted-foreground">Motivo</span>
            <select id={`${idBase}-motivo`} value={edicion.motivo}
              onChange={(e) => setEdicion({ ...edicion, motivo: e.target.value as MotivoBaja })}
              className="mt-1 block h-8 w-full rounded-md border border-border bg-background px-2 text-sm">
              <option value="">Elige el motivo…</option>
              {datos.motivos.map((m) => <option key={m.clave} value={m.clave}>{m.texto}</option>)}
            </select>
          </label>
          <label className="block text-[12px]" htmlFor={`${idBase}-nota`}>
            <span className="text-muted-foreground">Nota{edicion.motivo === 'otro' ? ' (obligatoria con «Otro»)' : ''}</span>
            <textarea id={`${idBase}-nota`} value={edicion.nota} rows={2} maxLength={1000}
              onChange={(e) => setEdicion({ ...edicion, nota: e.target.value })}
              className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm" />
          </label>

          {(quedanCuotas || avisos.cobro_automatico || avisos.suscripcion_activa) && (
            <p className="flex items-start gap-1.5 rounded-md bg-destructive-soft px-2.5 py-2 text-[12px] text-destructive-soft-foreground" role="alert">
              <WarningCircle size={14} weight="bold" className="mt-0.5 shrink-0" />
              <span>
                {quedanCuotas && `Quedan ${avisos.cuotas_pendientes} cuota${avisos.cuotas_pendientes === 1 ? '' : 's'} por cobrar (${eur(avisos.importe_cuotas_pendientes)}). `}
                {avisos.cobro_automatico && 'El cobro automático de las cuotas sigue encendido. '}
                {avisos.suscripcion_activa && 'La suscripción de Stripe sigue activa. '}
                La baja no anula facturas ni para cobros: si no se van a cobrar, hazlo aparte.
              </span>
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">No da de baja en Moodle: eso lo hacen las tutoras o Make.</p>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEdicion(null)} disabled={guardando}
              className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={guardando}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50">
              {guardando ? 'Guardando…' : (baja ? 'Guardar el cambio' : 'Dar de baja')}
            </button>
          </div>
        </div>
      )}

      {historial.length > 0 && (
        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted-foreground flex items-center gap-1.5">
            <ClockCounterClockwise size={13} weight="bold" /> Historial de la baja ({historial.length})
          </summary>
          <ul className="mt-2 space-y-1.5" aria-label="Historial de la baja">
            {historial.map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-2">
                <span className="font-medium">{ACCION[h.accion] || h.accion}</span>
                {h.fecha_baja && ` · desde el ${formatDate(h.fecha_baja)}`}
                {h.motivo_texto && ` · ${h.motivo_texto}`}
                {h.nota && <span className="block text-muted-foreground">{h.nota}</span>}
                <span className="block text-[11px] text-muted-foreground">{[h.usuario, cuando(h.at)].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
