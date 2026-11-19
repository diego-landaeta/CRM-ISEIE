import { CheckCircle, Copy, ArrowSquareOut, WarningCircle, LinkSimple } from '@phosphor-icons/react';
import { copiarLink } from './CrearLinkAsistente';
import type { CuotaDelPlan, LinkDePago } from '../api/linksPago.api';

/*
  LOS LINKS QUE SE ACABAN DE GENERAR AL REGISTRAR LA VENTA (Diego, 19/11/2026:
  «la idea es que puedas crear el enlace de pago aquí… y que la venta diga generar
  enlace de pago y puedas consultarlo si necesita volverlo a buscar»).

  Sale en «Venta registrada»: el link (pago único) o uno por cuota (plan de pago),
  cada uno con «Copiar» y «Abrir», y «Copiar todos» con el mensaje para el alumno.
  Después siguen en la ficha de la venta y en la del prospecto («Links de pago»).
*/
export interface ResultadoLinks {
  link?: LinkDePago | null;
  cuotas?: CuotaDelPlan[];
  error?: string | null;
}

function dinero(n: unknown) {
  return `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
function fecha(d: string | null | undefined) {
  if (!d) return 'sin fecha';
  const [a, m, dia] = String(d).slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
}

export default function LinksRecienCreados({ resultado, alumno, curso, onVerVenta }: {
  resultado: ResultadoLinks;
  alumno?: string | null;
  curso?: string | null;
  onVerVenta?: () => void;
}) {
  if (resultado.error) {
    return (
      <div className="text-left rounded-lg border border-destructive/40 bg-destructive-soft px-3 py-2.5" role="alert" data-recorrido="venta-links-error">
        <p className="text-sm font-semibold text-destructive flex items-center gap-1.5">
          <WarningCircle size={15} weight="fill" aria-hidden="true" /> La venta está registrada, pero el link no se ha podido crear
        </p>
        <p className="mt-0.5 text-[13px] text-destructive">{resultado.error}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Puedes crearlo desde la ficha de la venta: «Crear link de pago» o «Generar plan de pago».</p>
      </div>
    );
  }
  const filas = resultado.cuotas?.length
    ? resultado.cuotas.filter((c) => c.link_url).map((c) => ({ clave: `c${c.id}`, titulo: `Cuota ${c.numero} · ${dinero(c.importe)}`, sub: `Vence el ${fecha(c.vence)}`, url: c.link_url as string }))
    : resultado.link?.url
      ? [{ clave: `l${resultado.link.id}`, titulo: `Pago de ${dinero(resultado.link.importe)}`, sub: `Caduca el ${fecha(resultado.link.caduca_el)}`, url: resultado.link.url }]
      : [];
  if (!filas.length) return null;

  const copiarTodos = () => {
    const lineas = filas.map((f) => `· ${f.titulo} (${f.sub.toLowerCase()}): ${f.url}`);
    copiarLink([`Hola${alumno ? `, ${alumno}` : ''}. ${filas.length > 1 ? 'Estos son los links' : 'Este es el link'} de pago de tu ${curso || 'programa'}:`, ...lineas].join('\n'));
  };

  return (
    <div className="text-left rounded-lg border border-success/30 bg-success-soft/40 p-3 space-y-2" data-recorrido="venta-links-creados">
      <p className="text-sm font-semibold flex items-center gap-1.5 text-success-soft-foreground">
        <CheckCircle size={15} weight="fill" aria-hidden="true" />
        {filas.length > 1 ? `${filas.length} links de pago creados, uno por cuota` : 'Link de pago creado'}
      </p>
      <ul className="space-y-1.5">
        {filas.map((f) => (
          <li key={f.clave} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{f.titulo}</p>
              <p className="text-[11px] text-muted-foreground">{f.sub}</p>
            </div>
            <button type="button" onClick={() => copiarLink(f.url)}
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-card text-[11px] font-medium hover:bg-muted">
              <Copy size={12} weight="bold" aria-hidden="true" /> Copiar
            </button>
            <a href={f.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border bg-card text-[11px] font-medium hover:bg-muted">
              <ArrowSquareOut size={12} weight="bold" aria-hidden="true" /> Abrir
            </a>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copiarTodos}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">
          <LinkSimple size={13} weight="bold" aria-hidden="true" /> {filas.length > 1 ? 'Copiar todos para el alumno' : 'Copiar para el alumno'}
        </button>
        {onVerVenta && (
          <button type="button" onClick={onVerVenta} className="text-xs underline text-muted-foreground hover:text-foreground">
            Verlos en la venta
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">Quedan guardados en la ficha de la venta y en la del prospecto («Links de pago»).</p>
    </div>
  );
}
