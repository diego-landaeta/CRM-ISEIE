import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { casaPorTrozos } from '@/shared/lib/buscarPorTrozos';

// Elegir UNO de una lista larga, escribiendo.
//
// Nace de un problema real: ISEIE tiene 787 cursos y el desplegable de siempre
// no deja escribir, asi que encontrar el «Máster Profesional en Neuropsicología
// y Logopedia Clínica» era bajar por la lista a ojo. Con esa lista, el curso
// parecia no existir.
//
// Se busca sin acentos y por trozos sueltos: escribir «neuro logo» encuentra
// «Neuropsicología y Logopedia», que es como la gente recuerda los titulos —por
// dos palabras, no por el nombre exacto ni por el orden—.
//
// Vive en `shared/` porque el mismo problema estaba en las CATEGORIAS de un
// producto (#2): cincuenta y pico rutas concatenadas en un desplegable sin
// busqueda. Era escribirlo otra vez o sacar este de su modulo.
//
// `nota` es el texto pequeño de la derecha —un precio, una ruta— y es opcional:
// no todas las listas tienen algo que decir ahi.

export interface Elegible {
  id: number;
  nombre: string;
  /** Lo pequeño de la derecha. Un precio, una ruta, lo que distinga. */
  nota?: string | number | null;
}

const euros = (n: string | number | undefined) =>
  n == null ? '' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export default function BuscadorEnLista({
  opciones, valor, onElegir, excluir = [], autoFocus = false, id,
  placeholder = 'Escribe para buscar…',
  comoDinero = false,
  sinResultados = 'Nada con «{texto}». Prueba con una palabra suelta.',
  // Lo que se dice cuando lo buscado SI existe pero esta excluido —porque ya
  // esta elegido, o ya lo tiene asignado—. Antes se decia «no hay ninguno», que
  // es mentira y manda a probar sinonimos de algo que la pantalla esta
  // enseñando. Diego, 14/09, con un curso desactivado de Tatiana delante.
  yaEstaFuera = '«{nombre}» ya está en la lista, por eso no sale aquí.',
}: {
  opciones: Elegible[];
  valor: number | null;
  onElegir: (id: number | null) => void;
  excluir?: number[];
  placeholder?: string;
  autoFocus?: boolean;
  /** El `id` del campo de búsqueda, para que la etiqueta de un `Field` lo enfoque. */
  id?: string;
  /** La nota es un importe y se formatea como tal. */
  comoDinero?: boolean;
  sinResultados?: string;
  yaEstaFuera?: string;
}) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const caja = useRef<HTMLDivElement>(null);

  const elegido = useMemo(() => opciones.find((c) => c.id === valor) || null, [opciones, valor]);

  // Cerrar al pulsar fuera: si no, la lista se queda abierta encima del resto
  // del formulario y tapa lo siguiente que hay que rellenar.
  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  // La busqueda, suelta de la lista: se usa dos veces --sobre lo disponible y
  // sobre lo excluido-- y repetirla era como se colaba la diferencia. El como
  // se compara es de `casaPorTrozos`, compartido con el resto de buscadores.
  const casa = useMemo(() => (c: Elegible) => casaPorTrozos(texto, c.nombre, c.nota), [texto]);

  const resultados = useMemo(
    () => opciones.filter((c) => !excluir.includes(c.id)).filter(casa).slice(0, 60),
    [opciones, excluir, casa],
  );

  // Lo que casa pero esta fuera. Es lo que hay que decir cuando no queda nada
  // que enseñar: el problema no es el nombre, es que ya lo tiene.
  const excluidoQueCasa = useMemo(
    () => (resultados.length ? null
      : opciones.filter((c) => excluir.includes(c.id)).find(casa) || null),
    [opciones, excluir, casa, resultados.length],
  );

  useEffect(() => { setResaltado(0); }, [texto]);

  function elegir(id: number) {
    onElegir(id);
    setTexto('');
    setAbierto(false);
  }

  if (elegido) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-muted/50 text-sm">
        <span className="flex-1 truncate">{elegido.nombre}</span>
        {elegido.nota != null && elegido.nota !== '' && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 truncate max-w-[45%]">
            {comoDinero ? euros(elegido.nota) : elegido.nota}
          </span>
        )}
        <button type="button" onClick={() => onElegir(null)} aria-label="Quitar"
          className="text-muted-foreground hover:text-foreground shrink-0">
          <X size={14} weight="bold" />
        </button>
      </div>
    );
  }

  return (
    <div ref={caja} className="relative">
      {/* Como `inputClass` (#106): el mismo fondo y el mismo foco que el resto de
          campos del formulario (la caja era blanca al lado de casillas grises). */}
      <div className="flex items-center gap-2 h-9 px-2.5 rounded-md border border-border bg-muted/50 transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 focus-within:bg-card">
        <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
        <input autoComplete="off"
          id={id}
          value={texto}
          autoFocus={autoFocus}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setResaltado((r) => Math.min(r + 1, resultados.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setResaltado((r) => Math.max(r - 1, 0)); }
            else if (e.key === 'Enter' && resultados[resaltado]) { e.preventDefault(); elegir(resultados[resaltado].id); }
            else if (e.key === 'Escape') setAbierto(false);
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none min-w-0"
        />
        {texto && (
          <button type="button" onClick={() => setTexto('')} aria-label="Limpiar"
            className="text-muted-foreground hover:text-foreground shrink-0">
            <X size={13} weight="bold" />
          </button>
        )}
      </div>

      {abierto && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-card border border-border rounded-md shadow-lg">
          {resultados.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">
              {excluidoQueCasa
                ? yaEstaFuera.replace('{nombre}', excluidoQueCasa.nombre).replace('{texto}', texto)
                : sinResultados.replace('{texto}', texto)}
            </p>
          ) : (
            <>
              {resultados.map((c, i) => (
                <button key={c.id} type="button" onMouseEnter={() => setResaltado(i)} onClick={() => elegir(c.id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm ${
                    i === resaltado ? 'bg-primary/10' : 'hover:bg-muted/50'
                  }`}>
                  <span className="flex-1 truncate">{c.nombre}</span>
                  {c.nota != null && c.nota !== '' && (
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 truncate max-w-[50%]">
                      {comoDinero ? euros(c.nota) : c.nota}
                    </span>
                  )}
                </button>
              ))}
              {/* Se enseñan los 60 primeros: con 787 cursos, pintarlos todos va
                  lento y nadie baja hasta el final — se afina escribiendo. */}
              {resultados.length === 60 && (
                <p className="px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border">
                  Hay más. Escribe otra palabra para afinar.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
