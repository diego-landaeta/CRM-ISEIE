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
import { X, MagnifyingGlass,
  DownloadSimple,
  ArrowCounterClockwise, CalendarBlank, User, Buildings, WarningCircle,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useProyectosDelAmbito } from '@/shared/hooks/useAmbito';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { copyToClipboard } from '@/shared/lib/clipboard';
import BulkActionBar from '@/modules/leads/components/BulkActionBar';
import {
  traerSeguimiento, traerResumenSeguimiento,
  type EnSeguimiento, type ResumenSeguimiento, type PasoEnCola, type FormacionDeLaLista,
} from '../api/agenda.api';
import PanelDeCola from '../components/PanelDeCola';
import AccionesDeFila from '../components/AccionesDeFila';
import DescartarDelRepaso from '../components/DescartarDelRepaso';
import WasapiExportDialog from '@/modules/leads/components/WasapiExportDialog';
import StatusBadge, { STATUS_LABELS } from '@/shared/components/ui/StatusBadge';
import { whatsappApi, type PlantillaWhatsapp } from '@/modules/whatsapp/api/whatsapp.api';
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

/**
 * Los estados que puede tener alguien del repaso.
 *
 * Los convertidos y los no interesados no entran nunca --la base los excluye--
 * asi que ofrecer esos dos en el filtro seria ofrecer dos listas vacias.
 */
const ESTADOS_DEL_REPASO = ['nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'proxima_convocatoria'];

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
  /**
   * A quién se ha marcado para hacer algo con todos a la vez.
   *
   * El repaso de fin de mes se manda en bloque —Diego, 23/09: «suele ser
   * masivo»—: se eligen cuarenta, se copian sus teléfonos, se manda la difusión
   * y se apunta el contacto de los cuarenta de una vez. Uno a uno no lo hace
   * nadie, y entonces la lista se queda mintiendo.
   */
  const [marcados, setMarcados] = useState<number[]>([]);
  const [enBloque, setEnBloque] = useState(false);

  const elegido = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;
  const idsEmpresa = useMemo(
    () => (activeIssuer && !elegido ? campus.map((c) => c.id) : []),
    [activeIssuer, elegido, campus],
  );
  const projectIds = idsEmpresa.length ? idsEmpresa.join(',') : null;
  const mezcla = !elegido;

  /**
   * Los filtros, y la pagina.
   *
   * Diego, 23/09: «aun faltan los filtros aqui y la paginacion». Van AL
   * SERVIDOR, no sobre lo ya cargado: la base son miles y la pantalla solo
   * tenia las primeras 500, asi que buscar a alguien de la pagina cuatro habria
   * dicho «no hay ninguna» cuando si la hay.
   */
  const [busca, setBusca] = useState('');
  const [buscaLenta, setBuscaLenta] = useState('');
  const [producto, setProducto] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);

  // Se espera a que deje de escribir: una consulta por tecla sobre una tabla de
  // miles no la aguanta nadie.
  useEffect(() => {
    const id = setTimeout(() => setBuscaLenta(busca.trim()), 350);
    return () => clearTimeout(id);
  }, [busca]);

  // Cualquier filtro nuevo vuelve a la primera pagina. Quedarse en la siete
  // despues de filtrar enseña una lista vacia que parece que no hay nada.
  useEffect(() => {
    setPagina(1);
  }, [buscaLenta, producto, estado, bloque, soloSinContactar, elegido, projectIds]);

  /** Las formaciones del ámbito, para el filtro. */
  // 28/09: ya no se pide el catalogo. Las formaciones las manda el servidor
  // CON la lista: solo las que tiene su gente, juntadas por nombre y con
  // TODOS sus ids --la misma formacion en varios campus son varios ids--.
  const [productos, setProductos] = useState<FormacionDeLaLista[]>([]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      traerSeguimiento({
        projectId: elegido, projectIds,
        busca: buscaLenta || null,
        productoIds: producto || null,
        antiguedad: bloque,
        sinContactar: soloSinContactar ? '1' : null,
        estado: estado || null,
        pagina,
        limite: 50,
      }),
      traerResumenSeguimiento({ projectId: elegido, projectIds }),
    ]).then(([b, r]) => {
      if (!vivo) return;
      setBase(b.filas);
      setProductos(b.formaciones);
      if (producto && !b.formaciones.some((f) => f.ids.join(',') === producto)) setProducto('');
      setTotal(b.total);
      setTotalPaginas(b.totalPaginas);
      setResumen(r);
      setMarcados([]);
    }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [elegido, projectIds, buscaLenta, producto, estado, bloque, soloSinContactar, pagina]);

  // Ya viene filtrado del servidor: aqui no se vuelve a filtrar, o el recuento
  // de arriba y la lista dirian cosas distintas.
  const visibles = base;

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

  const alternarMarca = (id: number) => setMarcados((p) =>
    p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  /**
   * Las plantillas del ámbito, para los botones rápidos de cada fila.
   *
   * Se piden una vez y no por fila: son las mismas para todos y pedirlas
   * cuatrocientas veces tumbaría la pantalla. Si este CRM no lleva WhatsApp
   * instalado el endpoint no existe, y entonces no hay mensaje que poner: el
   * botón abre el chat vacío, que sigue valiendo.
   */
  const [plantillas, setPlantillas] = useState<PlantillaWhatsapp[]>([]);
  useEffect(() => {
    let vivo = true;
    whatsappApi.plantillas(elegido, activeIssuer?.id ?? null)
      .then((r) => { if (vivo) setPlantillas(r?.success ? (r.data || []) : []); })
      .catch(() => { if (vivo) setPlantillas([]); });
    return () => { vivo = false; };
  }, [elegido, activeIssuer?.id]);

  /**
   * Ha atendido a alguien desde su fila: se apunta y sale de la lista.
   *
   * Sale en cuanto se apunta, sin esperar a recargar: el repaso se hace de
   * arriba abajo y ver desaparecer la fila es lo que dice que ya está. Si el
   * guardado falla se vuelve a poner, porque entonces NO está hecho.
   */
  async function atenderDesdeLaFila(p: EnSeguimiento, tipo: 'whatsapp' | 'email') {
    try {
      await client.post(`/leads/${p.lead_id}/interactions`, {
        tipo,
        nota: 'Seguimiento de fin de mes',
        fecha: new Date().toISOString(),
      });
      setBase((b) => b.filter((x) => x.lead_id !== p.lead_id));
      traerResumenSeguimiento({ projectId: elegido, projectIds })
        .then((r) => { if (r) setResumen(r); }).catch(() => {});
    } catch (e) {
      // El chat se ha abierto igual, asi que lo unico que se puede hacer es
      // decir que NO ha quedado apuntado. Callarlo es lo peor: la gestora
      // habla con la persona convencida de que consta.
      toast({
        title: 'El contacto no ha quedado apuntado',
        description: 'Se ha abierto igual, pero apúntalo a mano: '
          + ((e as Error)?.message || 'no se pudo guardar'),
        variant: 'destructive',
      });
      throw e;
    }
  }

  /**
   * La descarga para Wasapi, con las mismas condiciones que en Prospectos.
   *
   * Diego, 23/09: «el descargar para Wasapi debe tener las mismas condiciones
   * como si fueran de prospectos». Es el MISMO diálogo, apuntando al endpoint
   * del repaso. Uno parecido pero aparte habría acabado con dos juegos de
   * condiciones y un fichero que sale distinto según por dónde lo pidas.
   *
   * Lo que ya está filtrado en la pantalla viaja en `paramsBase` y no se puede
   * tocar desde el diálogo: sería raro filtrar por una formación aquí y por
   * otra ahí. Lo que se elige en el diálogo es lo del envío —país, a quién
   * excluir, con teléfono o no, y el formato—.
   */
  const [wasapiAbierto, setWasapiAbierto] = useState(false);

  const paramsDeLaDescarga = useMemo(() => {
    const p: Record<string, string> = {};
    if (elegido) p.projectId = String(elegido);
    if (projectIds) p.projectIds = projectIds;
    if (buscaLenta) p.busca = buscaLenta;
    if (producto) p.productoIds = producto;
    if (estado) p.estado = estado;
    if (bloque) p.antiguedad = bloque;
    if (soloSinContactar) p.sinContactar = '1';
    return p;
  }, [elegido, projectIds, buscaLenta, producto, estado, bloque, soloSinContactar]);

  /** Lo que ya lleva puesto, en una línea, para decirlo en el diálogo. */
  const resumenDeFiltros = useMemo(() => {
    const trozos: string[] = [];
    if (buscaLenta) trozos.push(`búsqueda «${buscaLenta}»`);
    if (producto) trozos.push(productos.find((x) => String(x.id) === producto)?.nombre || 'una formación');
    if (estado) trozos.push(`en «${STATUS_LABELS[estado] || estado}»`);
    if (bloque) trozos.push(({
      este_mes: 'entrados este mes', uno_a_tres: 'de uno a tres meses',
      tres_a_seis: 'de tres a seis meses', mas_de_seis: 'de más de seis meses',
    } as Record<string, string>)[bloque] || bloque);
    if (soloSinContactar) trozos.push('sin contactar nunca');
    if (!trozos.length) return `los ${total} del repaso`;
    return `${total} · ${trozos.join(' · ')}`;
  }, [buscaLenta, producto, productos, estado, bloque, soloSinContactar, total]);

  /**
   * Descartar el seguimiento de alguien: se marca como no interesado.
   *
   * Diego, 23/09: «descartar este seguimiento, y cuando se descarta se irá a la
   * parte de por qué desistió».
   *
   * Pasarlo a `no_interesado` hace las dos cosas de una vez: lo saca del repaso
   * --la base excluye ese estado-- y lo mete en el grupo al que va dirigido el
   * correo de «¿por qué desististe?» (#169), que sale justo a quien no compró y
   * no está interesado. No es tirar a alguien: es dejar de perseguirlo y pasar a
   * preguntarle por qué no.
   *
   * El motivo viaja al servidor, que lo exige. Es lo que el panel de feedback
   * (#170) va a leer: una base de bajas sin motivo no se puede analizar.
   */
  async function descartarDelRepaso(p: EnSeguimiento, motivo: string) {
    try {
      await client.patch(`/leads/${p.lead_id}/status`, {
        status: 'no_interesado',
        motivo: `Descartado del repaso de fin de mes · ${motivo}`,
      });
      setBase((b) => b.filter((x) => x.lead_id !== p.lead_id));
      setMarcados((m) => m.filter((x) => x !== p.lead_id));
      traerResumenSeguimiento({ projectId: elegido, projectIds })
        .then((r) => { if (r) setResumen(r); }).catch(() => {});
      toast({
        title: 'Descartado del repaso',
        description: `${p.lead_nombre || 'Sin nombre'} pasa a no interesado. Entra en el grupo del correo de «por qué desististe».`,
      });
    } catch (e) {
      toast({
        title: 'No se ha podido descartar',
        description: (e as Error)?.message || 'Inténtalo otra vez',
        variant: 'destructive',
      });
    }
  }

  const todosMarcados = visibles.length > 0 && marcados.length === visibles.length;
  const alternarTodos = () => setMarcados(todosMarcados ? [] : visibles.map((x) => x.lead_id));

  /**
   * Apunta el contacto a TODOS los marcados.
   *
   * Se va uno a uno contra el servidor y no en una sola llamada: no hay
   * endpoint de interacciones en bloque y añadirlo por esto seria inventarse
   * media API. Se cuenta lo que sale bien y lo que no, porque con cuarenta
   * personas un «hecho» a secas no se puede comprobar a ojo.
   */
  async function marcarContactados() {
    if (!marcados.length) return;
    setEnBloque(true);
    let bien = 0;
    let mal = 0;
    for (const id of marcados) {
      try {
        await client.post(`/leads/${id}/interactions`, {
          tipo: 'whatsapp',
          nota: 'Seguimiento de fin de mes (envío en bloque)',
          fecha: new Date().toISOString(),
        });
        bien += 1;
      } catch { mal += 1; }
    }
    setBase((b) => b.filter((x) => !marcados.includes(x.lead_id) || mal > 0));
    setMarcados([]);
    setEnBloque(false);
    toast(mal === 0
      ? { title: `${bien} contactos apuntados`, description: 'Salen del repaso hasta dentro de un mes.' }
      : {
        title: `${bien} apuntados, ${mal} no`,
        description: 'Los que fallaron siguen en la lista. Vuelve a intentarlo con esos.',
        variant: 'destructive',
      });
    traerResumenSeguimiento({ projectId: elegido, projectIds })
      .then((r) => { if (r) setResumen(r); }).catch(() => {});
  }

  /** Los teléfonos o los correos de los marcados, para pegarlos en la difusión. */
  async function copiarContactos(que: 'telefono' | 'email') {
    const elegidos = visibles.filter((x) => marcados.includes(x.lead_id));
    const datos = elegidos
      .map((x) => (que === 'telefono' ? x.lead_telefono : x.lead_email))
      .filter(Boolean) as string[];
    if (!datos.length) {
      toast({
        title: que === 'telefono' ? 'Ninguno tiene teléfono' : 'Ninguno tiene correo',
        description: 'Prueba con el otro dato o revisa las fichas.',
        variant: 'destructive',
      });
      return;
    }
    const ok = await copyToClipboard(datos.join('\n'));
    toast(ok
      ? {
        title: `${datos.length} ${que === 'telefono' ? 'teléfonos' : 'correos'} copiados`,
        // Se dice cuántos se quedan fuera: pegar 38 cuando se marcaron 40 y no
        // enterarse es quedarse con dos personas sin avisar.
        description: datos.length < elegidos.length
          ? `${elegidos.length - datos.length} de los marcados no tienen ese dato.`
          : 'Pégalos en la difusión.',
      }
      : { title: 'No se ha podido copiar', variant: 'destructive' });
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
        actions={(
          <button
            type="button"
            onClick={() => setWasapiAbierto(true)}
            disabled={total === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-normal font-semibold hover:bg-muted disabled:opacity-50"
            title="La base entera en el fichero que carga Wasapi"
          >
            <DownloadSimple size={14} weight="bold" />
            Descargar para Wasapi
          </button>
        )}
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
            <label className="inline-flex items-center gap-1.5 text-normal">
              <input
                type="checkbox"
                checked={todosMarcados}
                onChange={alternarTodos}
                className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring/40"
              />
              Marcar los {visibles.length} de la lista
            </label>
            <p className="text-secundario text-muted-foreground">
              {resumen.total} en total · se muestran {base.length}
              {base.length < resumen.total && ', los más olvidados primero'}
            </p>
          </div>
        </>
      )}

      {/* LOS FILTROS. Van al servidor; ver el comentario de arriba. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nombre, correo o teléfono…"
            aria-label="Buscar en el repaso"
            className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-3 text-sm"
          />
        </div>

        <select
          value={producto}
          onChange={(e) => setProducto(e.target.value)}
          aria-label="Filtrar por formación"
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
        >
          <option value="">Cualquier formación</option>
          {productos.map((p) => (
            <option key={p.ids.join(',')} value={p.ids.join(',')}>{p.nombre} ({p.personas})</option>
          ))}
        </select>

        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Filtrar por estado"
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
        >
          <option value="">Cualquier estado</option>
          {ESTADOS_DEL_REPASO.map((e) => (
            <option key={e} value={e}>{STATUS_LABELS[e] || e}</option>
          ))}
        </select>

        {(busca || producto || estado || bloque || soloSinContactar) && (
          <button
            type="button"
            onClick={() => {
              setBusca(''); setProducto(''); setEstado(''); setBloque(null); setSoloSinContactar(false);
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-normal text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={13} /> Quitar filtros
          </button>
        )}
      </div>

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
            <div
              key={p.lead_id}
              className={
                'w-full rounded-lg border bg-card p-3 transition-colors '
                + (marcados.includes(p.lead_id) ? 'ring-2 ring-primary/40 ' : '')
                + (p.ultimo_contacto == null ? 'border-l-4 border-l-warning border-border' : 'border-border')
              }
            >
              <div className="flex items-start gap-3">
                {/* La casilla va fuera de la zona pulsable: marcar a alguien
                    para la difusión no es lo mismo que abrirlo, y mezclarlo
                    hace que cada clic abra una ventana que nadie pidió. */}
                <input
                  type="checkbox"
                  checked={marcados.includes(p.lead_id)}
                  onChange={() => alternarMarca(p.lead_id)}
                  aria-label={`Marcar a ${p.lead_nombre || 'sin nombre'}`}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-border text-primary focus:ring-2 focus:ring-ring/40"
                />
                <button
                  type="button"
                  onClick={() => setEnFoco(i)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                >
                <span className="mt-0.5 flex shrink-0 flex-col items-center rounded-md bg-muted px-2 py-1 text-muted-foreground">
                  <CalendarBlank size={13} />
                </span>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-semibold truncate">{p.lead_nombre || 'Sin nombre'}</span>
                    {/* EN QUÉ ESTADO ESTÁ. Diego, 23/09: «en el seguimiento del
                        mes debe señalar también por las personas su estado».
                        No es lo mismo llamar a quien está «por contactar» que a
                        quien ya está «en seguimiento»: el mensaje cambia, y sin
                        esto había que abrir la ficha para saberlo. */}
                    {p.lead_estado && (
                      <StatusBadge status={p.lead_estado} showIcon className="shrink-0" />
                    )}
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

                  {/* Con qué se le puede escribir. Antes había que abrir la
                      ficha para saber si esta persona siquiera tenía teléfono,
                      y en una lista que se trabaja de arriba abajo eso es un
                      viaje por cada fila. */}
                  {(p.lead_telefono || p.lead_email) && (
                    <p className="flex flex-wrap gap-x-3 truncate text-[11px] text-muted-foreground">
                      {p.lead_telefono && <span className="tabular-nums">{p.lead_telefono}</span>}
                      {p.lead_email && <span className="truncate">{p.lead_email}</span>}
                    </p>
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
                </button>

                {/* Atenderla sin abrir la ventana. Va FUERA del botón de la
                    fila: un botón dentro de otro no es HTML válido y el clic
                    se lo queda el de fuera. */}
                <AccionesDeFila
                  fila={p}
                  plantillas={plantillas}
                  onAtendido={(tipo) => atenderDesdeLaFila(p, tipo)}
                />
                <DescartarDelRepaso
                  nombre={p.lead_nombre}
                  onDescartar={(motivo) => descartarDelRepaso(p, motivo)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LA PAGINACIÓN. Con 2.000 en la base, pintarlas todas deja la pantalla
          pegada y nadie baja más allá de la tercera pantalla. */}
      {totalPaginas > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-secundario tabular-nums text-muted-foreground">
            Página {pagina} de {totalPaginas} · {total} en total
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagina <= 1 || cargando}
              onClick={() => setPagina((n) => Math.max(1, n - 1))}
              className="rounded-md border border-border px-2.5 py-1.5 text-normal font-semibold hover:bg-muted disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={pagina >= totalPaginas || cargando}
              onClick={() => setPagina((n) => Math.min(totalPaginas, n + 1))}
              className="rounded-md border border-border px-2.5 py-1.5 text-normal font-semibold hover:bg-muted disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      {/* El mismo diálogo que en Prospectos, apuntando al repaso. */}
      <WasapiExportDialog
        open={wasapiAbierto}
        projectId={elegido}
        onClose={() => setWasapiAbierto(false)}
        endpoint="/proceso/seguimiento/wasapi"
        paramsBase={paramsDeLaDescarga}
        ocultar={['gestor', 'producto', 'fechas', 'convertidos']}
        titulo="Descargar el repaso para Wasapi"
        descripcion="Se lleva la base del repaso —todas las páginas, no solo la que ves— con lo que tengas filtrado. Aquí eliges lo del envío: de qué país, a quién excluir y en qué formato."
        resumenFiltros={resumenDeFiltros}
        nombreFichero="wasapi-seguimiento"
      />

      {/* La barra de acciones en bloque: la misma que en Prospectos, para que
          marcar cuarenta personas se haga igual en las dos pantallas. */}
      {marcados.length > 0 && (
        <BulkActionBar
          count={marcados.length}
          onClear={() => setMarcados([])}
          onMarcarContactado={marcarContactados}
          onCopiarContactos={copiarContactos}
          gestores={[]}
          isAdmin={esAdmin}
          loading={enBloque}
        />
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
