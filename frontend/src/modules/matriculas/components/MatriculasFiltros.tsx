import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Funnel, CaretDown, X } from '@phosphor-icons/react';
import { ESTADO_LABEL } from '../lib/estados';

/**
 * Los filtros de Matrículas (#199): «estado, curso, campus y fechas, en el
 * mismo desplegable único de Prospectos» (ideas de Diego, 01/10).
 *
 * Como en Prospectos: un botón «Filtros» con el número de filtros puestos, que
 * abre un panel con todo dentro, y al lado las píldoras de lo que está puesto,
 * cada una con su ✕. El buscador va arriba, en la BarraFiltros de la página.
 *
 * Las fechas son dos casillas de fecha y no el DateRangeFilter de Prospectos:
 * aquel calcula «hoy» con toISOString (UTC) y en España, de madrugada, «Hoy»
 * sale con la fecha de ayer.
 */

const ESTADOS = ESTADO_LABEL;

export interface Filtros {
  estado: string;
  curso: string;
  campusId: string;
  desde: string;
  hasta: string;
}

export const SIN_FILTROS: Filtros = { estado: '', curso: '', campusId: '', desde: '', hasta: '' };

interface Props {
  filtros: Filtros;
  onCambio: (f: Filtros) => void;
  /** Los cursos que hay en el ámbito (los manda el servidor). */
  cursos: string[];
  /** Los campus entre los que elegir; vacío si la cabecera ya tiene un campus. */
  campus: Array<{ id: number; nombre?: string }>;
}

// `color-scheme` oscuro en modo oscuro: la lista que despliega un <select> y el
// calendario de un <input type="date"> los pinta el navegador, y sin esto salían
// en gris claro con la página en oscuro.
const CAMPO = 'w-full h-9 px-3 rounded-md border border-border bg-muted/40 text-sm dark:[color-scheme:dark]';

/** «2026-10-01» → «01/10/2026», para las píldoras. */
const dia = (s: string) => (s ? s.split('-').reverse().join('/') : '');

export default function MatriculasFiltros({ filtros, onCambio, cursos, campus }: Props) {
  const [abierto, setAbierto] = useState(false);
  const anclaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const poner = (cambio: Partial<Filtros>) => onCambio({ ...filtros, ...cambio });

  // El panel va en un portal, colocado bajo el botón, para que ningún
  // contenedor con overflow lo recorte (lo mismo que en Prospectos).
  const colocar = useCallback(() => {
    const r = anclaRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(420, window.innerWidth - 32);
    const left = Math.max(16, Math.min(r.left, window.innerWidth - 16 - width));
    setPos({ top: r.bottom + 8, left, width });
  }, []);

  useEffect(() => {
    if (!abierto) return undefined;
    colocar();
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anclaRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setAbierto(false);
    };
    window.addEventListener('resize', colocar);
    window.addEventListener('scroll', colocar, true);
    document.addEventListener('mousedown', fuera);
    return () => {
      window.removeEventListener('resize', colocar);
      window.removeEventListener('scroll', colocar, true);
      document.removeEventListener('mousedown', fuera);
    };
  }, [abierto, colocar]);

  const pildoras: Array<{ clave: string; texto: string; quitar: () => void }> = [];
  if (filtros.estado) pildoras.push({ clave: 'estado', texto: ESTADOS[filtros.estado] || filtros.estado, quitar: () => poner({ estado: '' }) });
  if (filtros.curso) pildoras.push({ clave: 'curso', texto: filtros.curso, quitar: () => poner({ curso: '' }) });
  if (filtros.campusId) {
    const nombre = campus.find((c) => String(c.id) === filtros.campusId)?.nombre || 'Campus';
    pildoras.push({ clave: 'campus', texto: nombre, quitar: () => poner({ campusId: '' }) });
  }
  if (filtros.desde || filtros.hasta) {
    pildoras.push({
      clave: 'fechas',
      texto: `${filtros.desde ? dia(filtros.desde) : '…'} → ${filtros.hasta ? dia(filtros.hasta) : 'hoy'}`,
      quitar: () => poner({ desde: '', hasta: '' }),
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div ref={anclaRef}>
        <button
          type="button"
          onClick={() => setAbierto(!abierto)}
          aria-expanded={abierto}
          className={`h-9 inline-flex items-center gap-1.5 px-3 rounded-md border text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
            pildoras.length > 0 ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted'
          }`}
        >
          <Funnel size={14} weight={pildoras.length > 0 ? 'fill' : 'bold'} />
          Filtros
          {pildoras.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none">
              {pildoras.length}
            </span>
          )}
          <CaretDown size={11} weight="bold" className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
      </div>

      {abierto && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filtros de matrículas"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
          className="bg-card border border-border rounded-lg shadow-dialog px-3 py-2.5 space-y-1.5"
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Filtros</p>
          <Fila etiqueta="Estado">
            <select aria-label="Estado" value={filtros.estado} onChange={(e) => poner({ estado: e.target.value })} className={CAMPO}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Fila>
          <Fila etiqueta="Curso">
            <select aria-label="Curso" value={filtros.curso} onChange={(e) => poner({ curso: e.target.value })} className={CAMPO}>
              <option value="">Todos los cursos</option>
              {cursos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Fila>
          {campus.length > 1 && (
            <Fila etiqueta="Campus">
              <select aria-label="Campus" value={filtros.campusId} onChange={(e) => poner({ campusId: e.target.value })} className={CAMPO}>
                <option value="">Todos los campus</option>
                {campus.map((c) => <option key={c.id} value={String(c.id)}>{c.nombre || `Campus ${c.id}`}</option>)}
              </select>
            </Fila>
          )}
          <Fila etiqueta="Recibida">
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="Recibida desde" value={filtros.desde} max={filtros.hasta || undefined}
                onChange={(e) => poner({ desde: e.target.value })} className={CAMPO} />
              <input type="date" aria-label="Recibida hasta" value={filtros.hasta} min={filtros.desde || undefined}
                onChange={(e) => poner({ hasta: e.target.value })} className={CAMPO} />
            </div>
          </Fila>
        </div>,
        document.body,
      )}

      {pildoras.map((p) => (
        <span key={p.clave} className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          {p.texto}
          <button type="button" onClick={p.quitar} aria-label={`Quitar el filtro ${p.texto}`}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-primary/20">
            <X size={11} weight="bold" />
          </button>
        </span>
      ))}
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
      <span className="text-[11px] font-medium text-muted-foreground">{etiqueta}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
