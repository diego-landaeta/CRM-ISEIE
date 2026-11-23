import { createRoot } from 'react-dom/client';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';

/**
 * «Ya existe la factura X de este cliente…» (CRM#819, gemela CRM-ISEIE#500).
 *
 * 17/11/2026, ISEIE: una factura emitida dos veces para el mismo cobro y el
 * mismo cliente, con el nombre cambiado solo por un espacio. Ahora el servidor
 * no la emite si ya hay otra del mismo cliente (nombre normalizado o NIF), por
 * el mismo importe y a 7 días o menos: contesta 409 `POSIBLE_DUPLICADA` con la
 * otra factura. Aquí se pregunta, y con un sí se vuelve a mandar con
 * `confirmar_duplicada: true`.
 */

export type OtraFactura = {
  id?: number;
  numero: string;
  fecha: string;
  importe: number;
  cliente?: string | null;
  nif?: string | null;
  /** En qué se parece a la que se va a emitir: misma venta, mismo NIF o mismo nombre. */
  coincide?: 'venta' | 'nif' | 'nombre' | null;
};

type Cuerpo = { code?: string; data?: { otra?: OtraFactura } };

/** La otra factura, si la respuesta (o el error) es este aviso; si no, null. */
export function posibleDuplicada(x: unknown): OtraFactura | null {
  const e = (x || {}) as Cuerpo & { data?: Cuerpo };
  // Como error, el cuerpo de la respuesta viene en `data`; como respuesta, es él.
  const cuerpo: Cuerpo = e.data && typeof e.data === 'object' && 'code' in e.data ? (e.data as Cuerpo) : e;
  if (cuerpo.code !== 'POSIBLE_DUPLICADA') return null;
  return cuerpo.data?.otra || { numero: '—', fecha: '', importe: 0 };
}

/** AAAA-MM-DD → DD/MM/AAAA. */
export function fechaLegible(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

function importeLegible(n: number): string {
  return `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/*
  Ana (CEDIA), 20/11/2026: «me salía que el número 296 ya estaba asignado». Era
  este aviso, contra la factura de OTRA clienta del mismo diplomado, y decía
  «ya existe la factura 2026/0296 de este cliente». Ahora dice de quién es la
  otra y en qué se parece, y el botón dice lo que hace. Sigue frenando: puede
  ser una cuota legítima, pero mejor mirarlo (Diego, 23/11).
*/

/** De quién es la otra factura. */
export function tituloDuplicada(otra: OtraFactura): string {
  return `Posible duplicada de la factura ${otra.numero}${otra.cliente ? ` de ${otra.cliente}` : ''}`;
}

/** En qué se parece. */
export function porQueSeParece(otra: OtraFactura): string {
  if (otra.coincide === 'venta') return 'es de la misma venta';
  if (otra.coincide === 'nif') return `tiene el mismo NIF${otra.nif ? ` (${otra.nif})` : ''}`;
  if (otra.coincide === 'nombre') return 'tiene el mismo nombre de cliente';
  return 'parece del mismo cliente';
}

/** La explicación entera, en una frase. */
export function textoDuplicada(otra: OtraFactura): string {
  return `${tituloDuplicada(otra)} (${importeLegible(otra.importe)}, ${fechaLegible(otra.fecha)}): `
    + `mismo importe, a 7 días o menos, y ${porQueSeParece(otra)}.`;
}

/**
 * Abre el diálogo y espera la respuesta: true con «Emitir igualmente», false
 * con «Cancelar» (o Escape, o clic fuera). Se monta solo, encima de lo que
 * haya, para que cualquier botón que emite lo pueda usar sin cambiar su pantalla.
 */
export function preguntarSiEmitirDuplicada(otra: OtraFactura): Promise<boolean> {
  return new Promise((resolve) => {
    const caja = document.createElement('div');
    document.body.appendChild(caja);
    const raiz = createRoot(caja);
    let hecho = false;
    const cerrar = (si: boolean) => {
      if (hecho) return;
      hecho = true;
      resolve(si);
      // Fuera del clic: desmontar una raíz mientras React atiende su evento avisa.
      setTimeout(() => { raiz.unmount(); caja.remove(); }, 0);
    };
    raiz.render(
      <ConfirmDialog
        open
        tone="warning"
        title={tituloDuplicada(otra)}
        message={(
          <>
            <p>
              La factura {otra.numero} es de <strong>{otra.cliente || 'sin nombre'}</strong>,
              por {importeLegible(otra.importe)}, del {fechaLegible(otra.fecha)}.
            </p>
            <p className="mt-2">
              La que vas a emitir tiene el mismo importe, va a 7 días o menos y {porQueSeParece(otra)}.
            </p>
            <p className="mt-2 text-xs">
              Si es otra (otra venta u otra cuota), emítela. Si es la misma, cancela.
            </p>
          </>
        )}
        cancelLabel="Cancelar, es la misma"
        confirmLabel="Es otra, emitir igualmente"
        onCancel={() => cerrar(false)}
        onConfirm={() => cerrar(true)}
      />,
    );
  });
}
