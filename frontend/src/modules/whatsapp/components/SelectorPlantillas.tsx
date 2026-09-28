import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MagnifyingGlass, WarningCircle, X, ImageSquare, Plus } from '@phosphor-icons/react';
import { whatsappApi, type PlantillaWhatsapp } from '../api/whatsapp.api';
import { rellenar, huecosSinRellenar, type DatosParaRellenar } from '../lib/plantilla';
import { PROCESO_EN_PRUEBAS } from '@/shared/lib/enPruebas';

/**
 * Elegir una plantilla SIN salir del chat.
 *
 * Hasta ahora las plantillas se creaban en su pantalla y ahi se quedaban: en el
 * chat no habia forma de insertarlas. Habia que ir, copiar a mano, volver,
 * pegar, y cambiar el `{nombre}` una misma — con lo cual no ahorraban nada. El
 * motor que las rellena ya existia y no lo importaba nadie.
 *
 * Lo que se elige entra en el CAMPO DE ESCRIBIR, no se manda. Se lee, se ajusta
 * y se decide, igual que con la nota de voz: elegir no es enviar.
 */

/**
 * Los pasos del proceso, en su orden y con nombre corto.
 *
 * La CLAVE es lo estable: no se puede editar desde la pantalla de pasos, al
 * contrario que el nombre. Por eso los botones se apoyan en ella y no en cómo
 * se llame hoy el paso.
 */
/**
 * El filtro de «las mías».
 *
 * No es un paso: es el ámbito. Va en la misma fila porque es donde Diego lo
 * pidió --«también necesitamos algo como personalizadas»-- y porque para quien
 * busca es la misma pregunta: «¿cuál de todas quiero?».
 */
const MIAS = 'mias';

const ORDEN_PASOS = [
  { clave: 'paso_1', corto: 'Paso 1' },
  { clave: 'paso_2', corto: 'Paso 2' },
  { clave: 'paso_3', corto: 'Paso 3' },
  { clave: 'paso_4', corto: 'Paso 4' },
  { clave: 'seguimiento_mensual', corto: 'Fin de mes' },
  { clave: 'sueltas', corto: 'Sueltas' },
];

/** Sin tildes y en minuscula, para que «matricula» encuentre «Matrícula». */
const plano = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SelectorPlantillas({
  projectId,
  issuerId = null,
  datos,
  nombreProyecto,
  alElegir,
  alCerrar,
  anclaje = 'arriba',
  borrador = '',
  usuarioId = null,
  nombreSesion = null,
}: {
  projectId: number | null;
  issuerId?: number | null;
  /** De quien es la conversacion, para rellenar los huecos. */
  datos: DatosParaRellenar;
  nombreProyecto?: string | null;
  alElegir: (texto: string, plantilla?: PlantillaWhatsapp) => void;
  alCerrar: () => void;
  /**
   * Por dónde sale el panel.
   *
   * `arriba` es lo de siempre: cuelga por encima del campo de escribir, que
   * está abajo del todo. `abajo` es para la barra superior, donde colgar hacia
   * arriba lo sacaría de la pantalla.
   */
  anclaje?: 'arriba' | 'abajo';
  /** Lo que hay escrito ahora, para poder guardarlo como plantilla propia. */
  borrador?: string;
  /**
   * Sobre qué WhatsApp se está trabajando. `null` = el mío.
   *
   * Las personales son las de ESE número, no las de quien tiene la sesión del
   * CRM abierta: si un administrador entra al WhatsApp de una gestora, las
   * suyas no le sirven de nada allí.
   */
  usuarioId?: number | null;
  /** De quién es ese WhatsApp, para no llamar «mías» a las de otra persona. */
  nombreSesion?: string | null;
}) {
  const [plantillas, setPlantillas] = useState<PlantillaWhatsapp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [paso, setPaso] = useState<string>('todas');
  const cajaBusca = useRef<HTMLInputElement>(null);
  const [creando, setCreando] = useState(false);
  const [nombreNueva, setNombreNueva] = useState('');
  const [cuerpoNuevo, setCuerpoNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setError(null);
    whatsappApi.plantillas(projectId, issuerId, usuarioId)
      .then((r) => {
        if (!vivo) return;
        if (r.success) setPlantillas(r.data || []);
        else setError(r.error || 'No se pudieron cargar');
      })
      .catch((e) => { if (vivo) setError(e?.message || 'No se pudieron cargar'); });
    return () => { vivo = false; };
  }, [projectId, issuerId, usuarioId]);

  // El foco va a la busqueda al abrir: con veinte plantillas, escribir es mas
  // rapido que recorrer la lista, y es lo que se va a hacer siempre.
  useEffect(() => { cajaBusca.current?.focus(); }, []);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [alCerrar]);

  // Busca por nombre Y por contenido: muchas veces se recuerda una frase suelta
  // de la plantilla y no como se llamo.
  const filtradas = useMemo(() => {
    const q = plano(busca).trim();
    let out = plantillas || [];
    if (paso === MIAS) out = out.filter((p) => p.ambito === 'personal');
    else if (paso !== 'todas') out = out.filter((p) => (p.paso_clave || 'sueltas') === paso);
    if (!q) return out;
    return out.filter(
      (p) => plano(p.label).includes(q) || plano(p.body).includes(q)
    );
  }, [plantillas, busca, paso]);

  /**
   * Los pasos que hay de verdad entre estas plantillas.
   *
   * Se sacan de lo que llega, no de una lista fija: si un proyecto no tiene la
   * del día 4, su botón no aparece.
   */
  /**
   * Cuántas son suyas.
   *
   * El servidor ya solo manda las compartidas y las de quien pregunta, así que
   * `personal` aquí significa «mía» sin tener que saber quién soy. Si no tiene
   * ninguna, el botón no sale: un filtro que siempre da vacío estorba.
   */
  const cuantasMias = useMemo(
    () => (plantillas || []).filter((p) => p.ambito === 'personal').length,
    [plantillas],
  );

  const pasos = useMemo(() => {
    const hay = new Set((plantillas || []).map((p) => p.paso_clave || 'sueltas'));
    return ORDEN_PASOS.filter((x) => hay.has(x.clave));
  }, [plantillas]);

  const elegir = (p: PlantillaWhatsapp) => {
    // Se pasa la plantilla entera y no solo el texto: el chat necesita saber si
    // lleva imagen detrás para abrir el selector de archivos sin que haya que
    // acordarse del clip.
    alElegir(rellenar(p.body, datos, nombreProyecto), p);
    alCerrar();
  };

  return (
    <div className={`wa-plantillas${anclaje === 'abajo' ? ' es-abajo' : ''}`}
      role="dialog" aria-label="Elegir una plantilla">
      <div className="wa-plantillas-cabecera">
        <MagnifyingGlass size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={cajaBusca}
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar una plantilla…"
          aria-label="Buscar una plantilla por nombre o por contenido"
          className="wa-plantillas-busca"
        />
        {/* Sin proyecto elegido no se puede: una plantilla vive en un
            proyecto. Con la empresa entera puesta no hay a cuál guardarla, y
            es mejor decirlo que meterla en uno al azar. */}
        {PROCESO_EN_PRUEBAS && projectId && !creando && (
          <button type="button" className="wa-plantillas-nueva-abrir"
            title={nombreSesion
              ? `Guardar una plantilla en el WhatsApp de ${nombreSesion}`
              : 'Guardar una plantilla solo para ti'}
            onClick={() => {
              setCuerpoNuevo(borrador);
              setNombreNueva('');
              setCreando(true);
            }}>
            <Plus size={13} weight="bold" />
            <span>Nueva mía</span>
          </button>
        )}
        <button type="button" onClick={alCerrar} aria-label="Cerrar las plantillas"
          className="wa-plantillas-cerrar">
          <X size={15} />
        </button>
      </div>
      {/* GUARDAR UNA PROPIA, SIN SALIR DEL CHAT.

          El filtro «Mías» no se llena solo: crear una obligaba a irse a la
          pantalla de Plantillas, y si hay que salir del chat para eso, no se
          hace. Lo que se guarda es lo que hay escrito en el campo de escribir,
          que es de donde salen las plantillas de verdad: una frase que a una le
          funciona y repite veinte veces al mes.

          Va con los HUECOS SIN RELLENAR a propósito: se guarda el texto tal
          como está escrito, no el que ya lleva el nombre de esta persona.
          Guardar «Hola Marta» como plantilla la hace inservible mañana. */}
      {creando && (
        <form
          className="wa-plantillas-nueva"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!projectId || !nombreNueva.trim() || !cuerpoNuevo.trim()) return;
            setGuardando(true);
            try {
              const r = await whatsappApi.crearPlantilla({
                projectId,
                label: nombreNueva.trim(),
                body: cuerpoNuevo,
                ambito: 'personal',
                // Se guarda en el WhatsApp desde el que se esta escribiendo.
                usuarioId,
              });
              if (!r.success) throw new Error(r.error || 'No se pudo guardar');
              // Se vuelve a pedir la lista en vez de anadirla a mano: asi sale
              // con lo que el servidor haya decidido --el orden, el id-- y no
              // una copia que se le parezca.
              const lista = await whatsappApi.plantillas(projectId, issuerId, usuarioId);
              if (lista.success) setPlantillas(lista.data || []);
              setCreando(false);
              setNombreNueva('');
              setPaso(MIAS);
            } catch (err) {
              setError((err as Error)?.message || 'No se pudo guardar');
            } finally {
              setGuardando(false);
            }
          }}
        >
          <input
            type="text"
            value={nombreNueva}
            onChange={(e) => setNombreNueva(e.target.value)}
            placeholder="¿Cómo la llamas?"
            aria-label="Nombre de la plantilla"
            maxLength={80}
            autoFocus
            className="wa-plantillas-nueva-nombre"
          />
          <textarea
            value={cuerpoNuevo}
            onChange={(e) => setCuerpoNuevo(e.target.value)}
            placeholder="El mensaje. Puedes usar los huecos {nombre}, {producto}, {proyecto}…"
            aria-label="Texto de la plantilla"
            rows={3}
            className="wa-plantillas-nueva-cuerpo"
          />
          <div className="wa-plantillas-nueva-pie">
            <span className="wa-plantillas-nueva-nota">
              {nombreSesion
                ? `Se guarda en el WhatsApp de ${nombreSesion}.`
                : 'Solo la verás tú.'}
            </span>
            <button type="button" onClick={() => setCreando(false)} className="underline">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando || !nombreNueva.trim() || !cuerpoNuevo.trim()}
              className="wa-plantillas-nueva-guardar"
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      )}

      {/* Por paso del proceso. El documento las da por días y así es como se
          buscan: la gestora sabe en qué paso va esta persona, no cómo se llama
          la plantilla. */}
      {(pasos.length > 1 || cuantasMias > 0) && (
        <div className="wa-plantillas-pasos" role="group" aria-label="Filtrar las plantillas">
          <button type="button" onClick={() => setPaso('todas')}
            aria-pressed={paso === 'todas'}
            className={`wa-plantillas-paso${paso === 'todas' ? ' es-activo' : ''}`}>
            Todas
          </button>
          {pasos.map((x) => (
            <button key={x.clave} type="button" onClick={() => setPaso(x.clave)}
              aria-pressed={paso === x.clave}
              className={`wa-plantillas-paso${paso === x.clave ? ' es-activo' : ''}`}>
              {x.corto}
            </button>
          ))}
          {PROCESO_EN_PRUEBAS && cuantasMias > 0 && (
            <button type="button" onClick={() => setPaso(MIAS)}
              aria-pressed={paso === MIAS}
              title={nombreSesion
                ? `Solo las de este WhatsApp, el de ${nombreSesion}`
                : 'Solo las que has creado tú'}
              className={`wa-plantillas-paso es-mias${paso === MIAS ? ' es-activo' : ''}`}>
              {nombreSesion ? `De ${nombreSesion}` : 'Mías'} ({cuantasMias})
            </button>
          )}
        </div>
      )}

      <div className="wa-plantillas-lista">
        {/* 1 · Cargando */}
        {plantillas === null && !error && (
          <div className="wa-plantillas-aviso" aria-live="polite" aria-busy="true">
            Cargando…
          </div>
        )}

        {/* 2 · Error */}
        {error && (
          <div className="wa-plantillas-aviso">
            <WarningCircle size={16} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* 3 · Ninguna creada todavia — con la salida puesta */}
        {plantillas?.length === 0 && !error && (
          <div className="wa-plantillas-aviso wa-plantillas-vacio">
            <span>Todavía no hay plantillas en este proyecto.</span>
            <Link to="/whatsapp/plantillas" className="underline">Crear la primera</Link>
          </div>
        )}

        {/* 4 · Hay plantillas pero el filtro no encuentra nada. Es distinto de
            no tener ninguna, y la salida tambien: limpiar la busqueda. */}
        {plantillas && plantillas.length > 0 && filtradas.length === 0 && (
          <div className="wa-plantillas-aviso wa-plantillas-vacio">
            <span>
              {busca.trim()
                ? `Ninguna coincide con «${busca}».`
                : 'Ninguna en este filtro.'}
            </span>
            {busca.trim()
              ? (
                <button type="button" onClick={() => setBusca('')} className="underline">
                  Quitar la búsqueda
                </button>
              )
              : (
                <button type="button" onClick={() => setPaso('todas')} className="underline">
                  Ver todas
                </button>
              )}
          </div>
        )}

        {/* 5 · Lleno */}
        {filtradas.map((p) => {
          const huecos = huecosSinRellenar(p.body, datos, nombreProyecto);
          return (
            <button key={p.id} type="button" onClick={() => elegir(p)} className="wa-plantilla">
              <span className="wa-plantilla-nombre">
                {p.label}
                {p.ambito === 'compartida'
                  ? <span className="wa-plantilla-etiqueta">compartida</span>
                  : (
                    <span className="wa-plantilla-etiqueta es-mia">
                      {nombreSesion ? `de ${nombreSesion}` : 'mía'}
                    </span>
                  )}
              </span>
              <span className="wa-plantilla-cuerpo">{rellenar(p.body, datos, nombreProyecto)}</span>
              {/* La letra pequeña del documento: la lee la gestora mientras
                  elige, y NO se envía. Antes solo estaba en el PDF, que nadie
                  tiene abierto mientras escribe. */}
              {(p.pista || p.pide_adjunto) && (
                <span className="wa-plantilla-pista">
                  {p.pide_adjunto && <ImageSquare size={11} weight="bold" />}
                  {p.pista}
                </span>
              )}
              {/* El aviso va con icono ademas del color: un texto ambar a secas
                  no lo distingue quien no ve bien el color. */}
              {huecos.length > 0 && (
                <span className="wa-plantilla-hueco">
                  <WarningCircle size={12} weight="fill" aria-hidden="true" />
                  Falta {huecos.map((h) => `{${h}}`).join(', ')} — reviselo antes de mandar
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
