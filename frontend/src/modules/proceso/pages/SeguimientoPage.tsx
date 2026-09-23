/*
  El repaso de fin de mes (#90 · el quinto paso del documento).

  NO ES LA COLA DEL DÍA, y por eso tiene pantalla propia. La cola es el
  recorrido de UNA persona —día 1, día 2, día 4— y se abre cada mañana. Esto es
  la base entera de quien entró hace tiempo, no compró y tampoco dijo que no:
  gente que se quedó por el camino y a la que se vuelve cuando se puede, no
  todos los días. Metida en la cola, la llenaría con media base y taparía lo que
  de verdad toca hoy.

  El orden lo dice el olvido: primero quien nunca recibió un contacto, después
  quien lleva más tiempo sin noticias. Y quien ya se repasó hace poco no sale,
  porque si no la lista deja de significar «pendientes» y pasa a ser «todos».
*/
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowCounterClockwise, CalendarBlank, User, Buildings, WarningCircle,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useProyectosDelAmbito } from '@/shared/hooks/useAmbito';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import {
  traerSeguimiento, traerResumenSeguimiento,
  type EnSeguimiento, type ResumenSeguimiento, type PasoEnCola,
} from '../api/agenda.api';
import PanelDeCola from '../components/PanelDeCola';
import { trasSacar } from '../lib/cola';

/** Los bloques de antigüedad, en su orden y con nombre corto. */
const BLOQUES = [
  { clave: 'este_mes', corto: 'Este mes' },
  { clave: 'uno_a_tres', corto: '1 a 3 meses' },
  { clave: 'tres_a_seis', corto: '3 a 6 meses' },
  { clave: 'mas_de_seis', corto: 'Más de 6 meses' },
] as const;

function Contador({ etiqueta, valor, activo, onClick, tono = '' }: {
  etiqueta: string; valor: number; activo: boolean; onClick: () => void; tono?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={
        'rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 '
        + (activo ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50')
      }
    >
      <div className={'text-[11px] font-semibold uppercase tracking-wide ' + (tono || 'text-muted-foreground')}>
        {etiqueta}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
    </button>
  );
}

/** «hace 3 meses», «hace 20 días» — no una fecha que haya que restar. */
function hace(dias: number | null) {
  if (dias == null) return 'nunca';
  if (dias < 30) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const anios = Math.floor(meses / 12);
  return `hace ${anios} ${anios === 1 ? 'año' : 'años'}`;
}

export default function SeguimientoPage() {
  const { activeProject, activeIssuer } = useProjectContext();
  const campus = useProyectosDelAmbito<{ id: number; nombre: string }>();
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [base, setBase] = useState<EnSeguimiento[]>([]);
  const [resumen, setResumen] = useState<ResumenSeguimiento | null>(null);
  const [cargando, setCargando] = useState(true);
  const [bloque, setBloque] = useState<string | null>(null);
  const [soloSinContactar, setSoloSinContactar] = useState(false);
  const [enFoco, setEnFoco] = useState<number | null>(null);
  const [apuntando, setApuntando] = useState(false);

  const elegido = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;
  const idsEmpresa = useMemo(
    () => (activeIssuer && !elegido ? campus.map((c) => c.id) : []),
    [activeIssuer, elegido, campus],
  );
  const projectIds = idsEmpresa.length ? idsEmpresa.join(',') : null;
  const mezcla = !elegido;

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      traerSeguimiento({ projectId: elegido, projectIds }),
      traerResumenSeguimiento({ projectId: elegido, projectIds }),
    ]).then(([b, r]) => {
      if (!vivo) return;
      setBase(b);
      setResumen(r);
    }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [elegido, projectIds]);

  const visibles = useMemo(() => {
    let out = base;
    if (bloque) out = out.filter((x) => x.antiguedad === bloque);
    if (soloSinContactar) out = out.filter((x) => x.ultimo_contacto == null);
    return out;
  }, [base, bloque, soloSinContactar]);

  useEffect(() => {
    if (enFoco !== null && enFoco >= visibles.length) setEnFoco(null);
  }, [visibles.length, enFoco]);

  /**
   * Apunta el contacto y pasa al siguiente.
   *
   * Lo mismo que en la cola del día: se apunta lo que ha pasado de verdad y la
   * persona sale de la lista, porque ya se le ha tocado este mes.
   */
  async function apuntarContacto(tipo: string, nota: string) {
    if (enFoco === null) return;
    const fila = visibles[enFoco];
    if (!fila) return;
    setApuntando(true);
    try {
      await client.post(`/leads/${fila.lead_id}/interactions`, {
        tipo,
        nota: nota || 'Seguimiento de fin de mes',
        fecha: new Date().toISOString(),
      });
      setBase((b) => b.filter((x) => x.lead_id !== fila.lead_id));
      setEnFoco(trasSacar(visibles.length, enFoco));
      toast({ title: 'Contacto apuntado', description: `${fila.lead_nombre || 'Sin nombre'} sale del repaso.` });
      traerResumenSeguimiento({ projectId: elegido, projectIds })
        .then((r) => { if (r) setResumen(r); }).catch(() => {});
    } catch (e) {
      const err = e as { message?: string };
      toast({
        title: 'No se ha podido apuntar',
        description: err?.message || 'Inténtalo otra vez; no se ha guardado nada.',
        variant: 'destructive',
      });
    } finally {
      setApuntando(false);
    }
  }

  /** Copiar deja rastro, pero como NOTA: copiar no es hablar con nadie. */
  function apuntarCopia(leadId: number, nombrePlantilla: string) {
    client.post(`/leads/${leadId}/interactions`, {
      tipo: 'nota',
      nota: `Copiado el mensaje «${nombrePlantilla}»`,
      fecha: new Date().toISOString(),
    }).catch(() => { /* el trabajo es escribirle, no apuntar la nota */ });
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Seguimiento de fin de mes"
        subtitle={
          activeIssuer && !elegido
            ? `Los ${campus.length} campus de ${activeIssuer.nombre}. Quien entró, no compró y lleva tiempo sin noticias.`
            : 'Quien entró, no compró y lleva tiempo sin noticias. No es la cola del día: esto es toda la base.'
        }
      />

      {resumen && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {BLOQUES.map((b) => (
              <Contador
                key={b.clave}
                etiqueta={b.corto}
                valor={Number((resumen as unknown as Record<string, number>)[b.clave] || 0)}
                activo={bloque === b.clave}
                onClick={() => setBloque(bloque === b.clave ? null : b.clave)}
              />
            ))}
          </div>

          {/* Los que NUNCA recibieron un contacto. Van aparte porque no son
              «un seguimiento más»: son los que se perdieron sin que nadie les
              escribiera, y es lo primero que hay que tapar. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSoloSinContactar((v) => !v)}
              aria-pressed={soloSinContactar}
              className={
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-normal transition-colors '
                + 'focus:outline-none focus:ring-2 focus:ring-primary/40 '
                + (soloSinContactar
                  ? 'border-primary bg-primary/10 font-semibold text-primary'
                  : 'border-border hover:bg-muted')
              }
            >
              <WarningCircle size={13} weight="bold" />
              Sin contactar nunca
              <span className="tabular-nums opacity-70">{resumen.nunca_contactados}</span>
            </button>
            <p className="text-secundario text-muted-foreground">
              {resumen.total} en total · se muestran {base.length}
              {base.length < resumen.total && ', los más olvidados primero'}
            </p>
          </div>
        </>
      )}

      {cargando ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={ArrowCounterClockwise}
          title="No hay nadie que repasar"
          description={
            resumen && resumen.total === 0
              ? 'Toda la base está al día: a todo el que no compró se le ha escrito hace poco.'
              : 'Con estos filtros no queda nadie. Prueba con otro tramo.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visibles.map((p, i) => (
            <button
              key={p.lead_id}
              type="button"
              onClick={() => setEnFoco(i)}
              className={
                'w-full text-left rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 '
                + 'focus:outline-none focus:ring-2 focus:ring-primary/40 '
                + (p.ultimo_contacto == null ? 'border-l-4 border-l-warning border-border' : 'border-border')
              }
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex shrink-0 flex-col items-center rounded-md bg-muted px-2 py-1 text-muted-foreground">
                  <CalendarBlank size={13} />
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-semibold truncate">{p.lead_nombre || 'Sin nombre'}</span>
                    <span className="text-xs text-muted-foreground">
                      entró {hace(p.dias_desde_entrada)}
                    </span>
                    <span className={
                      'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide '
                      + (p.ultimo_contacto == null
                        ? 'bg-warning-soft text-warning-soft-foreground'
                        : 'bg-muted text-muted-foreground')
                    }>
                      {p.ultimo_contacto == null
                        ? 'sin contactar nunca'
                        : `último contacto ${hace(p.dias_sin_contacto)}`}
                    </span>
                  </div>

                  {p.producto && (
                    <p className="truncate text-[11px] text-muted-foreground">{p.producto}</p>
                  )}
                </div>

                <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                  {mezcla && p.proyecto && (
                    <div className="inline-flex items-center gap-1"><Buildings size={11} />{p.proyecto}</div>
                  )}
                  {esAdmin && p.gestora && (
                    <div className="inline-flex items-center gap-1"><User size={11} />{p.gestora}</div>
                  )}
                  <div className="tabular-nums">
                    {p.contactos === 0
                      ? 'sin contactar aún'
                      : `${p.contactos} ${p.contactos === 1 ? 'contacto' : 'contactos'}`}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Al apuntar un contacto, la persona <strong className="text-foreground">sale de este repaso</strong> y no vuelve
        a salir hasta dentro de un mes. Copiar el mensaje no cuenta: copiar no es escribirle.
      </p>

      {enFoco !== null && visibles[enFoco] && (
        <PanelDeCola
          // La misma ventana que la cola del día: el mismo mensaje, el mismo
          // botón de copiar y el mismo apuntado. Dos ventanas distintas para
          // hacer lo mismo se acaban pareciendo cada vez menos.
          fila={{
            ...visibles[enFoco],
            // El panel pide estos dos porque en la cola son su razón de ser.
            // Aquí no hay fecha prevista —nadie la puso—, así que va la de
            // entrada y el retraso a cero: lo que urge se dice con
            // `textoUrgencia`, que es lo que de verdad significa algo aquí.
            fecha_prevista: visibles[enFoco].fecha_entrada,
            dias_de_retraso: 0,
          } satisfies PasoEnCola}
          textoUrgencia={
            visibles[enFoco].ultimo_contacto == null
              ? `Entró ${hace(visibles[enFoco].dias_desde_entrada)} y nunca se le ha contactado.`
              : `Entró ${hace(visibles[enFoco].dias_desde_entrada)}. Último contacto, ${hace(visibles[enFoco].dias_sin_contacto)}.`
          }
          posicion={enFoco + 1}
          total={visibles.length}
          guardando={apuntando}
          onContactado={(tipo, nota) => apuntarContacto(tipo, nota)}
          onPlantillaCopiada={(nombre) => apuntarCopia(visibles[enFoco].lead_id, nombre)}
          onAnterior={() => setEnFoco((n) => (n === null ? null : Math.max(0, n - 1)))}
          onSiguiente={() => setEnFoco((n) => (n === null ? null : Math.min(visibles.length - 1, n + 1)))}
          onCerrar={() => setEnFoco(null)}
        />
      )}
    </div>
  );
}
