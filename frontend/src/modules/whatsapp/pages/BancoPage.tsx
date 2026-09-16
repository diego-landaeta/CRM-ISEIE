import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlass, DownloadSimple, Paperclip, ArrowLeft, ArrowRight,
  UsersThree, Table as TablaIcono, ListNumbers, Warning,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { runExport, type ExportFormat } from '@/shared/lib/export';
import {
  chatApi,
  type MensajeDelBanco, type NumeroDelBanco, type FiltrosBanco,
} from '../api/whatsapp.api';

/**
 * El banco de mensajes: todo lo guardado, en tabla y con copia (#101).
 *
 * NO es el chat, y es importante que no lo parezca. El chat sirve para
 * conversar y por eso vive en su panel oscuro con burbujas; esto sirve para
 * buscar, auditar y llevarse una copia, asi que va como el resto del CRM: una
 * tabla, con sus filtros y su boton de descargar.
 *
 * La razon de que exista son dos casos de la misma semana:
 *
 *  · ISEIE perdio las sesiones. Se recreo el contenedor de Evolution y las
 *    instancias de Maria Gabriela y Diana desaparecieron. Sus mensajes seguian
 *    en el CRM —7 conversaciones, 27 mensajes— pero sin forma de verlos: la
 *    pantalla de chat no puede abrir una conversacion de una sesion que ya no
 *    existe. Se acabaron borrando por inservibles.
 *  · El historico de un grupo estaba solo en Evolution: 2.644 mensajes alli y
 *    cero aqui. Si Evolution se pierde, se va con el.
 *
 * En los dos el problema es el mismo: el dato existe y no hay donde mirarlo ni
 * como llevarselo. Por eso esta pantalla no pregunta por ninguna sesion.
 */

const PAGINA = 50;
/** Lo que se pide por vuelta al exportar. Igual que en Prospectos. */
const TANDA_EXPORT = 500;

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const soloFecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES');

const TIPO_ES: Record<string, string> = {
  texto: 'Texto', imagen: 'Imagen', audio: 'Audio', video: 'Vídeo',
  documento: 'Documento', sticker: 'Sticker', llamada: 'Llamada', ubicacion: 'Ubicación',
};

/** Las columnas de la copia. Es lo que se lleva a Excel, no lo que se pinta. */
function columnas() {
  return [
    { key: 'ts', label: 'Fecha', type: 'date' as const, value: (m: MensajeDelBanco) => m.ts },
    { key: 'telefono', label: 'Número', value: (m: MensajeDelBanco) => m.telefono },
    { key: 'quien', label: 'Quién', value: (m: MensajeDelBanco) => m.quien || '' },
    {
      key: 'autor', label: 'Lo escribió',
      // En un grupo, quien lo escribio; en un chat de una persona, quien lo
      // mando desde el CRM si salio de aqui.
      value: (m: MensajeDelBanco) => m.participante_nombre || m.enviado_por_nombre || '',
    },
    { key: 'direccion', label: 'Sentido', value: (m: MensajeDelBanco) => (m.direccion === 'entrante' ? 'Recibido' : 'Enviado') },
    { key: 'tipo', label: 'Tipo', value: (m: MensajeDelBanco) => TIPO_ES[m.tipo] || m.tipo },
    { key: 'texto', label: 'Texto', value: (m: MensajeDelBanco) => m.texto || '' },
    { key: 'adjunto', label: 'Adjunto', value: (m: MensajeDelBanco) => m.nombre_archivo || (m.con_adjunto ? 'sí' : '') },
    { key: 'estado', label: 'Estado', value: (m: MensajeDelBanco) => m.estado || '' },
    { key: 'sesion', label: 'Sesión', value: (m: MensajeDelBanco) => m.instancia },
  ];
}

export default function BancoPage() {
  const [vista, setVista] = useState<'mensajes' | 'numeros'>('mensajes');
  const [filtros, setFiltros] = useState<FiltrosBanco>({});
  // Lo que se teclea va con un respiro por delante: sin eso es una consulta por
  // tecla contra una tabla que en produccion ya tiene miles de filas.
  const [enCurso, setEnCurso] = useState<FiltrosBanco>({});
  const [pagina, setPagina] = useState(1);

  const [filas, setFilas] = useState<MensajeDelBanco[]>([]);
  const [numeros, setNumeros] = useState<NumeroDelBanco[]>([]);
  const [total, setTotal] = useState(0);
  const [paginas, setPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setEnCurso(filtros); setPagina(1); }, 350);
    return () => clearTimeout(t);
  }, [filtros]);

  // Cambiar de vista vuelve a la primera pagina: volviendo del resumen con la
  // pagina 9 puesta y otro filtro, la tabla salia vacia sin decir por que.
  useEffect(() => { setPagina(1); }, [vista]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      if (vista === 'numeros') {
        const r = await chatApi.bancoNumeros({ texto: enCurso.texto, telefono: enCurso.telefono });
        if (r.success) setNumeros(r.data || []);
      } else {
        const r = await chatApi.banco(enCurso, pagina, PAGINA);
        if (r.success) {
          setFilas(r.data || []);
          setTotal(r.pagination?.total ?? 0);
          setPaginas(r.pagination?.totalPages ?? 1);
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'No se pudieron cargar los mensajes.');
    } finally {
      setCargando(false);
    }
  }, [vista, enCurso, pagina]);

  useEffect(() => { cargar(); }, [cargar]);

  /**
   * La copia se lleva TODO lo filtrado, no la página que se está viendo.
   *
   * Se pide de 500 en 500, que es lo que hace Prospectos: de una tacada, una
   * gestora con 1.957 mensajes ya devuelve una respuesta incomoda, y esto va a
   * crecer.
   */
  async function descargar(formato: ExportFormat) {
    setDescargando(true);
    try {
      const todo: MensajeDelBanco[] = [];
      let p = 1;
      for (;;) {
        const r = await chatApi.banco(enCurso, p, TANDA_EXPORT);
        if (!r.success) throw new Error(r.error || 'No se pudo leer');
        todo.push(...(r.data || []));
        const totalPaginas = r.pagination?.totalPages ?? 1;
        // Se corta tambien si una vuelta viene vacia: sin esto, un servidor que
        // dijera «hay mas paginas» y no devolviera filas dejaria el bucle dando
        // vueltas para siempre con la pantalla bloqueada en «Preparando…».
        if (!r.data?.length || p >= totalPaginas) break;
        p += 1;
      }
      if (!todo.length) {
        toast({ title: 'No hay nada que descargar', description: 'Con estos filtros no sale ningún mensaje.' });
        return;
      }
      const cols = columnas();
      await runExport({
        context: 'whatsapp-banco',
        filename: `whatsapp-mensajes-${new Date().toISOString().slice(0, 10)}`,
        format: formato,
        columns: cols,
        config: cols.map((c) => ({ key: c.key, label: c.label, included: true })),
        rows: todo,
      });
      toast({ title: 'Descargado', description: `${todo.length} mensajes.` });
    } catch (e: any) {
      toast({
        title: 'No se pudo descargar',
        description: e?.response?.data?.error || e?.message || 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setDescargando(false);
    }
  }

  const hayFiltros = useMemo(
    () => Object.values(enCurso).some((v) => v),
    [enCurso],
  );

  const campo = 'h-9 px-3 rounded-md border border-border bg-card text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Banco de mensajes"
        subtitle="Todo lo que ha pasado por WhatsApp, para buscarlo y guardarlo. No depende de que la sesión siga enlazada."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={descargando}
              onClick={() => descargar('csv')}
              className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <DownloadSimple size={15} weight="bold" /> CSV
            </button>
            <button
              type="button"
              disabled={descargando}
              onClick={() => descargar('xlsx')}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <DownloadSimple size={15} weight="bold" />
              {descargando ? 'Preparando…' : 'Excel'}
            </button>
          </div>
        }
      />

      <div className="flex items-center gap-1">
        {([['mensajes', 'Mensajes', TablaIcono], ['numeros', 'Por número', ListNumbers]] as const).map(
          ([id, texto, Icono]) => (
            <button
              key={id}
              type="button"
              onClick={() => setVista(id)}
              className={`h-8 px-3 rounded-lg text-sm font-semibold inline-flex items-center gap-1.5 transition-colors ${
                vista === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icono size={14} weight="bold" /> {texto}
            </button>
          ),
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filtros.texto || ''}
            onChange={(e) => setFiltros((f) => ({ ...f, texto: e.target.value }))}
            placeholder="Buscar en el texto"
            aria-label="Buscar en el texto de los mensajes"
            className={`${campo} w-full pl-8`}
          />
        </div>
        <input
          value={filtros.telefono || ''}
          onChange={(e) => setFiltros((f) => ({ ...f, telefono: e.target.value }))}
          placeholder="Número"
          aria-label="Filtrar por número"
          className={`${campo} w-40`}
        />
        {vista === 'mensajes' && (
          <>
            <input
              type="date"
              value={filtros.desde || ''}
              onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))}
              aria-label="Desde"
              className={campo}
            />
            <input
              type="date"
              value={filtros.hasta || ''}
              onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))}
              aria-label="Hasta"
              className={campo}
            />
            <select
              value={filtros.direccion || ''}
              onChange={(e) => setFiltros((f) => ({ ...f, direccion: e.target.value as FiltrosBanco['direccion'] }))}
              aria-label="Sentido"
              className={campo}
            >
              <option value="">Todo</option>
              <option value="entrante">Recibidos</option>
              <option value="saliente">Enviados</option>
            </select>
          </>
        )}
        {hayFiltros && (
          <button
            type="button"
            onClick={() => setFiltros({})}
            className="h-9 px-3 rounded-md text-sm text-muted-foreground hover:bg-muted"
          >
            Quitar filtros
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">
          <Warning size={16} weight="bold" className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {vista === 'numeros' ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {cargando ? (
            <p className="text-sm text-muted-foreground text-center py-10">Cargando…</p>
          ) : !numeros.length ? (
            <EmptyState icon={ListNumbers} title="Ningún número" description="Con estos filtros no sale ninguno." />
          ) : (
            <div className="overflow-x-auto">
              {/* El resumen trae como mucho 500 numeros. Decirlo en vez de
                  cortar sin avisar: una lista recortada en silencio parece
                  completa, y aqui eso significaria dar por hecho que un numero
                  no existe cuando si esta. */}
              {numeros.length >= 500 && (
                <p className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
                  Se enseñan los 500 números con actividad más reciente. Si buscas uno concreto, fíltralo arriba.
                </p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Número</th>
                    <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Quién</th>
                    <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground text-right">Mensajes</th>
                    <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Desde</th>
                    <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Hasta</th>
                  </tr>
                </thead>
                <tbody>
                  {numeros.map((n) => (
                    <tr key={`${n.telefono}-${String(n.es_grupo)}`} className="border-b border-border last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setFiltros({ telefono: n.telefono });
                            setVista('mensajes');
                          }}
                          className="font-medium tabular-nums text-primary hover:underline"
                        >
                          {n.telefono}
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          {n.es_grupo && <UsersThree size={13} weight="bold" className="text-muted-foreground" />}
                          {n.quien || <span className="text-muted-foreground">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{n.mensajes}</td>
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{soloFecha(n.primero)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{soloFecha(n.ultimo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {cargando ? (
              <p className="text-sm text-muted-foreground text-center py-10">Cargando…</p>
            ) : !filas.length ? (
              <EmptyState
                icon={TablaIcono}
                title="Ningún mensaje"
                description={hayFiltros ? 'Con estos filtros no sale ninguno.' : 'Todavía no ha entrado ni salido nada por WhatsApp.'}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground whitespace-nowrap">Fecha</th>
                      <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Número</th>
                      <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Quién</th>
                      <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Sentido</th>
                      <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Tipo</th>
                      <th className="px-4 py-2.5 text-xs font-bold uppercase text-muted-foreground">Texto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((m) => (
                      <tr key={m.id} className="border-b border-border last:border-0 hover:bg-muted/40 align-top">
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">{fecha(m.ts)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{m.telefono}</td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1.5">
                            {m.es_grupo && <UsersThree size={13} weight="bold" className="text-muted-foreground" />}
                            {m.quien || <span className="text-muted-foreground">—</span>}
                          </span>
                          {/* En un grupo hace falta saber quien lo dijo: sin
                              esto todos los mensajes salen iguales. */}
                          {m.participante_nombre && (
                            <span className="block text-[11px] text-muted-foreground">{m.participante_nombre}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className={m.direccion === 'entrante' ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'}>
                            {m.direccion === 'entrante' ? 'Recibido' : 'Enviado'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{TIPO_ES[m.tipo] || m.tipo}</td>
                        <td className="px-4 py-2.5 max-w-[420px]">
                          <span className="block truncate" title={m.texto || undefined}>
                            {m.texto || <span className="text-muted-foreground">—</span>}
                          </span>
                          {m.con_adjunto && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                              <Paperclip size={11} weight="bold" />
                              {m.nombre_archivo || 'archivo'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {paginas > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground tabular-nums">
                {total} mensajes · página {pagina} de {paginas}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={pagina <= 1}
                  onClick={() => setPagina((p) => p - 1)}
                  className="h-8 px-2.5 rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  <ArrowLeft size={13} weight="bold" /> Anterior
                </button>
                <button
                  type="button"
                  disabled={pagina >= paginas}
                  onClick={() => setPagina((p) => p + 1)}
                  className="h-8 px-2.5 rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  Siguiente <ArrowRight size={13} weight="bold" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
