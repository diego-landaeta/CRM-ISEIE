import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowClockwise, ArrowCounterClockwise, ClockCounterClockwise, CurrencyEur, FileText, FileZip, LockKey, PaperPlaneTilt, PencilSimple, Plus, Prohibit,
  Receipt, UserMinus, UserPlus, UsersThree,
} from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import {
  AREAS, AREA_ES, ESTADO, FORMA_PAGO_ES, euros, diaDelPago, diaMes, empresaCorta, facturasColaboradorApi, fechaHora, mesEscrito, primeraMayuscula,
  type Area, type Colaborador, type EmpresaDelGrupo, type EstadoFactura, type FacturaDelMes, type Mes,
  urlDelArchivo,
} from '../api/facturasColaborador.api';
import {
  AltaDialog, AnularDialog, BajaDialog, ColaboradorDialog, DeshacerPagoDialog, PagarDialog, RegistroDialog, esMes,
} from '../components/DialogosFacturas';
import ListaDeFacturas, { CostePorCampus } from '../components/ListaDeFacturas';
import EtiquetaDelPdf from '../components/EtiquetaDelPdf';

/**
 * Finanzas › Facturas de colaboradores (#202).
 *
 * «Del mes»: todos los colaboradores del mes, hayan mandado o no, con quién
 * falta y lo recibido frente a lo acordado. «Colaboradores»: la lista que
 * decide a quién le llega el enlace. Las maquetas son las de la «Definición
 * acordada · Diego, 01/10». Enviadas, Por pagar, Pagadas, Historial y el ZIP
 * llegan con la segunda parte.
 *
 * El admin ve lo de las empresas de sus campus; el super admin, todo. Lo
 * decide el servidor: aquí solo se pinta lo que llega.
 *
 * Va por EMPRESA, no por campus (Diego, 10/10). En MultiCRM sigue a la empresa
 * de la cabecera. ISEIE no tiene selector de empresa en la cabecera, y el campus
 * activo siempre está puesto: seguirlo dejaría a cada uno atado a la empresa de
 * su campus. Así que aquí se abre con todas las empresas que ve cada uno (las
 * de sus campus, `projects.sociedad_emisora_id` → `invoice_issuers`; lo decide
 * el servidor) y se elige la empresa en la propia pantalla, en el desplegable
 * «Empresa» de «Del mes» y de las pestañas de facturas.
 *
 * Los tokens de texto de MultiCRM que ISEIE no tiene van escritos enteros
 * (como en BloquePlegable.tsx): `text-tabla` es 11px, seminegrita y espaciada;
 * `text-secundario`, text-xs; `text-seccion`, text-base.
 */

/**
 * La empresa de la cabecera, o null: todas las que ve cada uno. Si algún día
 * ISEIE pone la empresa en la cabecera (`activeIssuerId`, como MultiCRM), se
 * sigue sola. Con el campus no: son por empresa.
 */
function useEmpresaDeLaCabecera(): number | null {
  const { activeIssuerId } = useProjectContext() as { activeIssuerId?: number | null };
  return activeIssuerId ? Number(activeIssuerId) : null;
}

/**
 * El mes que se abre: el último preparado. El último día del mes ya es ese mes
 * (se prepara a las 10:00); los demás días, el anterior. En hora local: con
 * `toISOString` (UTC), de 00:00 a 02:00 en Madrid salía un mes menos.
 */
const mesPorDefecto = () => {
  const hoy = new Date();
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const d = hoy.getDate() === ultimoDia ? hoy : new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const errorDe = (err: any) => err?.data?.error || err?.message || 'Inténtalo de nuevo';

function Pildora({ estado }: { estado: EstadoFactura }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${ESTADO[estado].clase}`}>{ESTADO[estado].rotulo}</span>;
}

export default function FacturasColaboradoresPage() {
  const [params, setParams] = useSearchParams();
  const [empresas, setEmpresas] = useState<EmpresaDelGrupo[]>([]);
  // Lo decide el servidor (403); aquí solo se evita enseñar una pantalla vacía
  // como si no hubiera facturas a quien no tiene permiso para verlas.
  const { can } = usePermission();
  const veElMes = can('facturas_colaborador.ver_todas');
  const gestiona = can('facturas_colaborador.gestionar');
  // «Del mes · Enviadas · Por pagar · Pagadas · Historial» (segunda parte) y la lista de colaboradores.
  const DE_FACTURAS = ['enviadas', 'por_pagar', 'pagadas', 'historial'] as const;
  type Vista = 'mes' | 'colaboradores' | typeof DE_FACTURAS[number];
  const enLaDireccion = params.get('vista');
  const pedida: Vista = enLaDireccion === 'colaboradores' || (DE_FACTURAS as readonly string[]).includes(enLaDireccion ?? '')
    ? enLaDireccion as Vista : 'mes';
  const vista: Vista = pedida !== 'colaboradores' && !veElMes ? 'colaboradores' : pedida === 'colaboradores' && !gestiona ? 'mes' : pedida;
  const empresa = useEmpresaDeLaCabecera();

  useEffect(() => {
    if (!veElMes && !gestiona) return;
    facturasColaboradorApi.empresas().then((r) => setEmpresas(r.data)).catch(() => setEmpresas([]));
  }, [veElMes, gestiona]);

  const cambiar = (v: Vista) => {
    const n = new URLSearchParams(params);
    if (v === 'mes') n.delete('vista'); else n.set('vista', v);
    setParams(n, { replace: true });
  };

  const cabecera = <PageHeader title="Facturas de colaboradores" subtitle="Quien factura al grupo cada mes sube su factura por un enlace personal, una por empresa y mes" />;
  if (!veElMes && !gestiona) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        {cabecera}
        <div className="bg-card border border-border rounded-lg">
          <EmptyState icon={LockKey} title="No tienes acceso a las facturas de colaboradores"
            description="Las ve administración. Si crees que deberías verlas, pídelo a un administrador." />
        </div>
      </div>
    );
  }

  const pestanas = ([
    ['mes', 'Del mes', veElMes], ['enviadas', 'Enviadas', veElMes], ['por_pagar', 'Por pagar', veElMes],
    ['pagadas', 'Pagadas', veElMes], ['historial', 'Historial', veElMes], ['colaboradores', 'Colaboradores', gestiona],
  ] as const).filter(([, , puede]) => puede);

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {cabecera}
      <div className="flex flex-wrap items-center gap-1">
        {pestanas.map(([clave, rotulo]) => (
          <button key={clave} type="button" aria-pressed={vista === clave} onClick={() => cambiar(clave)}
            className={`h-8 px-3 rounded-md border text-xs font-medium transition-colors ${
              vista === clave ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted/60'
            }`}>
            {rotulo}
          </button>
        ))}
      </div>
      {vista === 'mes' ? <DelMes empresas={empresas} empresa={empresa} />
        : vista === 'colaboradores' ? <Colaboradores empresas={empresas} empresa={empresa} />
          : <ListaDeFacturas key={vista} vista={vista} empresas={empresas} empresa={empresa} />}
    </div>
  );
}

/* ─────────────────────────── Del mes ─────────────────────────── */

function DelMes({ empresas, empresa }: { empresas: EmpresaDelGrupo[]; empresa: number | null }) {
  const [params, setParams] = useSearchParams();
  const periodo = params.get('periodo') || mesPorDefecto();
  // Con una empresa en la cabecera, esa: el desplegable no le lleva la contraria.
  const [elegida, setIssuerId] = useState('');
  const issuerId = empresa ? String(empresa) : elegida;
  const [estado, setEstado] = useState<'' | EstadoFactura>('');
  const [area, setArea] = useState<'' | Area>('');
  const [datos, setDatos] = useState<Mes | null>(null);
  const [cargando, setCargando] = useState(true);
  const [anular, setAnular] = useState<FacturaDelMes | null>(null);
  const [registro, setRegistro] = useState<FacturaDelMes | null>(null);
  const [pagar, setPagar] = useState<FacturaDelMes | null>(null);
  const [deshacer, setDeshacer] = useState<FacturaDelMes | null>(null);
  const { can } = usePermission();
  const puedeAnular = can('facturas_colaborador.anular');
  // «Marcar pagada»: solo un admin (segunda parte).
  const puedePagar = can('facturas_colaborador.pagar');
  const puedeReenviar = can('facturas_colaborador.gestionar');
  // La fila que se está reenviando: un segundo clic mandaba otro correo y el
  // enlace del primero ya no valía.
  const [reenviando, setReenviando] = useState<number | null>(null);

  // Cuántas veces se ha cargado el mes: el coste por campus se vuelve a pedir con cada una.
  const [vueltas, setVueltas] = useState(0);
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await facturasColaboradorApi.mes({
        periodo, issuerId: issuerId ? Number(issuerId) : undefined, estado: estado || undefined, area: area || undefined,
      });
      setDatos(r.data);
      setVueltas((v) => v + 1);
    } catch (err) {
      toast({ title: 'No se pudo cargar el mes', description: errorDe(err), variant: 'destructive' });
    } finally { setCargando(false); }
  }, [periodo, issuerId, estado, area]);

  useEffect(() => { void cargar(); }, [cargar]);

  const ponerPeriodo = (v: string) => {
    const n = new URLSearchParams(params);
    n.set('periodo', v);
    setParams(n, { replace: true });
  };

  async function verArchivo(f: FacturaDelMes) {
    try {
      const r = await facturasColaboradorApi.archivo(f.id);
      window.open(urlDelArchivo(r.data.url), '_blank', 'noopener');
    } catch (err) {
      toast({ title: 'No se pudo abrir el archivo', description: errorDe(err), variant: 'destructive' });
    }
  }

  // El ZIP del mes es de una empresa («facturas-colaboradores_2026-09_CEDIA.zip»).
  const [bajando, setBajando] = useState(false);
  async function bajarZip() {
    // Con una empresa en la cabecera, el ZIP es de esa (y el botón ya está activo).
    const deLaEmpresa = empresas.find((e) => String(e.id) === issuerId);
    if (!deLaEmpresa || bajando) return;
    setBajando(true);
    try {
      await facturasColaboradorApi.bajarZip(periodo, deLaEmpresa.id, deLaEmpresa.razon_social);
    } catch (err) {
      toast({ title: 'No se pudo descargar el ZIP', description: errorDe(err), variant: 'destructive' });
    } finally { setBajando(false); }
  }

  async function verJustificante(f: FacturaDelMes) {
    try {
      const r = await facturasColaboradorApi.justificante(f.id);
      window.open(urlDelArchivo(r.data.url), '_blank', 'noopener');
    } catch (err) {
      toast({ title: 'No se pudo abrir el justificante', description: errorDe(err), variant: 'destructive' });
    }
  }

  async function reenviar(f: FacturaDelMes) {
    if (reenviando) return;
    setReenviando(f.id);
    try {
      await facturasColaboradorApi.reenviar(f.id);
      toast({ title: 'Enlace nuevo', description: `Para ${f.colaborador_nombre}. El anterior deja de valer.` });
      void cargar();
    } catch (err) {
      toast({ title: 'No se pudo reenviar', description: errorDe(err), variant: 'destructive' });
    } finally {
      setReenviando(null);
    }
  }

  const cargarRegistro = useCallback(
    () => facturasColaboradorApi.registroDeLaFactura(registro!.id).then((r) => r.data),
    [registro],
  );
  const cargarDesglose = useCallback(
    () => facturasColaboradorApi.desgloseDeLaFactura(registro!.id).then((r) => r.data),
    [registro],
  );

  const r = datos?.resumen;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48 flex-none">
          <input type="month" aria-label="Mes" value={periodo} onChange={(e) => esMes(e.target.value) && ponerPeriodo(e.target.value)} className={inputClass} />
        </div>
        {!empresa && (
          <div className="w-52 flex-none">
            <Select<string> value={issuerId} onChange={setIssuerId} ariaLabel="Empresa"
              options={[{ value: '', label: 'Todas las empresas' }, ...empresas.map((e) => ({ value: String(e.id), label: e.razon_social }))]} />
          </div>
        )}
        <div className="w-44 flex-none">
          <Select<'' | Area> value={area} onChange={setArea} ariaLabel="Área"
            options={[{ value: '', label: 'Todas las áreas' }, ...AREAS.map((a) => ({ value: a, label: AREA_ES[a] }))]} />
        </div>
        <div className="w-44 flex-none">
          <Select<'' | EstadoFactura> value={estado} onChange={setEstado} ariaLabel="Estado"
            options={[{ value: '', label: 'Todos los estados' }, ...(Object.keys(ESTADO) as EstadoFactura[]).map((e) => ({ value: e, label: ESTADO[e].rotulo }))]} />
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={bajarZip} disabled={!issuerId || bajando}
          aria-label="Descargar el ZIP del mes"
          title={issuerId ? 'Descargar el ZIP: las facturas recibidas del mes y un Excel con el resumen, para la gestoría' : 'Elige una empresa: el ZIP es de una empresa y un mes'}>
          <FileZip size={13} className="mr-1.5" /> {bajando ? 'Preparando…' : 'ZIP'}
        </Button>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
          <ArrowClockwise size={13} weight="bold" className="mr-1.5" /> {cargando ? 'Cargando…' : 'Actualizar'}
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {datos && r && (
          <div className="px-4 py-2.5 border-b border-border text-sm">
            <strong>{primeraMayuscula(datos.mes.replace(' de ', ' '))}</strong>
            <span className="text-muted-foreground"> · {r.recibidas} de {r.total} recibidas · {r.por_moneda
              // Cada moneda por su lado (247): «356,03 US$ de 0,00 US$ acordados y 600,00 € de 600,00 € acordados».
              ? r.por_moneda.map((s) => `${euros(s.importe_recibido, s.moneda)} de ${euros(s.importe_acordado, s.moneda)} acordados`).join(' y ')
              : `${euros(r.importe_recibido)} de ${euros(r.importe_acordado)} acordados`}</span>
          </div>
        )}
        {!datos || datos.facturas.length === 0 ? (
          // Con un filtro de área o de estado, lo que no hay es eso, no el mes entero.
          (estado || area) ? (
            <EmptyState icon={FileText} title={cargando ? 'Cargando…' : 'No hay facturas con estos filtros'}
              description={cargando ? undefined : 'Prueba con otra área u otro estado.'} />
          ) : (
            <EmptyState icon={FileText} title={cargando ? 'Cargando…' : 'Nada en este mes'}
              description="El último día del mes, a las 10:00, se prepara el mes con los colaboradores activos." />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] leading-4 font-semibold tracking-[0.06em]">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">Colaborador</th><th className="px-2 py-2">Área</th><th className="px-2 py-2">Empresa</th>
                  <th className="px-2 py-2 text-right">Acordado</th><th className="px-2 py-2">Correo</th><th className="px-2 py-2">Enlace</th><th className="px-2 py-2">Factura</th>
                  <th className="px-2 py-2 text-right">Importe</th><th className="px-2 py-2 text-right">Diferencia</th><th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {datos.facturas.map((f) => (
                  <tr key={f.id} className={f.estado === 'anulada' ? 'opacity-60' : ''}>
                    <td className="px-2 py-2 font-medium">{f.colaborador_nombre}</td>
                    <td className="px-2 py-2">{AREA_ES[f.area]}</td>
                    <td className="px-2 py-2 whitespace-nowrap" title={f.empresa}>{empresaCorta(f.empresa)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{euros(f.importe_esperado, f.moneda)}</td>
                    <td className="px-2 py-2 text-xs text-muted-foreground"><div className="max-w-[6.5rem] truncate" title={f.email}>{f.email}</div></td>
                    <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {f.abierto_at ? <>Abierto<br />{diaMes(f.abierto_at)}</> : f.enviado_at ? <>Enviado<br />{diaMes(f.enviado_at)}</> : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <Pildora estado={f.estado} />
                      {/* El PDF dice otra cifra que la escrita, o no se pudo leer (13/10): se dejó enviar y queda marcada. */}
                      <EtiquetaDelPdf f={f} />
                      {f.numero_recepcion && (
                        <div className="text-xs text-muted-foreground mt-0.5 whitespace-nowrap">{f.numero_recepcion}<br />{fechaHora(f.subida_at)}</div>
                      )}
                      {f.motivo_anulacion && <div className="text-xs text-muted-foreground mt-0.5">«{f.motivo_anulacion}»</div>}
                      {/* El pago, que no se mezcla con el estado de la factura (segunda parte). */}
                      {f.pagada_at && (
                        <div className="mt-0.5">
                          <span title={`${f.forma_pago ? FORMA_PAGO_ES[f.forma_pago] : 'Pago'}${f.referencia_pago ? ` · ref. ${f.referencia_pago}` : ''}`}
                            className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap bg-success-soft text-success-soft-foreground">
                            Pagada {diaDelPago(f.pagada_at)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{euros(f.importe, f.moneda)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${f.diferencia && Number(f.diferencia) !== 0 ? 'text-warning-soft-foreground font-semibold' : ''}`}>
                      {f.diferencia === null ? '—' : euros(f.diferencia, f.moneda)}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-0.5">
                        {f.nombre_original && (
                          <Button variant="ghost" size="sm" className="px-2" title="Ver el archivo" aria-label="Ver el archivo" onClick={() => verArchivo(f)}><FileText size={15} /></Button>
                        )}
                        <Button variant="ghost" size="sm" className="px-2" title="Ver el registro" aria-label="Ver el registro" onClick={() => setRegistro(f)}><ClockCounterClockwise size={15} /></Button>
                        {puedeReenviar && !f.subida_at && !f.anulada_at && (
                          <Button variant="ghost" size="sm" className="px-2" title="Reenviar el enlace" aria-label="Reenviar el enlace"
                            disabled={reenviando !== null} onClick={() => reenviar(f)}><PaperPlaneTilt size={15} /></Button>
                        )}
                        {puedePagar && f.subida_at && !f.anulada_at && !f.pagada_at && (
                          <Button variant="ghost" size="sm" className="px-2" title="Marcar pagada" aria-label="Marcar pagada" onClick={() => setPagar(f)}><CurrencyEur size={15} /></Button>
                        )}
                        {f.pagada_at && f.con_justificante && (
                          <Button variant="ghost" size="sm" className="px-2" title="Ver el justificante" aria-label="Ver el justificante" onClick={() => verJustificante(f)}><Receipt size={15} /></Button>
                        )}
                        {puedePagar && f.pagada_at && (
                          <Button variant="ghost" size="sm" className="px-2" title="Deshacer el pago" aria-label="Deshacer el pago" onClick={() => setDeshacer(f)}><ArrowCounterClockwise size={15} /></Button>
                        )}
                        {puedeAnular && !f.anulada_at && !f.pagada_at && (
                          <Button variant="ghost" size="sm" className="px-2" title="Anular" aria-label="Anular" onClick={() => setAnular(f)}><Prohibit size={15} /></Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Con la lista del mes: al anular, pagar o «Actualizar», el coste se vuelve a pedir
          (antes se quedaba con las cifras viejas, también las de una factura ya anulada). */}
      <CostePorCampus periodo={periodo} issuerId={issuerId} recargar={vueltas} />

      {anular && (
        <AnularDialog facturaId={anular.id} quien={`${anular.colaborador_nombre} · ${anular.empresa}`}
          alCerrar={() => setAnular(null)} alGuardar={() => { setAnular(null); void cargar(); }} />
      )}
      {pagar && (
        <PagarDialog facturas={[{ id: pagar.id, quien: `${pagar.colaborador_nombre} · ${empresaCorta(pagar.empresa)}`, importe: pagar.importe, moneda: pagar.moneda }]}
          alCerrar={() => setPagar(null)} alGuardar={() => { setPagar(null); void cargar(); }} />
      )}
      {deshacer && (
        <DeshacerPagoDialog facturaId={deshacer.id} quien={`${deshacer.colaborador_nombre} · ${empresaCorta(deshacer.empresa)}`}
          alCerrar={() => setDeshacer(null)} alGuardar={() => { setDeshacer(null); void cargar(); }} />
      )}
      {registro && (
        <RegistroDialog titulo={`Registro · ${registro.colaborador_nombre} · ${registro.empresa}`}
          cargar={cargarRegistro} alCerrar={() => setRegistro(null)}
          // Recibida: arriba del registro, el PDF frente a lo escrito y, si lo hay, el desglose.
          cargarDesglose={registro.subida_at ? cargarDesglose : undefined} />
      )}
    </div>
  );
}

/* ─────────────────────────── Colaboradores ─────────────────────────── */

function Colaboradores({ empresas, empresa }: { empresas: EmpresaDelGrupo[]; empresa: number | null }) {
  const [estado, setEstado] = useState<'activos' | 'de_baja' | 'todos'>('activos');
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<Colaborador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<Colaborador | 'nuevo' | null>(null);
  const [baja, setBaja] = useState<Colaborador | null>(null);
  const [vuelve, setVuelve] = useState<Colaborador | null>(null);
  const [historial, setHistorial] = useState<Colaborador | null>(null);
  // ISEIE: sin empresa en la cabecera, se elige aquí, como en «Del mes» (son por empresa).
  const [elegida, setElegida] = useState('');
  const issuerId = empresa ?? (elegida ? Number(elegida) : null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // Con una empresa (la de la cabecera o la elegida), solo quienes le facturan.
      const r = await facturasColaboradorApi.colaboradores({ estado, q: q.trim() || undefined, issuerId: issuerId ?? undefined });
      setLista(r.data);
    } catch (err) {
      toast({ title: 'No se pudo cargar la lista', description: errorDe(err), variant: 'destructive' });
    } finally { setCargando(false); }
  }, [estado, q, issuerId]);

  useEffect(() => {
    const t = setTimeout(() => { void cargar(); }, 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const cargarHistorial = useCallback(
    () => facturasColaboradorApi.registroDelColaborador(historial!.id).then((r) => r.data),
    [historial],
  );

  const acordado = useMemo(() => (c: Colaborador) => c.empresas
    .map((e) => (e.importe_acordado === null ? '—' : `${euros(e.importe_acordado, e.moneda)}/mes`)).join(' · '), []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-64 flex-none">
          <input autoComplete="off" aria-label="Buscar por nombre o correo" placeholder="Buscar por nombre o correo" value={q}
            onChange={(e) => setQ(e.target.value)} className={inputClass} />
        </div>
        {!empresa && empresas.length > 1 && (
          <div className="w-52 flex-none">
            <Select<string> value={elegida} onChange={setElegida} ariaLabel="Empresa"
              options={[{ value: '', label: 'Todas las empresas' }, ...empresas.map((e) => ({ value: String(e.id), label: e.razon_social }))]} />
          </div>
        )}
        <div className="w-40 flex-none">
          <Select<'activos' | 'de_baja' | 'todos'> value={estado} onChange={setEstado} ariaLabel="Estado"
            options={[{ value: 'activos', label: 'Activos' }, { value: 'de_baja', label: 'De baja' }, { value: 'todos', label: 'Todos' }]} />
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setEditando('nuevo')}>
          <Plus size={13} weight="bold" className="mr-1.5" /> Añadir colaborador
        </Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {lista.length === 0 ? (
          // Si se está buscando o se miran los de baja, no es que no haya ninguno.
          (q.trim() || estado !== 'activos') ? (
            <EmptyState icon={UsersThree}
              title={cargando ? 'Cargando…' : q.trim() ? 'Nadie coincide con la búsqueda' : estado === 'de_baja' ? 'No hay colaboradores de baja' : 'Todavía no hay colaboradores'}
              description={undefined} />
          ) : (
            <EmptyState icon={UsersThree} title={cargando ? 'Cargando…' : 'Todavía no hay colaboradores'}
              description="Da de alta a quien factura al grupo cada mes: soporte, desarrollo, WordPress, SEO, contenido…" />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] leading-4 font-semibold tracking-[0.06em]">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Área</th><th className="px-3 py-2">Empresas</th>
                  <th className="px-3 py-2">Acordado</th><th className="px-3 py-2">Correo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lista.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 font-medium">
                      {c.nombre}
                      {c.usuario_nombre && <div className="text-xs font-normal text-muted-foreground">Usuario: {c.usuario_nombre}</div>}
                      {c.compartido && <div className="text-xs font-normal text-muted-foreground">También factura a otras empresas</div>}
                    </td>
                    <td className="px-3 py-2">{AREA_ES[c.area]}</td>
                    <td className="px-3 py-2 whitespace-nowrap" title={c.empresas.map((e) => e.razon_social).join(' · ')}>
                      {c.empresas.map((e) => empresaCorta(e.razon_social)).join(' · ')}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{acordado(c)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground"><div className="max-w-[14rem] truncate" title={c.email}>{c.email}</div></td>
                    <td className="px-3 py-2">
                      {/* Una baja de un mes que no ha llegado: sigue activo hasta entonces. */}
                      {c.activo && !c.baja_desde && <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-success-soft text-success-soft-foreground">Activo</span>}
                      {c.activo && c.baja_desde && <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-warning-soft text-warning-soft-foreground whitespace-nowrap">Activo · baja desde {mesEscrito(c.baja_desde)}</span>}
                      {!c.activo && <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-destructive-soft text-destructive-soft-foreground whitespace-nowrap">Baja desde {mesEscrito(c.baja_desde)}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {/* Iconos, como en «Del mes»: con la columna Correo, los botones con texto no cabían en un portátil. */}
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" title="Editar" aria-label="Editar" onClick={() => setEditando(c)}><PencilSimple size={15} /></Button>
                        <Button variant="ghost" size="sm" title="Historial" aria-label="Historial" onClick={() => setHistorial(c)}><ClockCounterClockwise size={15} /></Button>
                        {!c.compartido && (c.baja_desde
                          ? <Button variant="ghost" size="sm" title="Volver a dar de alta" aria-label="Volver a dar de alta" onClick={() => setVuelve(c)}><UserPlus size={15} /></Button>
                          : <Button variant="ghost" size="sm" title="Dar de baja" aria-label="Dar de baja" onClick={() => setBaja(c)}><UserMinus size={15} /></Button>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editando && (
        <ColaboradorDialog colaborador={editando === 'nuevo' ? null : editando} empresas={empresas}
          alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); void cargar(); }} />
      )}
      {baja && <BajaDialog colaborador={baja} alCerrar={() => setBaja(null)} alGuardar={() => { setBaja(null); void cargar(); }} />}
      {vuelve && <AltaDialog colaborador={vuelve} alCerrar={() => setVuelve(null)} alGuardar={() => { setVuelve(null); void cargar(); }} />}
      {historial && <RegistroDialog titulo={`Historial · ${historial.nombre}`} cargar={cargarHistorial} empresas={empresas} alCerrar={() => setHistorial(null)} />}
    </div>
  );
}
