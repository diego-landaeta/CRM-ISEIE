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

/** La pregunta, con las palabras de la pantalla. */
export function textoDuplicada(otra: OtraFactura): string {
  return `Ya existe la factura ${otra.numero} de este cliente por el mismo importe el día `
    + `${fechaLegible(otra.fecha)}. ¿Emitir otra igualmente?`;
}

function importeLegible(n: number): string {
  return `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
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
        title="Posible factura duplicada"
        message={(
          <>
            <p>{textoDuplicada(otra)}</p>
            <p className="mt-2 text-xs">
              {otra.cliente ? `${otra.cliente} · ` : ''}{importeLegible(otra.importe)}
            </p>
          </>
        )}
        cancelLabel="Cancelar"
        confirmLabel="Emitir igualmente"
        onCancel={() => cerrar(false)}
        onConfirm={() => cerrar(true)}
      />,
    );
  });
}
