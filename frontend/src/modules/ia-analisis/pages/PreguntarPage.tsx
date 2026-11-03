import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Sparkle, PaperPlaneRight, CheckCircle, WarningCircle, Info, CaretDown } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import { useProjectContext } from '@/contexts/ProjectContext';
import { preguntar, FalloIA, type RespuestaIA, type Desglose } from '../api/preguntar.api';

const MAX = 500;
const MIN = 3;
const EJEMPLOS = [
  '¿Cuánto se cobró el mes pasado?',
  '¿Cómo van las ventas por asesora este trimestre?',
  'Compara los prospectos de este mes con el anterior',
];
/** Filas que se enseñan por consulta en el desglose; el servidor manda más. */
const FILAS_VISIBLES = 20;

type Estado =
  | { tipo: 'reposo' }
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string; codigo: string }
  | { tipo: 'listo'; r: RespuestaIA; pregunta: string };

const NOMBRE_DE_LA_CONSULTA: Record<string, string> = {
  resumen_general: 'Resumen del periodo',
  resumen_mensual: 'Mes a mes',
  ventas_por_asesora: 'Ventas por asesora',
  campana_que_rinde: 'Rendimiento de las campañas',
};

function Valor({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof v === 'object') return <span className="text-muted-foreground">{JSON.stringify(v)}</span>;
  return <>{String(v)}</>;
}

/** Una consulta con lo que devolvió la base, para poder comprobar la respuesta a mano. */
function BloqueDelDesglose({ d }: { d: Desglose }) {
  const filas = Array.isArray(d.datos) ? (d.datos as Record<string, unknown>[]) : null;
  const columnas = filas && filas.length && typeof filas[0] === 'object' ? Object.keys(filas[0]) : [];
  const usados = Object.entries(d.parametros).filter(([, v]) => v !== undefined);

  return (
    <details className="group rounded-md border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold">
        <span>{NOMBRE_DE_LA_CONSULTA[d.consulta] || d.consulta}</span>
        <CaretDown size={14} className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-2.5">
        <p className="text-xs text-muted-foreground">
          Con estos parámetros:{' '}
          {usados.length
            ? usados.map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' · ')
            : 'ninguno'}
        </p>
        {filas && columnas.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  {columnas.map((c) => <th key={c} className="px-2 py-1 font-semibold">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {filas.slice(0, FILAS_VISIBLES).map((f, i) => (
                  <tr key={i} className="border-t border-border">
                    {columnas.map((c) => <td key={c} className="px-2 py-1"><Valor v={f[c]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {filas.length > FILAS_VISIBLES && (
              <p className="mt-1 text-xs text-muted-foreground">
                Se enseñan {FILAS_VISIBLES} de {filas.length} filas.
              </p>
            )}
          </div>
        ) : (
          <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(d.datos, null, 2)}</pre>
        )}
      </div>
    </details>
  );
}

function Respuesta({ r }: { r: RespuestaIA }) {
  return (
    <div className="space-y-3" aria-live="polite">
      {r.sinDatos ? (
        <div className="flex gap-2.5 rounded-lg border border-border bg-muted p-4 text-sm">
          <Info size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="whitespace-pre-line">{r.respuesta}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="whitespace-pre-line text-sm leading-relaxed">{r.respuesta}</p>
        </div>
      )}

      {!r.sinDatos && r.verificada && (
        <p className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle size={14} weight="fill" aria-hidden="true" />
          Cada cifra de la respuesta sale de los datos de abajo.
        </p>
      )}

      {!r.sinDatos && !r.verificada && r.cifrasSinComprobar.length > 0 && (
        <div className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="alert">
          <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>
            Estas cifras no salen directamente de los datos:{' '}
            <strong>{r.cifrasSinComprobar.join(', ')}</strong>. Pueden ser una suma o un porcentaje calculado;
            compruébalas con el desglose antes de usarlas.
          </p>
        </div>
      )}

      {r.gasto?.cerca && (
        <p className="text-xs text-warning">
          Llevas el {r.gasto.porcentaje} % del tope de gasto en IA de este mes
          {r.gasto.queda !== null ? ` (quedan ${r.gasto.queda} USD)` : ''}.
        </p>
      )}

      {r.desglose.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">De dónde sale</h3>
          {r.desglose.map((d, i) => <BloqueDelDesglose key={`${d.consulta}-${i}`} d={d} />)}
        </div>
      )}
    </div>
  );
}

export default function PreguntarPage() {
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id: number; nombre?: string } | null;
    activeIssuerId: number | null;
  };
  const [pregunta, setPregunta] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'reposo' });

  const proyecto = activeProject && activeProject.id > 0 ? activeProject : null;
  const ambito = activeIssuerId ? 'la empresa elegida (todos sus campus)'
    : proyecto ? (proyecto.nombre || 'el proyecto elegido')
      : 'todos tus campus';

  const texto = pregunta.trim();
  const puede = texto.length >= MIN && texto.length <= MAX && estado.tipo !== 'cargando';

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    if (!puede) return;
    setEstado({ tipo: 'cargando' });
    try {
      const r = await preguntar(texto, { projectId: proyecto?.id ?? null, issuerId: activeIssuerId });
      setEstado({ tipo: 'listo', r, pregunta: texto });
    } catch (err) {
      const f = err as FalloIA;
      setEstado({ tipo: 'error', mensaje: f.message, codigo: String(f.codigo) });
    }
  }

  function alTeclear(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void enviar(); }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Pregunta a tus datos"
        subtitle={`Se contesta con los datos de ${ambito}. Cada respuesta enseña de dónde sale.`}
      />

      <form onSubmit={enviar} className="space-y-2">
        <label htmlFor="pregunta-ia" className="sr-only">Tu pregunta</label>
        <textarea
          id="pregunta-ia"
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={alTeclear}
          maxLength={MAX}
          rows={3}
          placeholder="Por ejemplo: ¿cuánto se cobró en julio?"
          className="w-full rounded-md border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {EJEMPLOS.map((ej) => (
              <button
                key={ej}
                type="button"
                onClick={() => setPregunta(ej)}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {ej}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{pregunta.length}/{MAX}</span>
            <button
              type="submit"
              disabled={!puede}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {estado.tipo === 'cargando'
                ? <><Sparkle size={14} weight="fill" className="animate-pulse" aria-hidden="true" /> Consultando…</>
                : <><PaperPlaneRight size={14} weight="bold" aria-hidden="true" /> Preguntar</>}
            </button>
          </div>
        </div>
      </form>

      {estado.tipo === 'error' && (
        <div className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-sm text-destructive-soft-foreground" role="alert">
          <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{estado.mensaje}</p>
        </div>
      )}

      {estado.tipo === 'listo' && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">«{estado.pregunta}»</h2>
          <Respuesta r={estado.r} />
        </section>
      )}
    </div>
  );
}
