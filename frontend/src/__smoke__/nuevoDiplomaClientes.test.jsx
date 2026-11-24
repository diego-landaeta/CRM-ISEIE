// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Nuevo diploma» no encontraba a los clientes (Diego, 24/11: «varias personas no
 * aparecen para emitir los certificados en varios campus»): buscaba en Prospectos, que
 * esconde a quien tiene una venta. Ahora pide primero los clientes y luego el resto.
 */
const get = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => get(...a) }, API_BASE_URL: '', getAccessToken: () => null }));
const { buscarParaDiploma } = await import('@/modules/certifex/pages/CertifexDiplomasPage');

beforeEach(() => { get.mockReset(); });

describe('buscarParaDiploma', () => {
  it('pide los clientes (con venta) y el resto, clientes primero y sin repetir', async () => {
    get.mockImplementation(async (url) => (url.includes('conConversion=true')
      ? { data: [{ id: 7, nombre: 'Ana Cliente', email: 'a@x.test' }] }
      : { data: [{ id: 3, nombre: 'Ana Prospecto', email: 'p@x.test' }, { id: 7, nombre: 'Ana Cliente', email: 'a@x.test' }] }));
    const r = await buscarParaDiploma(5, 'Ana');
    expect(r.map((c) => c.id)).toEqual([7, 3]);
    const urls = get.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('projectId=5') && u.includes('conConversion=true') && u.includes('search=Ana'))).toBe(true);
    expect(urls.some((u) => u.includes('includeConverted=true'))).toBe(true);
  });

  it('por correo, igual (ya no solo los «convertidos»)', async () => {
    get.mockResolvedValue({ data: [] });
    await buscarParaDiploma(5, 'ana@x.test');
    expect(get.mock.calls.every((c) => !c[0].includes('lookup-by-email'))).toBe(true);
    expect(get.mock.calls[0][0]).toContain('search=ana%40x.test');
  });

  it('como mucho 10', async () => {
    get.mockResolvedValue({ data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, nombre: `P${i}`, email: null })) });
    expect((await buscarParaDiploma(5, 'P')).length).toBe(10);
  });
});
