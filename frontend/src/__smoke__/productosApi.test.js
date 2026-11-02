import { describe, it, expect, vi, beforeEach } from 'vitest';

// 02/11/2026, validando el buscador en /testeo: la ficha de un producto decía siempre
// «Producto no encontrado». El cliente HTTP ya devuelve el JSON entero ({ success, data }),
// y `getProduct` lo desenvolvía otra vez (`data.data`), así que devolvía undefined.
const respuesta = (data) => Promise.resolve({ success: true, data });
vi.mock('@/shared/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
const client = (await import('@/shared/api/client')).default;
const productos = await import('@/modules/products/api/products.api');
const dossiers = await import('@/modules/products/api/dossiers.api');

beforeEach(() => vi.clearAllMocks());

describe('la API de productos devuelve lo que manda el servidor', () => {
  it('getProduct: el producto, no undefined', async () => {
    client.get.mockReturnValueOnce(respuesta({ id: 8002, nombre: 'Curso de Audífonos' }));
    expect(await productos.getProduct(8002, 3)).toEqual({ id: 8002, nombre: 'Curso de Audífonos' });
  });
  it('el dossier y su historial', async () => {
    client.get.mockReturnValueOnce(respuesta({ url: 'https://x/d.pdf' }));
    expect(await dossiers.getDossierUrl(1, 3)).toEqual({ url: 'https://x/d.pdf' });
    client.get.mockReturnValueOnce(respuesta([{ id: 1 }]));
    expect(await dossiers.getDossierHistory(1, 3)).toEqual([{ id: 1 }]);
  });
});
