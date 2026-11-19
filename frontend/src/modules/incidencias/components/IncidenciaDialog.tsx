import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Paperclip, ArrowSquareOut, FloppyDisk } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import FilaCampos from '@/shared/components/ui/FilaCampos';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import { MARCA } from '@/shared/config/marca';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/hooks/useToast';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import {
  incidenciasApi, type Incidencia, type DatosIncidencia, type TipoIncidencia,
  type Gravedad, type EstadoIncidencia, type EntidadTipo,
} from '../api/incidencias.api';
import {
  TIPOS, ORDEN_TIPOS, ESTADOS, GRAVEDADES, ENTIDADES, enlaceDe, comoHoraLocal, desdeHoraLocal, fechaHora,
} from '../lib/incidencias';

export interface Persona { id: number; nombre: string }
export interface Campus { id: number; nombre: string; sociedad_emisora_id?: number | null; sociedad_nombre?: string | null }

const MAX_ADJUNTOS = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS_FICHERO = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

/** El campus o la empresa, en un solo desplegable: «p:7», «e:3» o vacío. */
function dondeDe(inc: Partial<Incidencia>): string {
  if (inc.projectId) return `p:${inc.projectId}`;
  if (inc.sociedadId) return `e:${inc.sociedadId}`;
  return '';
}

interface Props {
  /** La incidencia a editar o ver; sin ella, una nueva. */
  incidencia?: Incidencia | null;
  /** Sin permiso de editar: se ve, pero no se cambia nada. */
  soloLectura?: boolean;
  personas: Persona[];
  campus: Campus[];
  /** Para una nueva: el campus («p:7») o la empresa («e:3») elegidos arriba. */
  dondeInicial?: string;
  /** Superadmin y soporte: pueden dejarla sin campus («todo el CRM»). */
  veTodo?: boolean;
  yo: number | null;
  onCerrar: () => void;
  onGuardada: (inc: Incidencia) => void;
}

/** Lo de arriba solo vale si se puede elegir aquí: un campus suyo o la empresa de uno. */
function dondeValido(donde: string | undefined, campus: Campus[]): string {
  if (!donde) return '';
  const [clase, id] = donde.split(':');
  const n = Number(id);
  if (clase === 'p') return campus.some((c) => Number(c.id) === n) ? donde : '';
  if (clase === 'e') return campus.some((c) => Number(c.sociedad_emisora_id) === n) ? donde : '';
  return '';
}

export default function IncidenciaDialog({ incidencia, soloLectura = false, personas, campus, dondeInicial, veTodo = false, yo, onCerrar, onGuardada }: Props) {
  const nueva = !incidencia;
  const ref = useRef<HTMLDivElement>(null);
  const [guardando, setGuardando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [ficheros, setFicheros] = useState<File[]>([]);

  const [f, setF] = useState(() => ({
    ocurrioAt: comoHoraLocal(incidencia?.ocurrioAt || new Date().toISOString()),
    crm: incidencia?.crm || 'iseie',
    // Una nueva sale con el campus o la empresa de arriba: si no, se apuntaba
    // a «todo el CRM» sin querer y no salía en la lista que se estaba mirando.
    donde: incidencia ? dondeDe(incidencia) : dondeValido(dondeInicial, campus),
    tipos: incidencia?.tipos || (['capa8'] as TipoIncidencia[]),
    causadaPor: incidencia?.causadaPor ?? null,
    detectadaPor: incidencia ? incidencia.detectadaPor : yo,
    entidadTipo: incidencia?.entidadTipo ?? null,
    entidadId: incidencia?.entidadId ? String(incidencia.entidadId) : '',
    quePaso: incidencia?.quePaso || '',
    impacto: incidencia?.impacto || '',
    comoSeArreglo: incidencia?.comoSeArreglo || '',
    arregladaPor: incidencia?.arregladaPor ?? null,
    arregladaAt: comoHoraLocal(incidencia?.arregladaAt || null),
    gravedad: incidencia?.gravedad || ('medium' as Gravedad),
    estado: incidencia?.estado || ('open' as EstadoIncidencia),
  }));
  const poner = (d: Partial<typeof f>) => setF((v) => ({ ...v, ...d }));

  useModalAccesible(ref, { open: true, onClose: onCerrar, bloqueado: guardando });

  // Campus y empresas de quien la apunta: el servidor no deja otros (403).
  const opcionesDonde = useMemo(() => {
    const empresas = new Map<number, string>();
    for (const c of campus) {
      if (c.sociedad_emisora_id) empresas.set(Number(c.sociedad_emisora_id), c.sociedad_nombre || 'Empresa');
    }
    // «Todo el CRM» solo para superadmin y soporte: para el resto, el servidor
    // la pide con campus o empresa (400), o la vería cualquier otra empresa.
    // En solo lectura se enseña tal cual está, no un «Elige…» que no se puede.
    const lista = [
      ...(veTodo || soloLectura ? [{ value: '', label: 'Ninguno (todo el CRM)' }] : []),
      ...[...empresas].map(([id, nombre]) => ({ value: `e:${id}`, label: `Empresa · ${nombre}` })),
      ...campus.map((c) => ({ value: `p:${c.id}`, label: `Campus · ${c.nombre}` })),
    ];
    // Una incidencia puede apuntar a un campus que no es de quien la abre (la
    // causó él en otro): se enseña con su nombre en vez de un hueco.
    const suyo = incidencia ? dondeDe(incidencia) : '';
    if (suyo && !lista.some((o) => o.value === suyo)) {
      lista.push({ value: suyo, label: incidencia!.projectName || incidencia!.sociedadName || 'Otro campus' });
    }
    return lista;
  }, [campus, incidencia, veTodo, soloLectura]);

  const opcionesPersona = useMemo(() => {
    const lista = [{ value: null as number | null, label: 'Nadie del CRM' }, ...personas.map((p) => ({ value: p.id as number | null, label: p.nombre }))];
    // Las de la propia incidencia, aunque ya no salgan en la lista de usuarios.
    for (const [id, nombre] of [
      [incidencia?.causadaPor, incidencia?.causadaPorNombre],
      [incidencia?.detectadaPor, incidencia?.detectadaPorNombre],
      [incidencia?.arregladaPor, incidencia?.arregladaPorNombre],
    ] as const) {
      if (id && !lista.some((o) => o.value === id)) lista.push({ value: id, label: nombre || `Usuario ${id}` });
    }
    return lista;
  }, [personas, incidencia]);

  function alternarTipo(t: TipoIncidencia) {
    poner({ tipos: f.tipos.includes(t) ? f.tipos.filter((x) => x !== t) : [...f.tipos, t] });
  }

  function anadirFicheros(lista: File[]) {
    const validos: File[] = [];
    for (const fi of lista) {
      if (!TIPOS_FICHERO.includes(fi.type)) {
        toast({ title: 'Ese archivo no vale', description: `${fi.name}: solo PNG, JPG, WEBP o PDF`, variant: 'destructive' });
      } else if (fi.size > MAX_BYTES) {
        toast({ title: 'Archivo muy grande', description: `${fi.name}: máximo 10 MB`, variant: 'destructive' });
      } else validos.push(fi);
    }
    const yaHay = (incidencia?.adjuntos.length || 0) + ficheros.length;
    if (yaHay + validos.length > MAX_ADJUNTOS) {
      toast({ title: `Máximo ${MAX_ADJUNTOS} adjuntos`, variant: 'destructive' });
    }
    setFicheros((v) => [...v, ...validos].slice(0, Math.max(0, MAX_ADJUNTOS - (incidencia?.adjuntos.length || 0))));
  }

  function validar(): boolean {
    const e: Record<string, string> = {};
    if (f.quePaso.trim().length < 3) e.quePaso = 'Cuenta qué pasó';
    if (!f.tipos.length) e.tipos = 'Elige al menos un tipo';
    if (!f.ocurrioAt) e.ocurrioAt = 'Pon cuándo pasó';
    if (!veTodo && !f.donde) e.donde = 'Elige el campus o la empresa';
    if (f.entidadId && !/^\d{1,10}$/.test(f.entidadId)) e.entidadId = 'Solo el número';
    setErrores(e);
    // Al primer campo con error, en el orden en que se pintan: con el botón
    // abajo, el aviso de arriba no se veía. De «Tipo», su primer botón.
    const primero = ([
      ['ocurrioAt', 'inc-cuando'], ['donde', 'inc-donde'], ['tipos', 'inc-tipos'],
      ['entidadId', 'inc-entidad-id'], ['quePaso', 'inc-que'],
    ] as const).find(([k]) => e[k]);
    if (primero) {
      const caja = document.getElementById(primero[1]);
      const el = primero[0] === 'tipos' ? caja?.querySelector('button') : caja;
      el?.scrollIntoView?.({ block: 'center' });
      el?.focus();
    }
    return Object.keys(e).length === 0;
  }

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (soloLectura || !validar()) return;
    const [clase, id] = f.donde ? f.donde.split(':') : [null, null];
    const datos: DatosIncidencia = {
      ocurrioAt: desdeHoraLocal(f.ocurrioAt),
      crm: f.crm,
      projectId: clase === 'p' ? Number(id) : null,
      sociedadId: clase === 'e' ? Number(id) : null,
      tipos: f.tipos,
      causadaPor: f.causadaPor,
      detectadaPor: f.detectadaPor,
      entidadTipo: f.entidadTipo,
      entidadId: f.entidadId ? Number(f.entidadId) : null,
      quePaso: f.quePaso.trim(),
      impacto: f.impacto,
      comoSeArreglo: f.comoSeArreglo,
      arregladaPor: f.arregladaPor,
      arregladaAt: f.arregladaAt ? desdeHoraLocal(f.arregladaAt) : null,
      gravedad: f.gravedad,
      estado: f.estado,
    };
    // Al cerrarla sin decir cuándo se arregló, lo pone el servidor (ahora). Si
    // ya tenía fecha y se ha vaciado, sí se manda el vacío: si no, no se podía borrar.
    if (!f.arregladaAt && !incidencia?.arregladaAt) delete datos.arregladaAt;
    // Sin cambiar el campus, no se manda: el servidor comprueba que el campus
    // que llega es de quien guarda, y una suya de otro campus daría 403.
    if (!nueva && f.donde === dondeDe(incidencia!)) {
      delete datos.projectId;
      delete datos.sociedadId;
    }

    setGuardando(true);
    try {
      const r = nueva ? await incidenciasApi.crear(datos) : await incidenciasApi.editar(incidencia!.id, datos);
      if (!r.success || !r.data) throw new Error(r.error || 'No se pudo guardar');
      let guardada = r.data as Incidencia;
      // Los adjuntos van después: la incidencia tiene que existir antes. Si uno
      // falla, la incidencia ya está guardada y se dice cuál.
      const fallidos: string[] = [];
      for (const fi of ficheros) {
        const a = await incidenciasApi.subirAdjunto(guardada.id, fi).catch(() => null);
        if (!a?.success) fallidos.push(fi.name);
      }
      if (ficheros.length) {
        const otra = await incidenciasApi.porId(guardada.id).catch(() => null);
        if (otra?.success && otra.data) guardada = otra.data as Incidencia;
      }
      toast({ title: nueva ? 'Incidencia apuntada' : 'Incidencia guardada' });
      if (fallidos.length) {
        toast({ title: 'Algún adjunto no se subió', description: fallidos.join(', '), variant: 'destructive' });
      }
      onGuardada(guardada);
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  }

  // La venta o el nombre que dio el servidor valen mientras «sobre qué» sea el
  // que estaba guardado; si se cambia en el formulario, a su pantalla.
  const mismaEntidad = !!incidencia && f.entidadTipo === incidencia.entidadTipo
    && Number(f.entidadId) === Number(incidencia.entidadId);
  const enlace = enlaceDe(f.entidadTipo, f.entidadId ? Number(f.entidadId) : null,
    mismaEntidad ? { ventaId: incidencia!.entidadVentaId, nombre: incidencia!.entidadNombre } : {});
  // Lo que hace el enlace de una factura o un usuario, que no tienen ficha propia.
  // Sin venta o sin nombre (de otra empresa, o quien no puede ver Usuarios), lo
  // que se abre de verdad: Facturas, o Configuración sin buscar a nadie.
  const pistaDeEntidad = f.entidadTipo === 'factura'
    ? (enlace && enlace.startsWith('/ventas/') ? 'Abre la venta de esa factura.' : 'Se abre Facturas: búscala con este número.')
    : f.entidadTipo === 'usuario'
      ? 'Se abre Configuración › Usuarios: búscalo allí.'
      : undefined;
  const area = cn(inputClass, 'h-auto py-2 resize-y');

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60" onClick={() => !guardando && onCerrar()}>
        <div
          ref={ref}
          role="dialog" aria-modal="true"
          aria-label={nueva ? 'Nueva incidencia' : `Incidencia ${incidencia!.id}`}
          className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-md border border-border bg-card shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="flex items-center justify-between gap-3 px-tarjeta py-3 border-b border-border">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{nueva ? 'Nueva incidencia' : `Incidencia #${incidencia!.id}`}</h2>
              {!nueva && (
                <p className="text-secundario text-muted-foreground truncate">
                  Apuntada por {incidencia!.creadaPorNombre || 'alguien que ya no está'} · {fechaHora(incidencia!.createdAt)}
                  {/* Los campos van bloqueados, pero a simple vista no se nota. */}
                  {soloLectura && ' · Solo lectura'}
                </p>
              )}
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" disabled={guardando}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
              <X size={14} weight="bold" />
            </button>
          </header>

          <form onSubmit={guardar} className="flex-1 overflow-y-auto p-tarjeta space-y-4" noValidate>
            <fieldset disabled={soloLectura || guardando} className="space-y-4 min-w-0">
              <FilaCampos columnas={3}>
                <Field label="Cuándo pasó" required htmlFor="inc-cuando" error={errores.ocurrioAt} hint="Hora de Madrid">
                  <input id="inc-cuando" type="datetime-local" data-autofocus value={f.ocurrioAt}
                    onChange={(e) => poner({ ocurrioAt: e.target.value })} className={inputClass} />
                </Field>
                <Field label="CRM" htmlFor="inc-crm">
                  <Select id="inc-crm" value={f.crm} onChange={(v) => poner({ crm: v })} ariaLabel="CRM" disabled={soloLectura}
                    options={[{ value: 'iseie', label: MARCA }, { value: 'multicrm', label: '360 CRM' }] as { value: 'multicrm' | 'iseie'; label: string }[]} />
                </Field>
                <Field label="Campus o empresa" required={!veTodo && !soloLectura} htmlFor="inc-donde" error={errores.donde}>
                  <Select id="inc-donde" value={f.donde} onChange={(v) => poner({ donde: v })} options={opcionesDonde}
                    placeholder="Elige…" ariaLabel="Campus o empresa" disabled={soloLectura} />
                </Field>
              </FilaCampos>

              <Field label="Tipo" required error={errores.tipos} hint="Puede ser más de uno: capa 8 y fallo del CRM a la vez.">
                <div id="inc-tipos" className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo">
                  {ORDEN_TIPOS.map((t) => {
                    const activo = f.tipos.includes(t);
                    return (
                      <button key={t} type="button" aria-pressed={activo} title={TIPOS[t].detalle}
                        onClick={() => alternarTipo(t)}
                        className={cn('h-8 px-3 rounded-md text-xs font-semibold border transition-colors',
                          activo ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted')}>
                        {TIPOS[t].label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <FilaCampos columnas={2}>
                <Field label="Quién la causó" htmlFor="inc-causa" hint="Si fue alguien del CRM.">
                  <Select id="inc-causa" value={f.causadaPor} onChange={(v) => poner({ causadaPor: v })} options={opcionesPersona}
                    ariaLabel="Quién la causó" disabled={soloLectura} />
                </Field>
                <Field label="Quién la detectó" htmlFor="inc-detecta">
                  <Select id="inc-detecta" value={f.detectadaPor} onChange={(v) => poner({ detectadaPor: v })} options={opcionesPersona}
                    ariaLabel="Quién la detectó" disabled={soloLectura} />
                </Field>
              </FilaCampos>

              <FilaCampos columnas={2}>
                <Field label="Sobre qué" htmlFor="inc-entidad">
                  <Select id="inc-entidad" value={f.entidadTipo}
                    onChange={(v) => poner({ entidadTipo: v, entidadId: v === 'otro' || !v ? '' : f.entidadId })}
                    options={[{ value: null as EntidadTipo | null, label: 'Nada en concreto' },
                      ...(Object.keys(ENTIDADES) as EntidadTipo[]).map((k) => ({ value: k as EntidadTipo | null, label: ENTIDADES[k] }))]}
                    ariaLabel="Sobre qué" disabled={soloLectura} />
                </Field>
                <Field label="Su número (id)" htmlFor="inc-entidad-id" error={errores.entidadId}
                  hint={pistaDeEntidad}>
                  <div className="flex gap-2">
                    <input id="inc-entidad-id" inputMode="numeric" value={f.entidadId}
                      disabled={soloLectura || !f.entidadTipo || f.entidadTipo === 'otro'}
                      onChange={(e) => poner({ entidadId: e.target.value.trim() })} className={inputClass} placeholder="4033" />
                    {enlace && (
                      <Link to={enlace} target="_blank" title="Abrir la ficha" aria-label="Abrir la ficha"
                        className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted">
                        <ArrowSquareOut size={15} />
                      </Link>
                    )}
                  </div>
                </Field>
              </FilaCampos>

              <Field label="Qué pasó" required htmlFor="inc-que" error={errores.quePaso}>
                <textarea id="inc-que" rows={3} value={f.quePaso} onChange={(e) => poner({ quePaso: e.target.value })}
                  className={area} placeholder="Irene se dio de alta en ISSLOGG en vez de ISEIH…" />
              </Field>
              <Field label="Qué impacto tuvo" htmlFor="inc-impacto">
                <textarea id="inc-impacto" rows={2} value={f.impacto} onChange={(e) => poner({ impacto: e.target.value })}
                  className={area} placeholder="No se pudo convertir" />
              </Field>
              <Field label="Cómo se arregló" htmlFor="inc-arreglo">
                <textarea id="inc-arreglo" rows={2} value={f.comoSeArreglo} onChange={(e) => poner({ comoSeArreglo: e.target.value })}
                  className={area} />
              </Field>

              <FilaCampos columnas={2}>
                <Field label="Quién la arregló" htmlFor="inc-arreglo-quien">
                  <Select id="inc-arreglo-quien" value={f.arregladaPor} onChange={(v) => poner({ arregladaPor: v })} options={opcionesPersona}
                    ariaLabel="Quién la arregló" disabled={soloLectura} />
                </Field>
                <Field label="Cuándo se arregló" htmlFor="inc-arreglo-cuando" hint="Si se cierra sin fecha, se pone la de ese momento.">
                  <input id="inc-arreglo-cuando" type="datetime-local" value={f.arregladaAt}
                    onChange={(e) => poner({ arregladaAt: e.target.value })} className={inputClass} />
                </Field>
              </FilaCampos>

              <FilaCampos columnas={2}>
                <Field label="Gravedad" htmlFor="inc-gravedad">
                  <Select id="inc-gravedad" value={f.gravedad} onChange={(v) => poner({ gravedad: v })} ariaLabel="Gravedad" disabled={soloLectura}
                    options={(Object.keys(GRAVEDADES) as Gravedad[]).map((k) => ({ value: k, label: GRAVEDADES[k].label }))} />
                </Field>
                <Field label="Estado" htmlFor="inc-estado">
                  <Select id="inc-estado" value={f.estado} onChange={(v) => poner({ estado: v })} ariaLabel="Estado" disabled={soloLectura}
                    options={(Object.keys(ESTADOS) as EstadoIncidencia[]).map((k) => ({ value: k, label: ESTADOS[k].label }))} />
                </Field>
              </FilaCampos>
            </fieldset>

            <Field label="Adjuntos" hint={`Capturas o PDF, hasta ${MAX_ADJUNTOS} de 10 MB.`}>
              <div className="space-y-2">
                {(incidencia?.adjuntos || []).map((a) => (
                  <button key={a.id} type="button" onClick={() => incidenciasApi.abrirAdjunto(a.id).catch(() =>
                    toast({ title: 'No se pudo abrir', variant: 'destructive' }))}
                    className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted">
                    <Paperclip size={14} className="text-muted-foreground shrink-0" />
                    <span className="truncate">{a.name}</span>
                  </button>
                ))}
                {ficheros.map((fi, i) => (
                  <div key={`${fi.name}-${i}`} className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm">
                    <Paperclip size={14} className="text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{fi.name}</span>
                    <button type="button" aria-label={`Quitar ${fi.name}`} onClick={() => setFicheros((v) => v.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
                  </div>
                ))}
                {!soloLectura && (
                  <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
                    <Paperclip size={14} /> Añadir adjuntos
                    <input type="file" multiple accept={TIPOS_FICHERO.join(',')} className="sr-only"
                      onChange={(e) => { anadirFicheros(Array.from(e.target.files || [])); e.target.value = ''; }} />
                  </label>
                )}
                {soloLectura && !incidencia?.adjuntos.length && (
                  <p className="text-secundario text-muted-foreground px-1">Sin adjuntos.</p>
                )}
              </div>
            </Field>

            {!soloLectura && (
              <div className="pt-3 border-t border-border flex justify-end gap-2">
                <button type="button" onClick={onCerrar} disabled={guardando}
                  className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted">Cancelar</button>
                <button type="submit" disabled={guardando}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  <FloppyDisk size={14} weight="bold" /> {guardando ? 'Guardando…' : nueva ? 'Apuntar incidencia' : 'Guardar'}
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </Portal>
  );
}
