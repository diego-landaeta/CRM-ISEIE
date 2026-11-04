import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Adjuntos de WhatsApp que ya no se pueden bajar (#365).
 *
 * Visto en la auditoria del 03/11: 3.252 errores en 7 dias de
 * `/chat/getBase64FromMediaMessage` («Message not found»), en rafagas de 130 o
 * 260 justo despues de cada despliegue. Al arrancar, el CRM volvia a pedir TODOS
 * los mensajes sin archivo, tambien los que Evolution ya no tiene.
 *
 * Ahora cada fallo se anota y al tercero el adjunto queda como irrecuperable:
 * ni el arranque ni el boton de reintentar lo vuelven a pedir.
 */

const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));
const bajarMedia = vi.fn();
vi.mock('../src/modules/whatsapp/evolution.client.js', () => ({ bajarMedia: (...a) => bajarMedia(...a) }));

const media = await import('../src/modules/whatsapp/media.service.js');

const sql = (c) => c[0].replace(/\s+/g, ' ');
const tarea = (id) => ({ mensajeId: id, key: { remoteJid: 'x@s.whatsapp.net', fromMe: false, id: `W${id}` }, message: null, instancia: 'ana' });

describe('lo que se pide al arrancar y al pulsar «reintentar» (#365)', () => {
  beforeEach(() => { query.mockReset(); bajarMedia.mockReset(); });

  it('no vuelve a pedir los adjuntos marcados como irrecuperables', async () => {
    query.mockResolvedValue({ rows: [] });
    await media.reencolarPendientes('ana');
    expect(sql(query.mock.calls[0])).toContain('AND NOT m.media_irrecuperable');
  });

  it('el aviso de pendientes no cuenta los irrecuperables', async () => {
    query.mockResolvedValue({ rows: [{ n: 0 }] });
    await media.pendientesEnBase();
    expect(sql(query.mock.calls[0])).toContain('NOT media_irrecuperable');
  });
});

describe('la cola anota cada fallo (#365)', () => {
  beforeEach(() => { query.mockReset(); bajarMedia.mockReset(); query.mockResolvedValue({ rows: [] }); });

  const esperarCola = async () => {
    for (let i = 0; i < 40 && media.pendientes() > 0; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 400)); // el respiro de 250 ms tras el ultimo
  };

  it('un adjunto que Evolution no tiene suma un intento, y al tope queda irrecuperable', async () => {
    bajarMedia.mockResolvedValue({ ok: false, error: 'Message not found' });
    media.encolar(tarea(7));
    await esperarCola();
    const anotar = query.mock.calls.find((c) => sql(c).includes('media_intentos = media_intentos + 1'));
    expect(anotar, 'debe anotar el intento').toBeTruthy();
    expect(sql(anotar)).toContain('media_irrecuperable = media_intentos + 1 >= $2');
    expect(anotar[1]).toEqual([7, media.MAX_INTENTOS]);
    expect(media.MAX_INTENTOS).toBe(3);
  });

  it('si Evolution lanza, tambien cuenta como intento', async () => {
    bajarMedia.mockRejectedValue(new Error('ECONNRESET'));
    media.encolar(tarea(8));
    await esperarCola();
    expect(query.mock.calls.some((c) => sql(c).includes('media_intentos = media_intentos + 1') && c[1][0] === 8)).toBe(true);
  });

  it('si no se puede anotar (sin la migracion 270), la cola sigue con el siguiente', async () => {
    bajarMedia.mockResolvedValue({ ok: false });
    query.mockRejectedValueOnce(new Error('column "media_intentos" does not exist'));
    media.encolar(tarea(9));
    media.encolar(tarea(10));
    await esperarCola();
    expect(bajarMedia).toHaveBeenCalledTimes(2);
  });
});
