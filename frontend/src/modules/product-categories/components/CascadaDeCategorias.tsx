import { useEffect, useState } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import Select from '@/shared/components/ui/Select';
import BuscadorEnLista from '@/shared/components/ui/BuscadorEnLista';
import client from '@/shared/api/client';
import {
  type CatPlana, caminoHasta, hijosDe, nivelesDe, rutaEnTexto,
} from '../lib/arbol';

/**
 * Elegir una categoría bajando por el árbol, o escribiendo (#2).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LAS DOS FORMAS, PORQUE SON DOS PERSONAS DISTINTAS
 *
 * Quien ya sabe cómo se llama escribe «adicc» y llega en dos teclas. Quien no
 * lo sabe —alguien nuevo, o dando de alta algo que no encaja claro— necesita
 * ver qué ramas hay y bajar. El desplegable viejo no servía para ninguna de las
 * dos: cincuenta y pico rutas concatenadas, sin buscador y sin estructura.
 *
 * Elegir por arriba rellena la cascada, y bajar por la cascada actualiza lo de
 * arriba. Es un solo valor visto de dos maneras, no dos campos.
 *
 * SE PUEDE PARAR A MEDIA RAMA
 *
 * Un producto puede ser de «Cursos › Para Profesionales» sin bajar más. Por eso
 * cada nivel tiene su «—»: vaciar el nivel 3 deja elegido el 2, no lo borra
 * todo. El valor es siempre el nodo más hondo que haya elegido.
 *
 * SI LA CATEGORIA GUARDADA NO ESTA EN LA LISTA, SE DICE
 *
 * `listByProject` no devuelve las desactivadas. Un producto que apunta a una
 * puede pintarse con la cascada vacía —como si no tuviera categoría— y al
 * guardar se pierde el dato sin que nadie lo note. Aquí se detecta, se va a
 * buscar el nombre a `/:id/ancestors` y se avisa en pantalla con el botón de
 * quitarla, que es la única forma de que se pierda a propósito.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export default function CascadaDeCategorias({
  categorias, valor, onCambiar, deshabilitado = false,
}: {
  categorias: CatPlana[];
  valor: number | null;
  onCambiar: (id: number | null) => void;
  deshabilitado?: boolean;
}) {
  // La categoría está guardada pero no viene en la lista. Se guarda su ruta
  // para poder enseñarla; `null` mientras no se sepa.
  const [huerfana, setHuerfana] = useState<string | null>(null);

  const seEncuentra = valor != null && caminoHasta(categorias, valor).length > 0;
  const faltaDeLaLista = valor != null && categorias.length > 0 && !seEncuentra;

  useEffect(() => {
    if (!faltaDeLaLista) { setHuerfana(null); return; }
    let cancelado = false;
    // El unico sitio donde `/ancestors` aporta algo que la lista ya cargada no
    // tiene: precisamente cuando la categoria NO esta en esa lista.
    (async () => {
      try {
        const r = await client.get(`/product-categories/${valor}/ancestors`);
        const ruta = Array.isArray(r.data)
          ? r.data.map((c: { nombre: string }) => c.nombre).join(' › ')
          : '';
        if (!cancelado) setHuerfana(ruta || `categoría #${valor}`);
      } catch {
        // Ni el nombre se pudo traer. Se avisa igual con el número: enseñar
        // menos es mejor que enseñar la cascada vacía y que parezca que no
        // tiene categoría.
        if (!cancelado) setHuerfana(`categoría #${valor}`);
      }
    })();
    return () => { cancelado = true; };
  }, [faltaDeLaLista, valor]);

  const niveles = nivelesDe(categorias, seEncuentra ? valor : null);

  /** Todas, con su ruta, para el buscador de arriba. */
  const paraBuscar = categorias
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      // La ruta va en la nota, no en el nombre: hay varias «Adicciones» en
      // ramas distintas y sin ella no se sabe cuál es. Pero se busca por el
      // nombre, que es como la gente las recuerda.
      nota: (() => {
        const r = rutaEnTexto(categorias, c.id);
        return r === c.nombre ? null : r.replace(` › ${c.nombre}`, '');
      })(),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  /**
   * Cambio en el selector del nivel `i`.
   *
   * Vaciarlo no borra la categoría entera: deja elegido el nivel de encima,
   * que es lo que la persona acaba de ver en pantalla. Borrarlo todo desde el
   * nivel 4 sería tirar tres decisiones que nadie pidió tirar.
   */
  function enNivel(i: number, id: number | null) {
    if (id != null) { onCambiar(id); return; }
    onCambiar(i === 0 ? null : (niveles[i - 1] ?? null));
  }

  return (
    <div className="space-y-2">
      <BuscadorEnLista
        opciones={paraBuscar}
        valor={seEncuentra ? valor : null}
        onElegir={(id) => onCambiar(id)}
        placeholder="Escribe para buscar una categoría…"
        sinResultados="Ninguna categoría con «{texto}»."
      />

      {faltaDeLaLista && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200/60 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2 text-[11px]">
          <WarningCircle size={14} weight="fill" className="text-amber-600 shrink-0 mt-px" />
          <span className="flex-1">
            Este producto está en <strong>{huerfana || 'una categoría'}</strong>, que ya no sale en
            la lista —normalmente porque se desactivó—. Se mantiene tal cual si no la tocas.
            <button
              type="button"
              onClick={() => onCambiar(null)}
              className="ml-1.5 underline font-semibold hover:no-underline"
            >
              Quitar la categoría
            </button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {niveles.map((elegido, i) => {
          const padre = i === 0 ? null : niveles[i - 1];
          const opciones = hijosDe(categorias, padre ?? null);
          if (!opciones.length) return null;
          return (
            <div key={`${i}-${padre ?? 'raiz'}`}>
              <label className="text-[11px] font-medium text-muted-foreground">
                Categoría {i + 1}
              </label>
              <Select<string>
                value={elegido != null ? String(elegido) : ''}
                onChange={(v) => enNivel(i, v ? Number(v) : null)}
                options={[
                  { value: '', label: i === 0 ? 'Sin categoría' : '—' },
                  ...opciones.map((c) => ({ value: String(c.id), label: c.nombre })),
                ]}
                ariaLabel={`Categoría ${i + 1}`}
                disabled={deshabilitado}
              />
            </div>
          );
        })}
      </div>

      {seEncuentra && (
        <p className="text-[11px] text-muted-foreground">
          {rutaEnTexto(categorias, valor)}
        </p>
      )}
    </div>
  );
}
