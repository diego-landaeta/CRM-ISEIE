import { useCallback, useEffect, useState } from 'react';
import { Warning } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import Field from '@/shared/components/ui/Field';
import { Button } from '@/shared/components/ui/button';
import { inputClass } from '@/shared/lib/ui';
import { consultasApi, type MiCarga, type NivelCarga, type DatosReales } from '../api/consultas.api';
import ConsultasNav, { mensajeDeError } from '../components/ConsultasNav';

/*
  «Mi carga de trabajo» (#189): el tutor escribe en qué está y elige un nivel.
  Cada cambio queda en el historial. Al lado, sus datos reales. Si pasa una
  semana sin actualizarla (decisión 9), sale «desactualizada».
*/

export const NIVELES: Array<{ valor: NivelCarga; texto: string; clase: string }> = [
  { valor: 'baja', texto: 'Baja', clase: 'bg-success-soft text-success-soft-foreground' },
  { valor: 'media', texto: 'Media', clase: 'bg-info-soft text-info-soft-foreground' },
  { valor: 'alta', texto: 'Alta', clase: 'bg-warning-soft text-warning-soft-foreground' },
  { valor: 'completa', texto: 'Completa', clase: 'bg-destructive-soft text-destructive-soft-foreground' },
];

export function NivelCargaChip({ nivel }: { nivel: NivelCarga | null | undefined }) {
  const n = NIVELES.find((x) => x.valor === nivel);
  if (!n) return <span className="text-xs text-muted-foreground">Sin indicar</span>;
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-xs font-semibold ${n.clase}`}>{n.texto}</span>;
}

export function DatosRealesTutor({ d }: { d: DatosReales | undefined }) {
  const filas: Array<[string, number]> = [
    ['Alumnos activos', d?.alumnos_activos ?? 0],
    ['Consultas abiertas', d?.consultas_abiertas ?? 0],
    ['Alumnos sin mensajes', d?.alumnos_sin_mensajes ?? 0],
  ];
  return (
    <dl className="grid grid-cols-3 gap-2">
      {filas.map(([t, n]) => (
        <div key={t} className="rounded-md border border-border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t}</dt>
          <dd className="text-lg font-semibold tabular-nums">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

const fechaHora = (s: string) => new Date(s).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

export default function MiCargaPage() {
  const [datos, setDatos] = useState<MiCarga | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nivel, setNivel] = useState<NivelCarga | null>(null);
  const [texto, setTexto] = useState('');
  const [faltaNivel, setFaltaNivel] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await consultasApi.miCarga();
      if (r.success && r.data) {
        setDatos(r.data);
        setNivel(r.data.actual?.nivel ?? null);
        setTexto(r.data.actual?.texto ?? '');
      }
    } catch (e) {
      // Sin esto se quedaba en «Cargando…» para siempre (p. ej., un admin que no es tutor).
      setError(mensajeDeError(e) || 'No se ha podido cargar.');
      toast({ title: 'No se ha podido cargar tu carga de trabajo', description: mensajeDeError(e), variant: 'destructive' });
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar() {
    if (!nivel) { setFaltaNivel(true); return; }
    setGuardando(true);
    try {
      const r = await consultasApi.guardarCarga(nivel, texto.trim() || null);
      if (r.success && r.data) setDatos(r.data);
      toast({ title: 'Carga de trabajo actualizada' });
    } catch (e) {
      toast({ title: 'No se ha podido guardar', description: mensajeDeError(e), variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <div className="space-y-4 pb-8">
      <ConsultasNav />
      <PageHeader title="Mi carga de trabajo"
        subtitle="Cuéntale a administración en qué estás y cuánta carga tienes. Actualízala al menos una vez por semana." />

      {error && !datos ? (
        <p role="alert" className="text-sm text-destructive">No se ha podido cargar tu carga de trabajo: {error}</p>
      ) : !datos ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="max-w-4xl mx-auto grid gap-4 lg:grid-cols-[1fr_18rem]">
          <section className="space-y-4">
            {datos.desactualizada && (
              <div role="status" className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
                <Warning size={16} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {datos.actual
                    ? `Desactualizada: hace más de ${datos.diasPlazo} días que no la cambias. Revísala y guárdala aunque siga igual.`
                    : 'Aún no has indicado tu carga de trabajo.'}
                </span>
              </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <Field label="Nivel de carga" required
                error={faltaNivel ? 'Falta el nivel: elige baja, media, alta o completa en «Nivel de carga».' : undefined}
                hint="Con «Completa» no te llegan consultas nuevas si hay otro tutor en el campus.">
                <div role="radiogroup" aria-label="Nivel de carga" className="flex flex-wrap gap-1">
                  {NIVELES.map((n) => (
                    <button key={n.valor} type="button" role="radio" aria-checked={nivel === n.valor}
                      onClick={() => { setNivel(n.valor); setFaltaNivel(false); }}
                      className={`h-8 px-3 rounded-md text-sm font-semibold border ${nivel === n.valor ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}>
                      {n.texto}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="En qué estás trabajando" htmlFor="carga-texto" hint="Opcional. Lo ve administración en el panel de tutores.">
                <textarea id="carga-texto" rows={4} value={texto} maxLength={2000} onChange={(e) => setTexto(e.target.value)}
                  className={`${inputClass} h-auto py-2`} />
              </Field>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {datos.actual ? `Última actualización: ${fechaHora(datos.actual.created_at)}` : 'Sin actualizar todavía'}
                </span>
                <Button size="sm" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card">
              <h2 className="px-4 py-2 text-sm font-semibold border-b border-border">Historial</h2>
              {datos.historial.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Sin cambios todavía.</p>
              ) : (
                <ul className="divide-y divide-border" aria-label="Historial de la carga">
                  {datos.historial.map((h) => (
                    <li key={h.id} className="px-4 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <NivelCargaChip nivel={h.nivel} />
                        <span className="text-xs text-muted-foreground">{fechaHora(h.created_at)}</span>
                      </div>
                      {h.texto && <p className="mt-1 whitespace-pre-line">{h.texto}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <aside className="space-y-2">
            <h2 className="text-sm font-semibold">Tus datos reales</h2>
            <p className="text-xs text-muted-foreground">Los cuenta el CRM, al lado de lo que tú indicas.</p>
            <DatosRealesTutor d={datos.datosReales} />
          </aside>
        </div>
      )}
    </div>
  );
}
