import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Un corte de red leyendo un buzón NO puede cerrar el backend (CRM-ISEIE#701,
 * traído de `imapNoTumbaLaApi.test.js` del 360).
 *
 * Pasó de verdad en el 360: el buzón de Hostinger cortó la conexión y la API
 * entera se fue abajo con `Error: read ECONNRESET at TLSWrap.onStreamRead`.
 * ImapFlow avisa de los cortes por el evento `'error'`, no rechazando la promesa
 * que se espera; sin nadie escuchándolo, Node lo trata como excepción sin
 * capturar y el manejador de `app.js` cierra el proceso.
 *
 * Se fija que alguien escucha, y que empieza a escuchar ANTES de `connect()`.
 * En ISEIE no hay copia en «Enviados» (solo se lee), así que esa mitad no está.
 *
 * Se lee el buzón del `.env` con `leerUnBuzon` y no con `leerBuzon`, para no
 * depender de que otra prueba tenga buzones activos en la base a la vez.
 */

// El cliente de mentira: apunta en qué orden se le llama.
const llamadas = [];

class ImapFlowFalso {
  on(evento) { llamadas.push(`on:${evento}`); return this; }
  async connect() { llamadas.push('connect'); }
  async mailboxOpen() { llamadas.push('mailboxOpen'); return { exists: 0 }; }
  async logout() { llamadas.push('logout'); }
  async search() { return []; }
}

vi.mock('imapflow', () => ({ ImapFlow: ImapFlowFalso }));

vi.stubEnv('IMAP_HOST', 'imap.ejemplo.com');
vi.stubEnv('IMAP_USER', 'buzon@ejemplo.com');
vi.stubEnv('IMAP_PASSWORD', 'lo-que-sea');

beforeEach(() => { llamadas.length = 0; });

// Sin red: el servidor de correo «resuelve» a una dirección pública de
// documentación, que la regla de destinos deja pasar (ver correo-destino.js).
const { resolutor } = await import('../src/shared/services/correo-destino.js');
resolutor.lookup = async () => [{ address: '203.0.113.10', family: 4 }];
const { leerUnBuzon, buzonDelEnv, probarConexion } = await import('../src/shared/services/correo-entrante.service.js');

describe('leer un buzón', () => {
  it('escucha el evento de error del cliente IMAP, y ANTES de conectar', async () => {
    const r = await leerUnBuzon(buzonDelEnv());
    expect(r.motivo).toBeUndefined();
    expect(llamadas).toContain('on:error');
    expect(llamadas.indexOf('on:error')).toBeLessThan(llamadas.indexOf('connect'));
  });
});

describe('«Probar conexión»', () => {
  it('también escucha antes de conectar', async () => {
    const r = await probarConexion(buzonDelEnv());
    expect(r).toEqual({ ok: true, mensajes: 0 });
    expect(llamadas.indexOf('on:error')).toBeLessThan(llamadas.indexOf('connect'));
  });
});
