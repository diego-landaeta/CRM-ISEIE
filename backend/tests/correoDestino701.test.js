import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  esDireccionInterna, destinoSeguro, puertoPermitido, resolutor,
} from '../src/shared/services/correo-destino.js';

/**
 * A dónde se deja conectar el servidor al leer o probar un buzón (CRM#1032).
 *
 * «Probar conexión» lo usa quien tiene `correos.buzones`, y escribe el servidor
 * y el puerto. Sin esta regla, el CRM serviría para llamar a su propia base, a
 * la red interna o a los metadatos del proveedor. Aquí se fija la regla sola,
 * sin red; la ruta y la lectura se prueban en `buzonesCorreo701.test.js`.
 *
 *   npx vitest run tests/correoDestino701.test.js
 */

const lookupDeVerdad = resolutor.lookup;
afterEach(() => { resolutor.lookup = lookupDeVerdad; vi.unstubAllEnvs(); });
const resuelveA = (...ips) => { resolutor.lookup = async () => ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })); };

describe('direcciones internas', () => {
  it.each([
    '0.0.0.0', '127.0.0.1', '127.8.9.10',
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.254',
    '192.168.0.1', '192.168.255.255',
    '169.254.169.254', '169.254.0.1',
    '100.64.0.1', '100.100.100.200', '100.127.255.254',
    '::', '::1', 'fc00::1', 'fd00:ec2::254', 'fe80::1', 'febf::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1',
    '224.0.0.1', '255.255.255.255',
  ])('%s no', (ip) => {
    expect(esDireccionInterna(ip)).toBe(true);
  });

  it.each([
    '203.0.113.10', '8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1',
    '100.63.255.255', '100.128.0.1', '2a02:4780::1', '2001:4860:4860::8888',
  ])('%s sí', (ip) => {
    expect(esDireccionInterna(ip)).toBe(false);
  });

  it('lo que no es una IP, como interna: nunca se conecta a ciegas', () => {
    expect(esDireccionInterna('imap.hostinger.com')).toBe(true);
    expect(esDireccionInterna('')).toBe(true);
  });
});

describe('puertos', () => {
  it('solo 993 y 143', () => {
    expect(puertoPermitido(993)).toBe(true);
    expect(puertoPermitido(143)).toBe(true);
    for (const p of [22, 25, 80, 443, 465, 587, 3306, 5432, 6379, 8080, 13143]) expect(puertoPermitido(p)).toBe(false);
  });

  it('el de pruebas local, solo fuera de producción y con CORREO_IMAP_SIN_TLS=1', () => {
    vi.stubEnv('CORREO_IMAP_SIN_TLS', '1');
    vi.stubEnv('NODE_ENV', 'development');
    expect(puertoPermitido(13143)).toBe(true);
    vi.stubEnv('NODE_ENV', 'production');
    expect(puertoPermitido(13143)).toBe(false);
  });
});

describe('destinoSeguro', () => {
  it('pública y puerto de IMAP: conecta a la IP resuelta', async () => {
    resuelveA('203.0.113.10');
    expect(await destinoSeguro({ host: 'imap.hostinger.com', puerto: 993 })).toEqual({ ok: true, ip: '203.0.113.10' });
  });

  it('si ALGUNA de las direcciones es interna, no', async () => {
    resuelveA('203.0.113.10', '10.0.0.7');
    const r = await destinoSeguro({ host: 'mixto.ejemplo.com', puerto: 993 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/interna/);
  });

  it('IPv6 interna detrás de un nombre, tampoco', async () => {
    resuelveA('fd00:ec2::254');
    expect((await destinoSeguro({ host: 'meta.ejemplo.com', puerto: 993 })).ok).toBe(false);
  });

  it('puerto que no es de IMAP: no, sin preguntar siquiera al DNS', async () => {
    let preguntado = false;
    resolutor.lookup = async () => { preguntado = true; return [{ address: '203.0.113.10', family: 4 }]; };
    const r = await destinoSeguro({ host: 'imap.hostinger.com', puerto: 5432 });
    expect(r).toEqual({ ok: false, motivo: expect.stringMatching(/993.*143/) });
    expect(preguntado).toBe(false);
  });

  it('un nombre que no existe: lo dice, no lanza', async () => {
    resolutor.lookup = async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); };
    expect(await destinoSeguro({ host: 'noexiste.ejemplo.com', puerto: 993 }))
      .toEqual({ ok: false, motivo: expect.stringMatching(/No se encuentra/) });
  });

  it('localhost se admite solo en el modo de pruebas local, y nunca en producción', async () => {
    resuelveA('127.0.0.1');
    expect((await destinoSeguro({ host: 'localhost', puerto: 993 })).ok).toBe(false);
    vi.stubEnv('CORREO_IMAP_SIN_TLS', '1');
    vi.stubEnv('NODE_ENV', 'development');
    expect(await destinoSeguro({ host: 'localhost', puerto: 13143 })).toEqual({ ok: true, ip: '127.0.0.1' });
    vi.stubEnv('NODE_ENV', 'production');
    expect((await destinoSeguro({ host: 'localhost', puerto: 993 })).ok).toBe(false);
  });
});
