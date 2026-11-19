import * as React from 'react';
import { Link } from 'react-router-dom';
import { Info, Warning, CheckCircle, XCircle } from '@phosphor-icons/react';

/**
 * EL TEXTO DE UN TUTORIAL (Ayuda › Tutoriales, Diego 18/11).
 *
 * Los tutoriales se escriben en `contenido/*.md` con un Markdown pequeño, el mismo
 * en los dos CRM, y aquí se pintan con el estilo del CRM (nada del `estilo.css` de
 * las páginas sueltas). Lo que entiende, y nada más:
 *
 *   ## Título / ### Subtítulo
 *   1. paso numerado          - punto de una lista
 *   | tabla | con | cabecera |  (la segunda fila, la de los guiones, se salta)
 *   ![texto alternativo](captura.webp "pie de la captura")
 *   > [!aviso] nota           (también [!info], [!ok] y [!mal]; sin marca, info)
 *   **negrita**, `código` y [enlace](destino)
 *
 * Un enlace a `tutorial:<id>` abre otro tutorial; uno que empieza por `/`, una
 * pantalla del CRM; uno que empieza por `#`, un apartado del mismo tutorial.
 * Un párrafo puede seguir en la línea de abajo; un punto de lista también, si la
 * línea siguiente va sangrada.
 */

export type TipoNota = 'info' | 'aviso' | 'ok' | 'mal';

export type Bloque =
  | { t: 'h2' | 'h3'; texto: string; id: string }
  | { t: 'p'; texto: string }
  | { t: 'ol'; items: string[]; inicio: number }
  | { t: 'ul'; items: string[] }
  | { t: 'tabla'; cabecera: string[]; filas: string[][] }
  | { t: 'img'; archivo: string; alt: string; pie?: string }
  | { t: 'nota'; tipo: TipoNota; bloques: Bloque[] };

/** El ancla de un título: sin tildes, en minúsculas y con guiones. */
export const anclaDe = (texto: string) => texto
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[`*]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const celdas = (linea: string) => linea.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

const RE_OL = /^(\d+)\.\s+(.*)$/;
const RE_UL = /^[-*]\s+(.*)$/;
const RE_IMG = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/;
const RE_NOTA = /^\[!(info|aviso|ok|mal)\]\s*/;

/** El Markdown, en bloques. */
export function leerTexto(md: string): Bloque[] {
  const lineas = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Bloque[] = [];
  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i];
    const limpia = linea.trim();
    if (!limpia) { i += 1; continue; }

    const h = /^(#{2,3})\s+(.*)$/.exec(limpia);
    if (h) {
      const texto = h[2].trim();
      out.push({ t: h[1].length === 2 ? 'h2' : 'h3', texto, id: anclaDe(texto) });
      i += 1;
      continue;
    }

    const img = RE_IMG.exec(limpia);
    if (img) {
      out.push({ t: 'img', alt: img[1], archivo: img[2], pie: img[3] });
      i += 1;
      continue;
    }

    if (limpia.startsWith('>')) {
      const dentro: string[] = [];
      while (i < lineas.length && lineas[i].trim().startsWith('>')) {
        dentro.push(lineas[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const marca = RE_NOTA.exec(dentro[0] || '');
      if (marca) dentro[0] = dentro[0].slice(marca[0].length);
      out.push({ t: 'nota', tipo: (marca?.[1] as TipoNota) || 'info', bloques: leerTexto(dentro.join('\n')) });
      continue;
    }

    if (limpia.startsWith('|')) {
      const filas: string[][] = [];
      while (i < lineas.length && lineas[i].trim().startsWith('|')) {
        const l = lineas[i].trim();
        if (!/^\|[\s:|-]+\|$/.test(l)) filas.push(celdas(l));
        i += 1;
      }
      const [cabecera = [], ...resto] = filas;
      out.push({ t: 'tabla', cabecera, filas: resto });
      continue;
    }

    const esOl = RE_OL.exec(limpia);
    const esUl = RE_UL.exec(limpia);
    if (esOl || esUl) {
      const re = esOl ? RE_OL : RE_UL;
      const items: string[] = [];
      while (i < lineas.length) {
        const l = lineas[i];
        const m = re.exec(l.trim());
        if (m && !/^\s{2,}/.test(l)) { items.push(esOl ? m[2] : m[1]); i += 1; continue; }
        // Sigue el punto anterior: una línea sangrada que no abre otra cosa.
        if (items.length && /^\s{2,}\S/.test(l)) { items[items.length - 1] += ` ${l.trim()}`; i += 1; continue; }
        break;
      }
      out.push(esOl ? { t: 'ol', items, inicio: Number(esOl[1]) } : { t: 'ul', items });
      continue;
    }

    // Un párrafo: hasta la línea en blanco o hasta que empiece otra cosa.
    const partes: string[] = [];
    while (i < lineas.length) {
      const l = lineas[i].trim();
      if (!l || /^(#{2,3}\s|>|\||!\[)/.test(l) || RE_OL.test(l) || RE_UL.test(l)) break;
      partes.push(l);
      i += 1;
    }
    out.push({ t: 'p', texto: partes.join(' ') });
  }
  return out;
}

/** Adónde lleva un enlace del texto. */
export function destinoDe(destino: string): { tipo: 'tutorial' | 'pantalla' | 'ancla' | 'fuera'; a: string } {
  if (destino.startsWith('tutorial:')) {
    const [id, ancla] = destino.slice('tutorial:'.length).split('#');
    return { tipo: 'tutorial', a: `/manual/tutoriales/${id}${ancla ? `#${ancla}` : ''}` };
  }
  if (destino.startsWith('/')) return { tipo: 'pantalla', a: destino };
  if (destino.startsWith('#')) return { tipo: 'ancla', a: destino };
  return { tipo: 'fuera', a: destino };
}

const RE_EN_LINEA = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/** Negrita, código y enlaces dentro de una línea. */
export function EnLinea({ texto }: { texto: string }) {
  const trozos = texto.split(RE_EN_LINEA).filter((t) => t !== '');
  return (
    <>
      {trozos.map((t, n) => {
        if (t.startsWith('**') && t.endsWith('**') && t.length > 4) {
          return <strong key={n} className="font-semibold text-foreground"><EnLinea texto={t.slice(2, -2)} /></strong>;
        }
        if (t.startsWith('`') && t.endsWith('`') && t.length > 2) {
          return <code key={n} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">{t.slice(1, -1)}</code>;
        }
        const enlace = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
        if (enlace) {
          const d = destinoDe(enlace[2]);
          const clase = 'font-medium text-primary underline underline-offset-2 hover:no-underline';
          if (d.tipo === 'fuera') {
            return <a key={n} href={d.a} target="_blank" rel="noopener noreferrer" className={clase}>{enlace[1]}</a>;
          }
          if (d.tipo === 'ancla') return <a key={n} href={d.a} className={clase}>{enlace[1]}</a>;
          return <Link key={n} to={d.a} className={clase} data-tutorial-enlace={enlace[2]}>{enlace[1]}</Link>;
        }
        return <React.Fragment key={n}>{t}</React.Fragment>;
      })}
    </>
  );
}

const NOTAS: Record<TipoNota, { icono: React.ElementType; borde: string; color: string; nombre: string }> = {
  info: { icono: Info, borde: 'border-l-primary', color: 'text-primary', nombre: 'Nota' },
  aviso: { icono: Warning, borde: 'border-l-amber-500', color: 'text-amber-500', nombre: 'Atención' },
  ok: { icono: CheckCircle, borde: 'border-l-emerald-500', color: 'text-emerald-500', nombre: 'Bien' },
  mal: { icono: XCircle, borde: 'border-l-destructive', color: 'text-destructive', nombre: 'Cuidado' },
};

function Bloques({ bloques, imagenes, enNota = false }: {
  bloques: Bloque[];
  imagenes: Record<string, string>;
  enNota?: boolean;
}) {
  const texto = enNota ? 'text-[13.5px] leading-relaxed text-foreground/85' : 'text-[14.5px] leading-7 text-muted-foreground';
  return (
    <>
      {bloques.map((b, n) => {
        switch (b.t) {
          case 'h2':
            return (
              <h2 key={n} id={b.id} className="scroll-mt-6 mt-10 mb-3 border-t border-border pt-6 text-xl font-bold tracking-tight text-foreground first:mt-0 first:border-t-0 first:pt-0">
                <EnLinea texto={b.texto} />
              </h2>
            );
          case 'h3':
            return (
              <h3 key={n} id={b.id} className="scroll-mt-6 mt-6 mb-2 text-base font-semibold tracking-tight text-foreground">
                <EnLinea texto={b.texto} />
              </h3>
            );
          case 'p':
            return <p key={n} className={`${texto} mb-3 last:mb-0`}><EnLinea texto={b.texto} /></p>;
          case 'ol':
            return (
              <ol key={n} start={b.inicio} className={`${texto} mb-3 list-decimal space-y-1.5 pl-6 marker:font-semibold marker:text-foreground/60`}>
                {b.items.map((it, k) => <li key={k} className="pl-1"><EnLinea texto={it} /></li>)}
              </ol>
            );
          case 'ul':
            return (
              <ul key={n} className={`${texto} mb-3 list-disc space-y-1.5 pl-6 marker:text-foreground/40`}>
                {b.items.map((it, k) => <li key={k} className="pl-1"><EnLinea texto={it} /></li>)}
              </ul>
            );
          case 'tabla':
            return (
              <div key={n} className="my-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-[13px]">
                  <thead className="bg-muted/50">
                    <tr>
                      {b.cabecera.map((c, k) => (
                        <th key={k} scope="col" className="border-b border-border px-3 py-2 text-left font-semibold text-foreground align-bottom">
                          <EnLinea texto={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.filas.map((f, k) => (
                      <tr key={k} className="border-b border-border last:border-b-0">
                        {f.map((c, j) => (
                          <td key={j} className="px-3 py-2 align-top leading-relaxed text-muted-foreground">
                            <EnLinea texto={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'img': {
            const src = imagenes[b.archivo];
            if (!src) return null;
            return (
              <figure key={n} className="my-5">
                <img
                  src={src}
                  alt={b.alt}
                  loading="lazy"
                  className="block h-auto max-w-full rounded-lg border border-border shadow-sm"
                />
                {b.pie && <figcaption className="mt-2 text-xs text-muted-foreground"><EnLinea texto={b.pie} /></figcaption>}
              </figure>
            );
          }
          case 'nota': {
            const cfg = NOTAS[b.tipo];
            const Icono = cfg.icono;
            return (
              <aside key={n} aria-label={cfg.nombre} data-nota={b.tipo} className={`my-4 flex gap-3 rounded-r-lg border-l-4 bg-muted/30 p-4 ${cfg.borde}`}>
                <Icono size={16} weight="fill" className={`mt-0.5 shrink-0 ${cfg.color}`} aria-hidden="true" />
                <div className="min-w-0 flex-1"><Bloques bloques={b.bloques} imagenes={imagenes} enNota /></div>
              </aside>
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}

/** Un tutorial entero, pintado. `imagenes`: el nombre del fichero → su dirección. */
export default function TextoTutorial({ md, imagenes }: { md: string; imagenes: Record<string, string> }) {
  const bloques = React.useMemo(() => leerTexto(md), [md]);
  return <div className="max-w-3xl"><Bloques bloques={bloques} imagenes={imagenes} /></div>;
}
