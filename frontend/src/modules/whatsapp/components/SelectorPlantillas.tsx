import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MagnifyingGlass, WarningCircle, X } from '@phosphor-icons/react';
import { whatsappApi, type PlantillaWhatsapp } from '../api/whatsapp.api';
import { rellenar, huecosSinRellenar, type DatosParaRellenar } from '../lib/plantilla';

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

/** Sin tildes y en minuscula, para que «matricula» encuentre «Matrícula». */
const plano = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SelectorPlantillas({
  projectId,
  datos,
  nombreProyecto,
  alElegir,
  alCerrar,
}: {
  projectId: number;
  /** De quien es la conversacion, para rellenar los huecos. */
  datos: DatosParaRellenar;
  nombreProyecto?: string | null;
  alElegir: (texto: string) => void;
  alCerrar: () => void;
}) {
  const [plantillas, setPlantillas] = useState<PlantillaWhatsapp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const cajaBusca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let vivo = true;
    setError(null);
    whatsappApi.plantillas(projectId)
      .then((r) => {
        if (!vivo) return;
        if (r.success) setPlantillas(r.data || []);
        else setError(r.error || 'No se pudieron cargar');
      })
      .catch((e) => { if (vivo) setError(e?.message || 'No se pudieron cargar'); });
    return () => { vivo = false; };
  }, [projectId]);

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
    if (!q) return plantillas || [];
    return (plantillas || []).filter(
      (p) => plano(p.label).includes(q) || plano(p.body).includes(q)
    );
  }, [plantillas, busca]);

  const elegir = (p: PlantillaWhatsapp) => {
    alElegir(rellenar(p.body, datos, nombreProyecto));
    alCerrar();
  };

  return (
    <div className="wa-plantillas" role="dialog" aria-label="Elegir una plantilla">
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
        <button type="button" onClick={alCerrar} aria-label="Cerrar las plantillas"
          className="wa-plantillas-cerrar">
          <X size={15} />
        </button>
      </div>

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
            <span>Ninguna coincide con «{busca}».</span>
            <button type="button" onClick={() => setBusca('')} className="underline">
              Quitar la búsqueda
            </button>
          </div>
        )}

        {/* 5 · Lleno */}
        {filtradas.map((p) => {
          const huecos = huecosSinRellenar(p.body, datos, nombreProyecto);
          return (
            <button key={p.id} type="button" onClick={() => elegir(p)} className="wa-plantilla">
              <span className="wa-plantilla-nombre">
                {p.label}
                {p.ambito === 'compartida' && (
                  <span className="wa-plantilla-etiqueta">compartida</span>
                )}
              </span>
              <span className="wa-plantilla-cuerpo">{rellenar(p.body, datos, nombreProyecto)}</span>
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
