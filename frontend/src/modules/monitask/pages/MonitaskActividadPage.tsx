import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';
import RangoRapido, { rangoDe } from '@/shared/components/ui/RangoRapido';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { CaretDown, CaretRight, WarningCircle, ArrowsClockwise } from '@phosphor-icons/react';
import {
  monitaskApi, errorDe, horasEscritas,
  type EstadoMonitask, type ActividadPersona, type DiaPersona, type Cotejo, type Personas,
} from '../api/monitask.api';

// La etiqueta «PRUEBAS» (en ISEIE no hay componente compartido para esto).
const EtiquetaEnPruebas = () => <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning-soft text-warning-soft-foreground">PRUEBAS</span>;

/*
  EQUIPO › ACTIVIDAD (#236): qué hace cada colaborador según Monitask.

    Actividad   por persona y periodo: horas, horas activas, % de actividad y
                en qué proyectos; al abrir una persona, día a día con sus tareas.
    Cotejo      por colaborador y mes: horas facturadas · horas en Monitask ·
                diferencia (h y %), en rojo si pasa del margen. Quien no cobra
                por horas sale sin cotejo, solo con su actividad.
    Personas    con quién del CRM es cada usuario de Monitask (por correo, o a
                mano). Solo quien puede configurar Monitask.

  Solo admin y superadmin (el servidor recorta a las empresas de cada uno).
  Sin capturas de pantalla: el CRM no las trae.
*/

type Vista = 'actividad' | 'cotejo' | 'personas';

const mesPasado = () => rangoDe('pasado').from.slice(0, 7);
const pct = (v: number | null) => (v === null || v === undefined ? '—' : `${v.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`);
const fechaCorta = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: 'short' });

export default function MonitaskActividadPage() {
  const { can } = usePermission();
  const puedeConfigurar = can('monitask.configurar');
  const [params, setParams] = useSearchParams();
  const vista = (['actividad', 'cotejo', 'personas'].includes(params.get('vista') || '') ? params.get('vista') : 'actividad') as Vista;
  const [estado, setEstado] = useState<EstadoMonitask | null | 'apagado'>(null);

  useEffect(() => {
    monitaskApi.estado().then((r) => setEstado(r.data || 'apagado')).catch(() => setEstado('apagado'));
  }, []);

  const cambiarVista = (v: Vista) => {
    const qs = new URLSearchParams(params);
    qs.set('vista', v);
    setParams(qs, { replace: true });
  };

  const pestanas: Array<{ clave: Vista; texto: string }> = [
    { clave: 'actividad', texto: 'Actividad' },
    { clave: 'cotejo', texto: 'Cotejo con facturas' },
    ...(puedeConfigurar ? [{ clave: 'personas' as Vista, texto: 'Personas' }] : []),
  ];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title={(<span className="flex items-center gap-2">Actividad del equipo <EtiquetaEnPruebas /></span>) as unknown as string}
        subtitle="Lo que registra Monitask de cada persona —horas, % de actividad, proyectos y tareas— y el cotejo con las horas de sus facturas. Sin capturas de pantalla."
      />

      {estado === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {estado === 'apagado' && (
        <div className="bg-card border border-border rounded-lg p-6 text-sm text-muted-foreground">
          Monitask no está encendido en este servidor (MONITASK_ACTIVO).
        </div>
      )}
      {estado && estado !== 'apagado' && (
        <>
          {!estado.conectada && (
            <div className="bg-warning-soft border border-warning/30 rounded-lg p-4 text-sm text-warning-soft-foreground flex items-start gap-2">
              <WarningCircle size={16} weight="bold" className="mt-0.5 flex-shrink-0" />
              <span>
                Monitask no está conectado: lo que se ve es lo último que se trajo.
                {puedeConfigurar && <> Se conecta en <Link to="/accounting/integrations" className="underline">Integraciones</Link>.</>}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-b border-border">
            {pestanas.map((p) => (
              <button key={p.clave} onClick={() => cambiarVista(p.clave)}
                className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${vista === p.clave ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                {p.texto}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground pb-2">
              Última sincronización: {estado.ultima_sync_at ? new Date(estado.ultima_sync_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'nunca'}
            </span>
          </div>
          {vista === 'actividad' && <VistaActividad />}
          {vista === 'cotejo' && <VistaCotejo mesInicial={params.get('mes') || mesPasado()} />}
          {vista === 'personas' && puedeConfigurar && <VistaPersonas conectada={estado.conectada} />}
        </>
      )}
    </div>
  );
}

// ─── Actividad ──────────────────────────────────────────────────────────────

function VistaActividad() {
  const [rango, setRango] = useState(rangoDe('mes'));
  const [proyecto, setProyecto] = useState('');
  const [persona, setPersona] = useState('');
  const [filas, setFilas] = useState<ActividadPersona[] | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [dias, setDias] = useState<DiaPersona[] | null>(null);

  const cargar = useCallback(async () => {
    if (!rango.from || !rango.to) return;
    setFilas(null);
    try {
      const qs = new URLSearchParams({ desde: rango.from, hasta: rango.to });
      if (proyecto.trim()) qs.set('proyecto', proyecto.trim());
      const r = await monitaskApi.actividad(qs);
      setFilas(r.data || []);
    } catch (e) {
      toast({ title: 'No se pudo cargar la actividad', description: errorDe(e), variant: 'destructive' });
      setFilas([]);
    }
  }, [rango.from, rango.to, proyecto]);

  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  async function abrir(id: number) {
    if (abierta === id) { setAbierta(null); return; }
    setAbierta(id); setDias(null);
    try {
      const r = await monitaskApi.dias(id, new URLSearchParams({ desde: rango.from, hasta: rango.to }));
      setDias(r.data?.dias || []);
    } catch (e) {
      toast({ title: 'No se pudieron cargar los días', description: errorDe(e), variant: 'destructive' });
      setDias([]);
    }
  }

  const visibles = useMemo(() => {
    const q = persona.trim().toLowerCase();
    return (filas || []).filter((f) => !q || [f.nombre, f.correo, f.colaborador_nombre, f.usuario_nombre]
      .some((v) => (v || '').toLowerCase().includes(q)));
  }, [filas, persona]);
  const total = visibles.reduce((s, f) => s + f.horas, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <RangoRapido valor={rango} alElegir={setRango} />
        <label className="text-xs text-muted-foreground">Desde
          <input type="date" value={rango.from} onChange={(e) => setRango({ ...rango, from: e.target.value })}
            className="block h-8 px-2 rounded-md border border-border bg-card text-sm" />
        </label>
        <label className="text-xs text-muted-foreground">Hasta
          <input type="date" value={rango.to} onChange={(e) => setRango({ ...rango, to: e.target.value })}
            className="block h-8 px-2 rounded-md border border-border bg-card text-sm" />
        </label>
        <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Persona"
          className="h-8 px-2 rounded-md border border-border bg-card text-sm w-40" />
        <input value={proyecto} onChange={(e) => setProyecto(e.target.value)} placeholder="Proyecto o web"
          className="h-8 px-2 rounded-md border border-border bg-card text-sm w-44" />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Persona</th>
              <th className="text-right px-3 py-2 font-semibold">Horas</th>
              <th className="text-right px-3 py-2 font-semibold">Activas</th>
              <th className="text-right px-3 py-2 font-semibold">Actividad</th>
              <th className="text-right px-3 py-2 font-semibold">Días</th>
              <th className="text-left px-3 py-2 font-semibold">Proyectos</th>
            </tr>
          </thead>
          <tbody>
            {filas === null && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>}
            {filas !== null && visibles.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nadie con horas en Monitask en estas fechas.</td></tr>
            )}
            {visibles.map((f) => (
              <Fragment key={f.monitask_id}>
                <tr className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => abrir(f.monitask_id)}>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1 font-medium">
                      {abierta === f.monitask_id ? <CaretDown size={12} /> : <CaretRight size={12} />} {f.nombre}
                    </span>
                    <span className="block text-[11px] text-muted-foreground pl-4">
                      {f.colaborador_nombre ? `Colaborador: ${f.colaborador_nombre}` : f.usuario_nombre ? `Usuario: ${f.usuario_nombre}` : 'Sin emparejar'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{horasEscritas(f.horas)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{horasEscritas(f.horas_activas)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(f.actividad_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.dias}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {f.proyectos.slice(0, 4).map((p) => `${p.nombre} (${horasEscritas(p.horas)})`).join(' · ') || '—'}
                  </td>
                </tr>
                {abierta === f.monitask_id && (
                  <tr className="bg-muted/20">
                    <td colSpan={6} className="px-6 py-3">
                      {dias === null ? <p className="text-xs text-muted-foreground">Cargando…</p> : dias.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Sin días con horas.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <tbody>
                            {dias.map((d) => (
                              <tr key={d.dia} className="border-t border-border/60 align-top">
                                <td className="py-1.5 pr-3 whitespace-nowrap capitalize">{fechaCorta(d.dia)}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap font-semibold">{horasEscritas(d.horas)}</td>
                                <td className="py-1.5 pr-3 text-right tabular-nums whitespace-nowrap">{pct(d.actividad_pct)}</td>
                                <td className="py-1.5 text-muted-foreground">
                                  {d.proyectos.map((p) => `${p.nombre} ${horasEscritas(p.horas)}`).join(' · ')}
                                  {d.tareas.length > 0 && (
                                    <span className="block">Tareas: {d.tareas.map((t) => `${t.nombre} (${horasEscritas(t.horas)})`).join(' · ')}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          {visibles.length > 0 && (
            <tfoot className="border-t border-border text-xs">
              <tr>
                <td className="px-3 py-2 font-semibold">Total ({visibles.length})</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{horasEscritas(Math.round(total * 100) / 100)}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Cotejo ─────────────────────────────────────────────────────────────────

function VistaCotejo({ mesInicial }: { mesInicial: string }) {
  const [mes, setMes] = useState(mesInicial);
  const [datos, setDatos] = useState<Cotejo | null>(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    setDatos(null);
    monitaskApi.cotejo(mes).then((r) => setDatos(r.data || null)).catch((e) => {
      toast({ title: 'No se pudo cargar el cotejo', description: errorDe(e), variant: 'destructive' });
    });
  }, [mes]);

  const filas = datos?.filas || [];
  const deMas = filas.filter((f) => datos?.resumen.factura_de_mas.includes(f.colaborador_id));
  const deMenos = filas.filter((f) => datos?.resumen.factura_de_menos.includes(f.colaborador_id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">Mes de la factura
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            className="block h-8 px-2 rounded-md border border-border bg-card text-sm" />
        </label>
        {datos && (
          <p className="text-xs text-muted-foreground pb-1.5">
            En rojo, si la diferencia pasa del <strong>{datos.margen_pct.toLocaleString('es-ES')} %</strong> (se cambia en Integraciones).
            La diferencia se cuenta sobre las horas de Monitask.
          </p>
        )}
      </div>

      {datos && (deMas.length > 0 || deMenos.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-destructive-soft border border-destructive/30 rounded-lg p-3 text-sm text-destructive-soft-foreground">
            <p className="font-semibold mb-1">Facturan más de lo que registra Monitask</p>
            {deMas.length ? deMas.map((f) => <p key={f.colaborador_id}>{f.nombre}: {f.diferencia_horas! > 0 ? '+' : ''}{horasEscritas(f.diferencia_horas)} ({f.diferencia_pct === null ? 'Monitask sin horas' : pct(f.diferencia_pct)})</p>) : <p>Nadie.</p>}
          </div>
          <div className="bg-warning-soft border border-warning/30 rounded-lg p-3 text-sm text-warning-soft-foreground">
            <p className="font-semibold mb-1">Facturan menos de lo que registra Monitask</p>
            {deMenos.length ? deMenos.map((f) => <p key={f.colaborador_id}>{f.nombre}: {horasEscritas(f.diferencia_horas)} ({pct(f.diferencia_pct)})</p>) : <p>Nadie.</p>}
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Colaborador</th>
              <th className="text-right px-3 py-2 font-semibold">Facturadas</th>
              <th className="text-right px-3 py-2 font-semibold">Monitask</th>
              <th className="text-right px-3 py-2 font-semibold">Diferencia</th>
              <th className="text-right px-3 py-2 font-semibold">Actividad</th>
              <th className="text-left px-3 py-2 font-semibold">Facturas</th>
            </tr>
          </thead>
          <tbody>
            {!datos && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>}
            {datos && filas.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Ningún colaborador con factura o con Monitask ese mes.</td></tr>
            )}
            {filas.map((f) => (
              <tr key={f.colaborador_id} className={`border-t border-border ${f.fuera_de_margen ? 'bg-destructive-soft/60' : ''}`}>
                <td className="px-3 py-2">
                  <span className="font-medium">{f.nombre}</span>
                  {!f.con_monitask && <span className="block text-[11px] text-muted-foreground">Sin persona de Monitask emparejada</span>}
                  {f.sin_cotejo && f.con_monitask && <span className="block text-[11px] text-muted-foreground">No factura por horas: solo actividad</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {horasEscritas(f.horas_facturadas)}
                  {f.horas_otras_empresas > 0 && <span className="block text-[11px] text-muted-foreground">{horasEscritas(f.horas_otras_empresas)} a otras empresas</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{horasEscritas(f.horas_monitask)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${f.fuera_de_margen ? 'text-destructive' : ''}`}>
                  {f.sin_cotejo ? '—' : (
                    <>
                      {(f.diferencia_horas ?? 0) > 0 ? '+' : ''}{horasEscritas(f.diferencia_horas)}
                      <span className="block text-[11px] font-normal">
                        {f.diferencia_pct === null ? 'Monitask sin horas' : `${f.diferencia_pct > 0 ? '+' : ''}${pct(f.diferencia_pct)}`}
                      </span>
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(f.actividad_pct)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {f.sin_factura ? 'Sin factura subida' : f.facturas.map((x) => (
                    <span key={x.id} className="block">
                      {x.empresa}: {x.horas === null ? (x.modalidad === 'fijo' ? 'fijo' : 'sin horas') : horasEscritas(x.horas)}
                      {x.pagada ? ' · pagada' : ' · por pagar'}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Personas ───────────────────────────────────────────────────────────────

function VistaPersonas({ conectada }: { conectada: boolean }) {
  const [datos, setDatos] = useState<Personas | null>(null);
  const [guardando, setGuardando] = useState<number | null>(null);

  const cargar = useCallback(() => {
    monitaskApi.personas().then((r) => setDatos(r.data || null)).catch((e) => {
      toast({ title: 'No se pudieron cargar las personas', description: errorDe(e), variant: 'destructive' });
    });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(id: number, valor: string) {
    setGuardando(id);
    try {
      const body = valor === 'ninguno' ? { ninguno: true }
        : valor.startsWith('c:') ? { colaborador_id: Number(valor.slice(2)) }
          : valor.startsWith('u:') ? { user_id: Number(valor.slice(2)) }
            : { colaborador_id: null, user_id: null };
      const r = await monitaskApi.emparejar(id, body);
      setDatos(r.data || null);
      toast({ title: 'Guardado' });
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: errorDe(e), variant: 'destructive' });
    } finally { setGuardando(null); }
  }

  async function sincronizar() {
    try {
      await monitaskApi.sincronizar();
      toast({ title: 'Sincronizando con Monitask', description: 'Vuelve a abrir esta pestaña en un momento.' });
    } catch (e) {
      toast({ title: 'No se pudo sincronizar', description: errorDe(e), variant: 'destructive' });
    }
  }

  if (!datos) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const valorDe = (p: Personas['personas'][number]) => (p.emparejado === 'ninguno' ? 'ninguno'
    : p.colaborador_id ? `c:${p.colaborador_id}` : p.user_id ? `u:${p.user_id}` : '');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground flex-1">
          Cada persona de Monitask se une sola, por el correo, con su ficha de colaborador (o con su usuario del CRM).
          Lo que se cambie aquí a mano no lo vuelve a tocar la sincronización. El cotejo con las facturas necesita la ficha de colaborador.
        </p>
        <button onClick={sincronizar} disabled={!conectada}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50">
          <ArrowsClockwise size={13} weight="bold" /> Sincronizar ahora
        </button>
      </div>
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">En Monitask</th>
              <th className="text-left px-3 py-2 font-semibold">En el CRM</th>
              <th className="text-left px-3 py-2 font-semibold">Cómo</th>
            </tr>
          </thead>
          <tbody>
            {datos.personas.length === 0 && (
              <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">Todavía no se ha traído a nadie de Monitask.</td></tr>
            )}
            {datos.personas.map((p) => (
              <tr key={p.monitask_id} className="border-t border-border">
                <td className="px-3 py-2">
                  <span className="font-medium">{p.nombre}</span>
                  <span className="block text-[11px] text-muted-foreground">{p.correo || 'sin correo'}</span>
                </td>
                <td className="px-3 py-2">
                  <select value={valorDe(p)} disabled={guardando === p.monitask_id} onChange={(e) => cambiar(p.monitask_id, e.target.value)}
                    className="h-8 px-2 rounded-md border border-border bg-card text-sm max-w-xs w-full">
                    <option value="">Sin emparejar</option>
                    <option value="ninguno">No es nadie del CRM</option>
                    <optgroup label="Fichas de colaborador">
                      {datos.colaboradores.map((c) => (
                        <option key={`c${c.id}`} value={`c:${c.id}`}>{c.nombre} · {c.email}{c.activo ? '' : ' (de baja)'}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Usuarios del CRM">
                      {datos.usuarios.map((u) => (
                        <option key={`u${u.id}`} value={`u:${u.id}`}>{u.nombre} · {u.email}</option>
                      ))}
                    </optgroup>
                  </select>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {p.emparejado === 'correo' ? 'Por el correo' : p.emparejado === 'manual' ? `A mano${p.emparejado_por_nombre ? ` (${p.emparejado_por_nombre})` : ''}`
                    : p.emparejado === 'ninguno' ? 'Descartada a mano' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
