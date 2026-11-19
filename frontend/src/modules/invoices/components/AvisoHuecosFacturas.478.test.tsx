// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  ISEIE#478 (gemela de CRM#793) · Una factura emitida no se borra ni se cambia: se anula con su
  motivo. En la numeración se ve el aviso de que falta un número, y las
  anuladas con su motivo, para que el hueco quede explicado.
*/

const get = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { get: (...a: unknown[]) => get(...a) } }));

const { default: AvisoHuecosFacturas } = await import('./AvisoHuecosFacturas');
const { esFacturaEmitida } = await import('../api/invoices.api');

const ANULADA = { numero: 1, codigo: '2026/0001', motivo: 'Cliente equivocado', fecha: '2026-11-18' };
const responde = (data: object) => get.mockResolvedValue({ success: true, data: { ano: 2026, serie: 'CEDIA', siguiente: 5, codigo: '2026/0005', ...data } });
const pinta = () => render(<MemoryRouter><AvisoHuecosFacturas projectId={7} /></MemoryRouter>);

beforeEach(() => { get.mockReset(); });
// Sin globals de vitest, testing-library no limpia sola entre pruebas.
afterEach(() => { cleanup(); });

describe('#793 · el aviso de la numeración', () => {
  it('dice el número que falta y, aparte, la anulada con su motivo', async () => {
    responde({ huecos: [3], anuladas: [ANULADA] });
    pinta();
    expect(await screen.findByText(/Falta una factura por emitir en la serie CEDIA/)).toBeTruthy();
    expect(screen.getByText('2026/0003')).toBeTruthy();
    expect(screen.getByText(/no son huecos/)).toBeTruthy();
    expect(screen.getByText(/anulada: Cliente equivocado/)).toBeTruthy();
  });

  it('sin huecos, las anuladas se dicen igual', async () => {
    responde({ huecos: [], anuladas: [ANULADA] });
    pinta();
    expect(await screen.findByText(/Una factura anulada en la serie CEDIA/)).toBeTruthy();
    expect(screen.getByText(/anulada: Cliente equivocado/)).toBeTruthy();
    expect(screen.queryByText(/Falta una factura/)).toBeNull();
  });

  it('sin huecos ni anuladas, nada', async () => {
    responde({ huecos: [], anuladas: [] });
    const { container } = pinta();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
});

describe('#793 · qué es una factura emitida', () => {
  it('con número y ni borrador ni proforma: emitida (no se borra ni se cambia)', () => {
    expect(esFacturaEmitida({ tipo: 'normal', estado: 'pagada', numero: 12 })).toBe(true);
    expect(esFacturaEmitida({ tipo: 'rectificativa', estado: 'emitida', numero: 3 })).toBe(true);
  });

  it('un borrador o una proforma, no: se siguen editando y borrando', () => {
    expect(esFacturaEmitida({ tipo: 'normal', estado: 'borrador', numero: null })).toBe(false);
    expect(esFacturaEmitida({ tipo: 'proforma', estado: 'emitida', numero: 32 })).toBe(false);
  });
});
