import { useEffect, useMemo, useState } from 'react';
import { CalendarBlank, FileXls, FileZip, PaperPlaneTilt, UsersThree } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { informeMensualApi, type InformeMensual as Datos, type CifrasDelMes } from '../api/informeMensual.api';

/**
 * El informe mensual para la gestoría (#772).
 *
 * El mes natural (de serie, el anterior), por equipo comercial y por comercial,
 * con lo cobrado en el mes (la suma de los pagos registrados), lo facturado y
 * las ventas. Se baja en Excel, y el ZIP con los PDF de las facturas emitidas de
 * una empresa, aunque el envío automático esté apagado.
 */

const eur = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
const num = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n || 0);

function mesAnterior(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** El nombre corto de la empresa: su alias, o la primera palabra de la razón social («CEDIA»). */
const nombreCorto = (alias?: string | null, razon?: string | null) =>
  String(alias || '').trim() || String(razon || '').trim().split(/[\s,]+/)[0] || 'Empresa';

type Campus = { sociedad_emisora_id?: number | null; sociedad_nombre?: string | null; sociedad_alias?: string | null };

function Cifras({ c }: { c: CifrasDelMes }) {
  return (
    <>
      <td className="px-2 py-1.5 text-right tabular-nums">{num(c.ventas)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{eur(c.cobrado)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums hidden sm:table-cell">{eur(c.facturado)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums hidden md:table-cell">{eur(c.vendido)}</td>
    </>
  );
}

const CABECERA = (
  <>
    <th className="px-2 py-1.5 text-right font-medium">Ventas</th>
    <th className="px-2 py-1.5 text-right font-medium">Cobrado</th>
    <th className="px-2 py-1.5 text-right font-medium hidden sm:table-cell">Facturado</th>
    <th className="px-2 py-1.5 text-right font-medium hidden md:table-cell">Vendido</th>
  </>
);

export default function InformeMensual({ issuerId }: { issuerId: number | null }) {
  const { can } = usePermission();
  if (!can('reports.informe_mensual')) return null;
  return <Panel issuerInicial={issuerId} />;
}

function Panel({ issuerInicial }: { issuerInicial: number | null }) {
  const { projects } = useProjectContext() as { projects: Campus[] };
  const empresas = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of projects || []) {
      if (p.sociedad_emisora_id) {
        m.set(Number(p.sociedad_emisora_id), nombreCorto(p.sociedad_alias, p.sociedad_nombre));
      }
    }
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre }));
  }, [projects]);

  const [periodo, setPeriodo] = useState(mesAnterior);
  const [issuerId, setIssuerId] = useState<number | null>(issuerInicial ?? empresas[0]?.id ?? null);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [bajando, setBajando] = useState<'excel' | 'zip' | null>(null);
  const empresa = empresas.find((e) => e.id === issuerId)?.nombre || null;

  useEffect(() => { if (issuerInicial) setIssuerId(issuerInicial); }, [issuerInicial]);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(periodo)) return;
    let vivo = true;
    setCargando(true);
    informeMensualApi.ver(periodo, issuerId)
      .then((r) => { if (vivo && r.success) setDatos(r.data); })
      .catch((e) => { if (vivo) toast({ title: 'No se pudo cargar el informe mensual', description: e?.data?.error || e.message, variant: 'destructive' }); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [periodo, issuerId]);

  async function bajar(que: 'excel' | 'zip') {
    setBajando(que);
    try {
      if (que === 'excel') await informeMensualApi.bajarExcel(periodo, issuerId, empresa);
      else if (issuerId && empresa) await informeMensualApi.bajarZip(periodo, issuerId, empresa);
    } catch (e) {
      toast({ title: 'No se pudo descargar', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBajando(null);
    }
  }

  const envio = datos?.envio;
  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2"><CalendarBlank size={16} /> Informe mensual para la gestoría</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            El mes natural por equipo y por comercial. Cobrado: los pagos registrados con fecha en el mes; facturado: por fecha de emisión.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            aria-label="Mes del informe"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          />
          <select
            aria-label="Empresa"
            value={issuerId ?? ''}
            onChange={(e) => setIssuerId(e.target.value ? Number(e.target.value) : null)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Todas mis empresas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <button
            type="button"
            onClick={() => bajar('excel')}
            disabled={!!bajando}
            className="h-8 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <FileXls size={15} /> {bajando === 'excel' ? 'Preparando…' : 'Excel'}
          </button>
          <button
            type="button"
            onClick={() => bajar('zip')}
            disabled={!!bajando || !issuerId}
            title={issuerId ? 'Los PDF de las facturas emitidas del mes, el listado y el informe' : 'Elige una empresa: el ZIP es de una'}
            className="h-8 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <FileZip size={15} /> {bajando === 'zip' ? 'Preparando…' : 'ZIP de facturas'}
          </button>
        </div>
      </div>

      {envio && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <PaperPlaneTilt size={13} />
          {envio.activo
            ? `Envío automático a la gestoría: el día ${envio.dia} de cada mes a las ${envio.hora}, con el mes anterior.`
            : 'Envío automático a la gestoría: apagado. El informe y el ZIP se descargan aquí.'}
        </p>
      )}

      {cargando && !datos ? (
        <div className="h-24 bg-muted/50 rounded-md animate-pulse" />
      ) : datos && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="overflow-x-auto">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1 flex items-center gap-1.5"><UsersThree size={13} /> Por equipo</h4>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr><th className="px-2 py-1.5 text-left font-medium">Equipo</th>{CABECERA}</tr>
              </thead>
              <tbody>
                {datos.equipos.map((e) => (
                  <tr key={e.equipo} className="border-b border-border/60">
                    <td className="px-2 py-1.5">{e.equipo} <span className="text-xs text-muted-foreground">({e.comerciales})</span></td>
                    <Cifras c={e} />
                  </tr>
                ))}
                <tr className="font-semibold"><td className="px-2 py-1.5">Total</td><Cifras c={datos.total} /></tr>
              </tbody>
            </table>
            {datos.equipos.length === 0 && <p className="text-sm text-muted-foreground py-2">Sin ventas ni cobros en {datos.mes}.</p>}
          </div>
          <div className="overflow-x-auto">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">Por comercial</h4>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr><th className="px-2 py-1.5 text-left font-medium">Comercial</th>{CABECERA}</tr>
              </thead>
              <tbody>
                {datos.comerciales.map((c) => (
                  <tr key={`${c.id ?? 'sin'}`} className="border-b border-border/60">
                    <td className="px-2 py-1.5">
                      {c.nombre}
                      <div className="text-xs text-muted-foreground">{c.equipo}</div>
                    </td>
                    <Cifras c={c} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
