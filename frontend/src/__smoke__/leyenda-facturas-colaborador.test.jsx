// @vitest-environment jsdom
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import LeyendaFacturas, { ACCION, EXPLICA_ESTADO } from '@/modules/facturas-colaborador/components/LeyendaFacturas';
import { ESTADO } from '@/modules/facturas-colaborador/api/facturasColaborador.api';

/**
 * #586 (Diego, 31/10): «una leyenda para ver qué significa cada cosa» en Facturas de
 * colaboradores. Los botones solo se explicaban al pasar el ratón; en el móvil, nada.
 * Y «Marcar pagada» era una «€» con facturas en dólares.
 */
afterEach(cleanup);

const fuente = (ruta) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');

describe('la leyenda de Facturas de colaboradores', () => {
  it('explica todos los estados que existen en ESTADO, con su píldora', () => {
    render(<LeyendaFacturas />);
    const leyenda = screen.getByTestId('leyenda-facturas');
    expect(Object.keys(EXPLICA_ESTADO).sort()).toEqual(Object.keys(ESTADO).sort());
    for (const [clave, { rotulo }] of Object.entries(ESTADO)) {
      expect(within(leyenda).getByText(rotulo)).toBeTruthy();
      expect(within(leyenda).getByText(EXPLICA_ESTADO[clave])).toBeTruthy();
    }
    // Las otras marcas de la fila.
    for (const m of ['Por pagar', 'No cuadra', 'PDF sin leer']) expect(within(leyenda).getByText(m)).toBeTruthy();
  });

  it('explica todos los botones de la fila', () => {
    render(<LeyendaFacturas />);
    const leyenda = screen.getByTestId('leyenda-facturas');
    for (const { rotulo } of Object.values(ACCION)) expect(within(leyenda).getByText(rotulo)).toBeTruthy();
  });

  it('la columna Enlace solo se explica donde está («Del mes»)', () => {
    render(<LeyendaFacturas />);
    expect(screen.queryByText(/Columna Enlace/)).toBeNull();
    cleanup();
    render(<LeyendaFacturas conEnlace />);
    expect(screen.getByText(/Columna Enlace/)).toBeTruthy();
  });

  it('cada botón de las filas usa un icono de la leyenda, y el pago ya no es una «€»', () => {
    // «Del mes» tiene los 7 botones; las pestañas (Enviadas, Por pagar…), 5: sin reenviar ni anular.
    for (const [ruta, cuantos] of [['../modules/facturas-colaborador/pages/FacturasColaboradoresPage.tsx', 7], ['../modules/facturas-colaborador/components/ListaDeFacturas.tsx', 5]]) {
      const s = fuente(ruta);
      expect(s).not.toMatch(/CurrencyEur/);
      // Cada botón con título de la fila de una factura dibuja su icono desde ACCION.
      const botones = [...s.matchAll(/title="(Ver el archivo|Ver el registro|Reenviar el enlace|Marcar pagada|Ver el justificante|Deshacer el pago|Anular)"[^\n]*\n?[^\n]*?<([A-Za-z.]+) size=\{15\}/g)];
      expect(botones.length).toBe(cuantos);
      for (const [, titulo, icono] of botones) {
        const clave = Object.keys(ACCION).find((k) => ACCION[k].rotulo === titulo);
        expect(icono, titulo).toBe(`ACCION.${clave}.Icono`);
      }
      expect(s).toMatch(/<LeyendaFacturas/);
    }
  });
});
