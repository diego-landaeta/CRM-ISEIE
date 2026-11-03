// @vitest-environment jsdom
// La misma prueba que en MultiCRM (frontend/src/test/), traída con el módulo (#202, paridad 15/10).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SubirFactura from '@/modules/facturas-colaborador/components/SubirFactura';

/**
 * #202, segunda parte · lo acordado y el desglose. Lo acordado es la base: en el
 * ejemplo de Diego, 600 acordados con 21 % de IVA y 15 % de IRPF son 636 de total.
 * Antes el importe venía con 600 y se comparaba con los dos: avisaba siempre,
 * aunque la factura estuviera bien.
 */

const factura = (extra) => ({
  estado: 'abierto', periodo: '2026-09', mes: 'septiembre de 2026', colaborador: 'Laura',
  empresa: { razon_social: 'CEDIA Investigación y Desarrollo SL', nif: 'B1', direccion: null, cp: null, ciudad: null, pais: null, logo_url: null },
  importe_acordado: 600, caduca_at: null, recibida: null, pago: null, ...extra,
});
const cobro = (extra) => ({ iva_pct: 21, irpf_pct: 15, importe_fijo: null, tarifa_hora: null, concepto: 'Servicios de SEO · septiembre 2026', ...extra });
const abrir = (f) => render(<SubirFactura factura={f} alSubir={vi.fn()} />);
const importe = () => screen.getByLabelText(/Importe de tu factura/);

// Sin `globals` en vitest, Testing Library no limpia sola entre pruebas.
afterEach(cleanup);

describe('subir la factura · lo acordado y el desglose', () => {
  it('fijo 600 con IVA e IRPF: viene con el total (636,00) y sin ningún aviso', () => {
    abrir(factura({ cobro: cobro({ modalidad: 'fijo', importe_fijo: 600 }) }));
    expect(importe().value).toBe('636,00');
    expect(screen.queryByText(/no coincide con lo acordado/)).toBeNull();
    expect(screen.queryByText(/no cuadra/)).toBeNull();
  });

  it('por hora: el importe sigue a las horas; si la base no es lo acordado, se hace notar', () => {
    abrir(factura({ importe_acordado: 250, cobro: cobro({ modalidad: 'hora', tarifa_hora: 21.7 }) }));
    fireEvent.change(screen.getByLabelText('Horas del mes'), { target: { value: '5' } });
    expect(importe().value).toBe('115,01');
    expect(screen.getByText(/La base de tu desglose \(108,50 €\) no coincide con lo acordado \(250,00 €\)/)).toBeTruthy();
    expect(screen.queryByText(/no cuadra/)).toBeNull();
  });

  it('si lo cambia a mano, se queda lo suyo y solo se le recuerda cuánto da el desglose (sin «no cuadra»)', () => {
    // Desde el 13/10 cuadra si lo escrito es lo que pone el PDF: el desglose es una sugerencia.
    abrir(factura({ cobro: cobro({ modalidad: 'fijo', importe_fijo: 600 }) }));
    fireEvent.change(importe(), { target: { value: '600' } });
    expect(importe().value).toBe('600');
    expect(screen.getByText(/Tu desglose da 636,00 €\. Escribe el total que pone tu factura/)).toBeTruthy();
    expect(screen.queryByText(/no cuadra/i)).toBeNull();
  });

  it('con desglose y sin horas todavía: no dice «ya puesto», y ninguna casilla lleva una cifra de ejemplo', () => {
    // Prueba a mano del 12/10: salía un «600,00» gris (a Pedro le acordaron 300) y «Ya puesto el total…» sin total.
    abrir(factura({ importe_acordado: 300, cobro: cobro({ modalidad: 'hora', tarifa_hora: 22 }) }));
    expect(importe().value).toBe('');
    expect(importe().placeholder).toBe('Escribe el importe de tu factura');
    expect(screen.getByLabelText(/Número de tu factura/).placeholder).toBe('Escribe el número de tu factura');
    expect(screen.getByText('Se rellena solo con el total de tu desglose')).toBeTruthy();
    expect(screen.queryByText(/Ya está puesto/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Horas del mes'), { target: { value: '18' } });
    expect(importe().value).toBe('419,76');
    expect(screen.getByText(/Ya está puesto el total de tu desglose/)).toBeTruthy();
  });

  it('con algo puesto, recargar o cerrar la página avisa antes; sin nada, no molesta', () => {
    // Prueba a mano del 12/10: al recargar se perdía todo sin aviso.
    abrir(factura({ cobro: cobro({ modalidad: 'fijo', importe_fijo: 600 }) }));
    const recargar = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    // El importe lo puso el CRM (636,00): eso solo no cuenta.
    expect(recargar()).toBe(false);
    fireEvent.change(screen.getByLabelText(/Número de tu factura/), { target: { value: 'F-1' } });
    expect(recargar()).toBe(true);
  });

  it('una vez recibida, recargar ya no avisa (aunque quede lo que se puso)', () => {
    // Prueba a mano del 12/10: tras «Factura recibida», F5 seguía preguntando.
    const f = factura({ cobro: cobro({ modalidad: 'fijo', importe_fijo: 600 }) });
    const { rerender } = render(<SubirFactura factura={f} alSubir={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Número de tu factura/), { target: { value: 'F-1' } });
    const recargar = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(recargar()).toBe(true);
    rerender(<SubirFactura factura={{ ...f, estado: 'recibida', recibida: { subida_at: '2026-10-12T15:29:00Z', numero_recepcion: 'REC-2026-09-0001', importe: 636, numero_factura: 'F-1', archivo: 'f.pdf', total: 636, cuadra: true } }} alSubir={vi.fn()} />);
    expect(recargar()).toBe(false);
  });

  it('sin desglose, como en la primera parte: con lo acordado ya puesto', () => {
    abrir(factura({ cobro: null }));
    expect(importe().value).toBe('600');
    fireEvent.change(importe(), { target: { value: '650' } });
    expect(screen.getByText(/El importe no coincide con lo acordado \(600,00 €\)/)).toBeTruthy();
  });

  it('dice hasta qué día se puede subir (Diego, 30/10): caduca el 06/11 a las 00:00 de Madrid, se sube hasta el 05/11', () => {
    abrir(factura({ cobro: null, caduca_at: '2026-11-05T23:00:00.000Z' }));
    // Con el texto entero del párrafo: React lo parte en varios trozos.
    const aviso = screen.getByText((_, el) => el?.tagName === 'P' && /Puedes subirla hasta el/.test(el.textContent || ''));
    expect(aviso.textContent).toMatch(/Puedes subirla hasta el 0?5\/11\.$/);
  });
});
