import { useCallback, useEffect, useState } from 'react';
import {
  ArrowsClockwise, CheckCircle, WarningCircle, XCircle, MinusCircle, Question, Heartbeat,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ambitoComoObjeto } from '@/shared/lib/ambitoInforme';
import { toast } from '@/shared/hooks/useToast';
import {
  agruparPorEmpresa, stripePrestadoDe, textoStripePrestado, type GrupoDeEmpresa, type ProyectoConEmpresa, type StripePrestado,
} from '@/shared/lib/campusPorEmpresa';

/**
 * La salud de las conexiones de cada campus (CRM#533). SOLO PARA VER.
 *
 * Una fila por campus y una casilla por conexión (Stripe, Moodle, WooCommerce,
 * Brevo, Meta, los webhooks de admisión y de transferencias): verde, ámbar o
 * rojo, la última señal de vida y el motivo si falla. Abrirla no llama a nadie
 * de fuera: lee lo que ya está en la base. «Comprobar ahora» sí prueba las
 * claves (Stripe, Brevo, Moodle y la tienda), con las mismas pruebas de la
 * tarjeta de cada campus, y no repite lo comprobado hace menos de un minuto.
 *
 * El servidor (`GET /integrations/salud`) recorta a los campus de quien mira y
 * nunca manda una clave. Solo superadmin y admin (`integrations.salud`).
 */

type Estado = 'bien' | 'atencion' | 'caida' | 'sin_datos' | 'sin_configurar';

interface Casilla {
  estado: Estado;
  resumen: string;
  ultimaSenal: string | null;
  queSenal: string | null;
  motivo: string | null;
  comprobado: string | null;
  datos?: {
    webhook?: { estado: string; texto: string };
    plugin?: { activo: boolean; version: string | null };
    [k: string]: unknown;
  };
}

interface FilaCampus {
  id: number;
  nombre: string;
  peor: Estado;
  casillas: Record<string, Casilla>;
  /** Usa la cuenta de Stripe de otro campus (`feat/stripe-prestado`): conectado. */
  stripe_prestado_de?: StripePrestado | null;
}

interface Salud {
  comprobado: string;
  conexiones: { clave: string; titulo: string }[];
  campus: FilaCampus[];
}

const ESTILO: Record<Estado, { etiqueta: string; clase: string; Icono: typeof CheckCircle }> = {
  bien: { etiqueta: 'Funciona', clase: 'bg-success-soft text-success-soft-foreground', Icono: CheckCircle },
  atencion: { etiqueta: 'Atención', clase: 'bg-warning-soft text-warning-soft-foreground', Icono: WarningCircle },
  caida: { etiqueta: 'Caída', clase: 'bg-destructive-soft text-destructive-soft-foreground', Icono: XCircle },
  sin_datos: { etiqueta: 'Sin datos', clase: 'bg-info-soft text-info-soft-foreground', Icono: Question },
  sin_configurar: { etiqueta: 'Sin configurar', clase: 'bg-muted text-muted-foreground', Icono: MinusCircle },
};

function fecha(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function Pastilla({ estado }: { estado: Estado }) {
  const e = ESTILO[estado] || ESTILO.sin_datos;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${e.clase}`}>
      <e.Icono size={10} weight="fill" /> {e.etiqueta}
    </span>
  );
}

function Celda({ c, clave, prestado = null }: { c: Casilla | undefined; clave: string; prestado?: StripePrestado | null }) {
  // Con el Stripe de otro campus (24/11), «sin configurar» no es verdad: está conectado.
  if (prestado && (clave === 'stripe' || clave === 'stripe_links') && (!c || c.estado === 'sin_configurar')) {
    return (
      <span data-testid="stripe-prestado" className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap bg-success-soft text-success-soft-foreground">
        <CheckCircle size={10} weight="fill" /> {textoStripePrestado(prestado)}
      </span>
    );
  }
  if (!c) return <span className="text-muted-foreground">—</span>;
  const falla = c.estado === 'caida' || c.estado === 'atencion';
  const senal = fecha(c.ultimaSenal);
  return (
    <div className="space-y-1 min-w-[11rem] max-w-[16rem]">
      <Pastilla estado={c.estado} />
      {c.estado !== 'sin_configurar' && <p className="text-[11px] leading-snug">{c.resumen}</p>}
      {c.estado === 'sin_configurar' && <p className="text-[11px] leading-snug text-muted-foreground">{c.resumen}</p>}
      {senal && (
        <p className="text-[10px] text-muted-foreground" title={c.queSenal || undefined}>
          Última señal: {senal}
        </p>
      )}
      {falla && c.motivo && (
        <p className="text-[11px] leading-snug text-destructive break-words" data-motivo>
          {c.motivo}
        </p>
      )}
      {clave === 'stripe' && c.datos?.webhook && c.estado !== 'sin_configurar' && (
        <p className="text-[10px] leading-snug text-muted-foreground">{c.datos.webhook.texto}</p>
      )}
    </div>
  );
}

/**
 * `deTodos`: todos los campus de quien mira, sea cual sea el de la cabecera. Para
 * el CRM que no tiene «Todos» arriba (ISEIE), donde siempre hay un campus puesto
 * y el panel se quedaría en una sola fila.
 */
export default function SaludDeLasConexiones({ deTodos = false }: { deTodos?: boolean } = {}) {
  const { activeIssuerId, activeProject, projects } = useProjectContext() as {
    activeIssuerId?: number | null;
    activeProject?: { id?: number | null } | null;
    projects?: ProyectoConEmpresa[];
  };
  const proyectoId = activeProject?.id ?? null;
  const [salud, setSalud] = useState<Salud | null>(null);
  const [error, setError] = useState(false);
  // null: nada en marcha; 'todos' o el id del campus que se comprueba.
  const [comprobando, setComprobando] = useState<'todos' | number | null>(null);

  const params = deTodos ? {} : ambitoComoObjeto({ activeIssuerId: activeIssuerId ?? null, activeProject: { id: proyectoId } });
  const clave = JSON.stringify(params);

  useEffect(() => {
    let vivo = true;
    setSalud(null); setError(false);
    client.get<Salud>('/integrations/salud', { params: JSON.parse(clave) })
      .then((r) => { if (vivo) { if (r.success && r.data) setSalud(r.data); else setError(true); } })
      .catch(() => { if (vivo) setError(true); });
    return () => { vivo = false; };
  }, [clave]);

  const comprobar = useCallback(async (campusId?: number) => {
    setComprobando(campusId ?? 'todos');
    try {
      const r = await client.post<Salud>('/integrations/salud/comprobar', campusId ? { projectId: campusId } : {}, { params: JSON.parse(clave) });
      if (r.success && r.data) setSalud(r.data);
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo comprobar', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally {
      setComprobando(null);
    }
  }, [clave]);

  const cabecera = (
    <div className="px-5 py-4 border-b border-border flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-semibold flex items-center gap-2">
          <Heartbeat size={16} weight="bold" /> Salud de las conexiones
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Si cada conexión funciona, su última señal de vida y el motivo si falla. Solo para ver: las claves no salen nunca.
          Abrir esta pantalla no llama a nadie; «Comprobar ahora» prueba las claves de Stripe, Brevo, Moodle y la tienda.
        </p>
      </div>
      <button
        type="button"
        onClick={() => comprobar()}
        disabled={comprobando !== null || !salud?.campus.length}
        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50"
      >
        <ArrowsClockwise size={13} weight="bold" className={comprobando === 'todos' ? 'animate-spin' : ''} />
        {comprobando === 'todos' ? 'Comprobando…' : 'Comprobar ahora'}
      </button>
    </div>
  );

  if (error) {
    return (
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {cabecera}
        <div className="p-6 text-sm text-destructive">No se pudo cargar la salud de las conexiones.</div>
      </div>
    );
  }
  if (!salud) {
    return (
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {cabecera}
        <div className="p-6 text-sm text-muted-foreground">Cargando…</div>
      </div>
    );
  }
  if (!salud.campus.length) {
    return (
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {cabecera}
        <div className="p-6 text-sm text-muted-foreground">No hay campus en esta vista.</div>
      </div>
    );
  }

  // Por empresa (Diego, 24/11): cada empresa con sus campus; sin empresas, como siempre.
  const grupos = agruparPorEmpresa(salud.campus, projects, (c) => c.id);
  const conEmpresas = grupos.some((g) => g.id !== null);
  const porGrupo: GrupoDeEmpresa<FilaCampus>[] = conEmpresas ? grupos : [{ id: null, nombre: '', campus: salud.campus }];
  const caidos = salud.campus.filter((c) => c.peor === 'caida').length;
  const atencion = salud.campus.filter((c) => c.peor === 'atencion').length;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {cabecera}
      <div className="px-5 py-2 border-b border-border flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {caidos ? <strong className="text-destructive">{caidos} campus con algo caído</strong> : 'Ningún campus con algo caído'}
          {atencion ? ` · ${atencion} con avisos` : ''}
        </span>
        <span>Leído: {fecha(salud.comprobado)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Salud de las conexiones por campus">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="px-5 py-2 font-semibold sticky left-0 bg-card">Campus</th>
              {salud.conexiones.map((x) => <th key={x.clave} className="px-3 py-2 font-semibold whitespace-nowrap">{x.titulo}</th>)}
            </tr>
          </thead>
          {porGrupo.map((g) => (
          <tbody key={g.id ?? 'sin'} data-testid={conEmpresas ? 'grupo-empresa' : undefined}>
            {conEmpresas && (
              <tr className="bg-muted/40 border-b border-border">
                <th scope="colgroup" colSpan={salud.conexiones.length + 1} className="px-5 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground sticky left-0">
                  {g.nombre}
                </th>
              </tr>
            )}
            {g.campus.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 align-top">
                <td className="px-5 py-3 sticky left-0 bg-card">
                  <div className="font-medium">{c.nombre}</div>
                  <div className="mt-1"><Pastilla estado={c.peor} /></div>
                  <button
                    type="button"
                    onClick={() => comprobar(c.id)}
                    disabled={comprobando !== null}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                    aria-label={`Comprobar ahora las conexiones de ${c.nombre}`}
                  >
                    <ArrowsClockwise size={11} weight="bold" className={comprobando === c.id ? 'animate-spin' : ''} />
                    {comprobando === c.id ? 'Comprobando…' : 'Comprobar'}
                  </button>
                </td>
                {salud.conexiones.map((x) => (
                  <td key={x.clave} className="px-3 py-3">
                    <Celda c={c.casillas[x.clave]} clave={x.clave} prestado={stripePrestadoDe(c)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
