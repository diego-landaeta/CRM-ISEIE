import { useEffect, useState } from 'react';
import {
  X, ArrowClockwise, CheckCircle, XCircle, WarningCircle,
  MagicWand, DownloadSimple, Eye,
} from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { conectoresApi, type Conector, type VistaPrevia } from '../api/connectors.api';
import { lista } from '@/shared/lib/lista';

/**
 * Probar el conector y decirle a que campo del CRM va cada dato (#6, parte 2).
 *
 * Es el paso que da el valor: sin esto el conector trae un JSON y no sabe donde
 * ponerlo.
 *
 * EL ORDEN ES CREAR Y LUEGO PROBAR, NO AL REVES
 *
 * El ticket insinuaba «probar conexion» antes de guardar. No se puede:
 * `POST /connectors/:id/preview` necesita un conector que ya exista. Y tiene
 * sentido — para llamar al API de fuera hacen falta las credenciales, y esas
 * viven en el conector guardado. Asi que primero se crea y aqui se prueba.
 *
 * LO QUE SE PINTA SALE DEL SERVIDOR, NO DE UNA LISTA DE AQUI
 *
 * `preview` devuelve el esquema del origen, el catalogo de campos del CRM segun
 * el destino y las transformaciones. Escribir esas listas aqui las dejaria
 * viejas en cuanto alguien añada un campo — es lo que paso con los eventos del
 * webhook de Stripe.
 */

interface Props {
  conector: Conector;
  onCerrar: () => void;
  onCambiado: () => void;
}

/** Un valor de muestra, recortado para que quepa en una celda. */
function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export default function PanelMapeo({ conector, onCerrar, onCambiado }: Props) {
  const [datos, setDatos] = useState<VistaPrevia | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapeo, setMapeo] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [verJson, setVerJson] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      setError(null);
      try {
        const r = await conectoresApi.vistaPrevia(conector.id);
        if (!vivo) return;
        if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo conectar');
        const d = r.data as VistaPrevia;
        setDatos(d);
        // Lo que ya estaba mapeado manda sobre lo que sugiere el servidor: si
        // alguien lo ajusto a mano, no se le pisa al volver a probar.
        const actual = (d.field_mapping_actual || {}) as Record<string, string>;
        setMapeo({ ...(d.sugeridos || {}), ...actual });
      } catch (e: any) {
        if (vivo) setError(e?.message || 'No se pudo conectar con el origen');
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [conector.id]);

  /**
   * Los campos del origen, SIN repetidos.
   *
   * `inspectSchema` emite la misma ruta mas de una vez cuando hay arrays: para
   * `images` saca la propia lista y luego sus hijos, y `images` aparece dos
   * veces. Eso llenaba el desplegable de opciones duplicadas y React se quejaba
   * —«two children with the same key»— cincuenta y dos veces por apertura.
   *
   * Se queda la primera, que es la que trae la muestra buena.
   */
  const campos = (() => {
    const vistos = new Set<string>();
    return lista<{ path: string; type: string; sample?: unknown }>(datos?.schema)
      .filter((c) => (vistos.has(c.path) ? false : (vistos.add(c.path), true)));
  })();
  const destinos = lista<{ key: string; label: string; required?: boolean; group?: string }>(datos?.targets);
  const muestra = lista<Record<string, unknown>>(datos?.samples)[0] || null;

  /** Los obligatorios del destino que siguen sin asignar. */
  const sinAsignar = destinos.filter((d) => d.required && !mapeo[d.key]);

  async function guardarMapeo() {
    setGuardando(true);
    try {
      // Solo lo que apunta a algo. Guardar claves vacias ensucia el mapeo y
      // luego no se distingue «sin asignar» de «asignado a nada».
      const limpio: Record<string, string> = {};
      for (const [destino, origen] of Object.entries(mapeo)) {
        if (origen) limpio[destino] = origen;
      }
      const r = await conectoresApi.cambiar(conector.id, { field_mapping: limpio });
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo guardar');
      toast({ title: 'Mapeo guardado', description: `${Object.keys(limpio).length} campos asignados.` });
      onCambiado();
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60" onClick={onCerrar}>
        <div
          role="dialog" aria-modal="true" aria-label="Probar y mapear"
          className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-md border border-border bg-card shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-border">
            <div>
              <h2 className="text-lg font-bold">Probar y mapear</h2>
              <p className="text-sm text-muted-foreground">
                Qué trae «{conector.label}» y a qué campo del CRM va cada dato.
              </p>
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {cargando ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Conectando con el origen y trayendo una muestra…
              </p>
            ) : error ? (
              <div className="rounded-md border border-red-200/60 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 p-4 space-y-1">
                <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
                  <XCircle size={15} weight="fill" /> No se pudo conectar
                </p>
                <p className="text-xs text-muted-foreground">{error}</p>
                <p className="text-xs text-muted-foreground">
                  Suele ser la dirección o las credenciales. Ciérralo, edita el conector y vuelve a probar.
                </p>
              </div>
            ) : (
              <>
                {/* Cuanto hay ahi fuera. Es lo primero que se quiere saber. */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border border-border bg-card shadow-sm p-3">
                    <p className="text-2xl font-bold tabular-nums">{datos?.items_count_total ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">elementos en el origen</p>
                  </div>
                  <div className="rounded-md border border-border bg-card shadow-sm p-3">
                    <p className="text-2xl font-bold tabular-nums">{campos.length}</p>
                    <p className="text-xs text-muted-foreground">campos detectados</p>
                  </div>
                  <div className="rounded-md border border-border bg-card shadow-sm p-3">
                    <p className="text-2xl font-bold tabular-nums">
                      {Object.values(mapeo).filter(Boolean).length}
                    </p>
                    <p className="text-xs text-muted-foreground">asignados al CRM</p>
                  </div>
                </div>

                {sinAsignar.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200/60 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm">
                    <WarningCircle size={15} weight="fill" className="text-amber-600 mt-0.5 shrink-0" />
                    <span>
                      Falta asignar <strong>{sinAsignar.map((d) => d.label).join(', ')}</strong>.
                      Sin eso la importación no puede crear nada.
                    </span>
                  </div>
                )}

                {/* La tabla de mapeo. Campo del CRM ← campo del origen. */}
                <div>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <h3 className="text-sm font-bold">De dónde sale cada campo</h3>
                      <p className="text-xs text-muted-foreground">
                        Lo que el servidor supo adivinar ya viene marcado. Revísalo.
                      </p>
                    </div>
                    <button type="button" onClick={() => setVerJson((v) => !v)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold hover:bg-muted">
                      <Eye size={14} /> {verJson ? 'Ocultar el JSON' : 'Ver el JSON de origen'}
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left font-medium px-3 py-2 w-[34%]">Campo del CRM</th>
                          <th className="text-left font-medium px-3 py-2 w-[33%]">Viene de</th>
                          <th className="text-left font-medium px-3 py-2">Ejemplo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {destinos.map((d) => {
                          const origen = mapeo[d.key] || '';
                          const ejemplo = campos.find((c) => c.path === origen)?.sample;
                          const sugerido = datos?.sugeridos?.[d.key];
                          return (
                            <tr key={d.key} className="border-t border-border align-middle">
                              <td className="px-3 py-2">
                                <span className="font-medium">{d.label}</span>
                                {d.required && <span className="text-red-600 ml-0.5">*</span>}
                                {d.group && (
                                  <span className="block text-[11px] text-muted-foreground">{d.group}</span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={origen}
                                  onChange={(e) => setMapeo((p) => ({ ...p, [d.key]: e.target.value }))}
                                  aria-label={`Origen de ${d.label}`}
                                  className="w-full text-xs px-2 py-1.5 rounded-md border border-border bg-background font-mono"
                                >
                                  <option value="">— sin asignar —</option>
                                  {campos.map((c) => (
                                    <option key={c.path} value={c.path}>
                                      {c.path}{c.path === sugerido ? '  (sugerido)' : ''}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                                {origen ? comoTexto(ejemplo) : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {verJson && muestra && (
                  <div>
                    <h3 className="text-sm font-bold mb-1">El primer elemento, tal cual llega</h3>
                    <pre className="text-[11px] bg-muted rounded-md p-3 overflow-x-auto max-h-64">
                      {JSON.stringify(muestra, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              {datos && !error && (
                <>
                  <CheckCircle size={13} weight="fill" className="text-emerald-600" />
                  Conectado. Nada se importa hasta que lo pidas.
                </>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onCerrar}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-bold hover:bg-muted">
                Cerrar
              </button>
              <button type="button" onClick={guardarMapeo} disabled={guardando || !!error || cargando}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                <MagicWand size={14} /> {guardando ? 'Guardando…' : 'Guardar el mapeo'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
