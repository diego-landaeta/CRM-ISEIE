// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Las descargas llegan como archivo (Diego, 24/11: «Descargar PDF» de Novedades no
 * hacía nada). Con `responseType: 'blob'` el cliente devuelve un Blob; antes, con
 * `res.text()`, el PDF llegaba como texto y la descarga fallaba.
 */
const { default: client } = await import('@/shared/api/client');

afterEach(() => vi.unstubAllGlobals());

const respuesta = (cuerpo, tipo, status = 200) => new Response(cuerpo, { status, headers: { 'content-type': tipo } });

describe('descargas con responseType blob', () => {
  it('un PDF llega como Blob, con su tipo y su tamaño', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(new Uint8Array([37, 80, 68, 70]), 'application/pdf')));
    const r = await client.get('/novedades/3.0.0/pdf', { responseType: 'blob' });
    expect(r).toBeInstanceOf(Blob);
    expect(r.type).toBe('application/pdf');
    expect(r.size).toBe(4);
  });

  it('un error sigue siendo un error con su mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(JSON.stringify({ success: false, error: 'No existe' }), 'application/json', 404)));
    await expect(client.get('/novedades/9.9.9/pdf', { responseType: 'blob' })).rejects.toThrow('No existe');
  });

  it('sin responseType, todo igual que antes (JSON)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuesta(JSON.stringify({ success: true, data: 1 }), 'application/json')));
    expect(await client.get('/novedades')).toEqual({ success: true, data: 1 });
  });
});
