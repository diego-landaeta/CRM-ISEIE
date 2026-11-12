import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { ZipReader, Uint8ArrayReader, TextWriter, configure } from '@zip.js/zip.js';

/**
 * La copia diaria de la base (11/11/2026). Sin base ni Brevo de verdad: pg_dump
 * es un proceso falso que escupe SQL, y el correo, un simulacro. El zip sí es de
 * verdad: se abre con la contraseña para ver que lleva el volcado entero.
 */

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  sendEmail: vi.fn(),
  notifyUsers: vi.fn(),
  cerrojoLibre: true,
}));

vi.mock('node:child_process', async (original) => ({ ...(await original()), spawn: (...a) => h.spawn(...a) }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: (...a) => h.sendEmail(...a) }));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({ notifyUsers: (...a) => h.notifyUsers(...a) }));
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql) => {
    if (sql.includes('pg_class')) return { rows: [{ tablas: 12, filas: '3456' }] };
    if (sql.includes('FROM users')) return { rows: [{ id: 1 }] };
    return { rows: [] };
  }),
  getClient: vi.fn(async () => ({
    query: async () => ({ rows: [{ ok: h.cerrojoLibre }] }),
    release: vi.fn(),
  })),
}));

const { runCopiaDiaria } = await import('../src/jobs/copiaDiariaJob.js');
const servicio = await import('../src/modules/copia-diaria/copia-diaria.service.js');
const { leerConfig } = await import('../src/modules/copia-diaria/copia-diaria.config.js');
const enlace = await import('../src/modules/copia-diaria/copia-diaria.enlace.js');
const router = (await import('../src/modules/copia-diaria/copia-diaria.routes.js')).default;
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

configure({ useWebWorkers: false });

const SQL = `-- PostgreSQL database dump\nCREATE TABLE alumnos (id int, nombre text);\n${"INSERT INTO alumnos VALUES (1, 'Muñoz');\n".repeat(5000)}`;
const CLAVE = 'una-clave-de-prueba-bien-larga';
// Las 03:40 en Madrid (en noviembre, UTC+1).
const A_LAS_340 = new Date('2026-11-12T02:40:00Z');

/** Un pg_dump falso: escupe `sql` y termina con `codigo`. */
function pgDumpFalso(sql = SQL, codigo = 0, error = '') {
  return () => {
    const hijo = new EventEmitter();
    hijo.stdout = Readable.from(sql ? [Buffer.from(sql)] : []);
    hijo.stderr = new EventEmitter();
    hijo.kill = vi.fn();
    hijo.stdout.on('end', () => setImmediate(() => {
      if (error) hijo.stderr.emit('data', error);
      hijo.emit('close', codigo, null);
    }));
    return hijo;
  };
}

let carpeta;
const config = (extra = {}) => leerConfig({
  COPIA_DIARIA_ACTIVA: 'true',
  COPIA_DIARIA_CLAVE: CLAVE,
  COPIA_DIARIA_PARA: 'uno@ejemplo.test, dos@ejemplo.test',
  COPIA_DIARIA_CARPETA: carpeta,
  DATABASE_URL: 'postgresql://usuario:secreto@127.0.0.1:5432/crm_prueba',
  CRM_BASE_URL: 'https://crm.ejemplo.test/crm',
  ...extra,
});

async function abrirZip(buffer, clave) {
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(buffer)));
  const [entrada] = await zip.getEntries();
  try {
    return { nombre: entrada.filename, cifrado: entrada.encrypted, texto: await entrada.getData(new TextWriter(), { password: clave }) };
  } finally {
    await zip.close();
  }
}

beforeEach(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'copia-diaria-'));
  h.spawn.mockReset().mockImplementation(pgDumpFalso());
  h.sendEmail.mockReset().mockResolvedValue({ sent: true, messageId: 'x' });
  h.notifyUsers.mockReset().mockResolvedValue({ id: 1 });
  h.cerrojoLibre = true;
  servicio._internos.intentos.clear();
  servicio._internos.faltaDicha.clear();
});

afterEach(() => {
  fs.rmSync(carpeta, { recursive: true, force: true });
});

describe('el interruptor y la hora', () => {
  it('apagada no hace nada: ni volcado, ni correo, ni cerrojo', async () => {
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg: config({ COPIA_DIARIA_ACTIVA: 'false' }) });
    expect(r).toEqual({ omitido: 'apagada' });
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(fs.readdirSync(carpeta)).toEqual([]);
  });

  it('apagada de serie: sin COPIA_DIARIA_ACTIVA no se enciende', () => {
    expect(leerConfig({}).activa).toBe(false);
  });

  it('fuera de hora no hace nada; de serie, desde las 03:30 de Madrid', async () => {
    const r = await runCopiaDiaria({ ahora: new Date('2026-11-12T02:20:00Z'), cfg: config() });
    expect(r).toEqual({ omitido: 'fuera de hora' });
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe('sin clave no manda nada', () => {
  it('sin COPIA_DIARIA_CLAVE no vuelca ni manda, y lo dice', async () => {
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg: config({ COPIA_DIARIA_CLAVE: '' }) });
    expect(r.omitido).toMatch(/COPIA_DIARIA_CLAVE/);
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('con una clave corta, tampoco', async () => {
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg: config({ COPIA_DIARIA_CLAVE: 'corta' }) });
    expect(r.omitido).toMatch(/demasiado corta/);
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('sin destinatarios, tampoco', async () => {
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg: config({ COPIA_DIARIA_PARA: ' , ' }) });
    expect(r.omitido).toMatch(/COPIA_DIARIA_PARA/);
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe('con todo puesto', () => {
  it('llama a pg_dump, cifra con AES-256 y lo manda adjunto', async () => {
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg: config() });
    expect(r).toMatchObject({ dia: '2026-11-12', via: 'adjunto', tablas: 12 });

    // pg_dump sin dueño ni permisos, y la contraseña por entorno, no en los argumentos.
    const [orden, args, opciones] = h.spawn.mock.calls[0];
    expect(orden).toBe('pg_dump');
    expect(args).toEqual(expect.arrayContaining(['--no-owner', '--no-privileges']));
    expect(args.join(' ')).not.toContain('secreto');
    expect(opciones.env).toMatchObject({ PGUSER: 'usuario', PGPASSWORD: 'secreto', PGDATABASE: 'crm_prueba', PGHOST: '127.0.0.1' });
    expect(opciones.env.DATABASE_URL).toBeUndefined();

    // El correo: a los dos, con el CRM y la fecha en el asunto y el zip adjunto.
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const correo = h.sendEmail.mock.calls[0][0];
    expect(correo.to).toEqual([{ email: 'uno@ejemplo.test' }, { email: 'dos@ejemplo.test' }]);
    expect(correo.subject).toMatch(/Copia de la base · .+ · 12\/11\/2026/);
    expect(correo.clave).toBe('copia-diaria:crm_prueba:2026-11-12');
    expect(correo.htmlContent).toContain('Cómo se restaura');
    expect(correo.htmlContent).toContain('Tablas');
    expect(correo.htmlContent).not.toContain(CLAVE);
    expect(correo.textContent).not.toContain(CLAVE);
    expect(correo.attachment).toHaveLength(1);
    expect(correo.attachment[0].name).toBe('crm_prueba-2026-11-12.zip');

    // El adjunto se abre con la clave, va cifrado y lleva el volcado entero.
    const zip = Buffer.from(correo.attachment[0].content, 'base64');
    const dentro = await abrirZip(zip, CLAVE);
    expect(dentro.nombre).toBe('crm_prueba-2026-11-12.sql');
    expect(dentro.cifrado).toBe(true);
    expect(dentro.texto).toBe(SQL);
    await expect(abrirZip(zip, 'otra-clave-que-no-es')).rejects.toThrow();
    // AES-256 (el campo extra 0x9901 de WinZip, fuerza 3) y nada del SQL a la vista.
    const extra = zip.indexOf(Buffer.from([0x01, 0x99]));
    expect(extra).toBeGreaterThan(-1);
    expect(zip[extra + 8]).toBe(3);
    expect(zip.includes(Buffer.from('Muñoz'))).toBe(false);

    // En el servidor: el zip y su .json, y nada sin cifrar.
    expect(fs.readdirSync(carpeta).sort()).toEqual(['crm_prueba-2026-11-12.json', 'crm_prueba-2026-11-12.zip']);
    if (process.platform !== 'win32') {
      expect(fs.statSync(carpeta).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(carpeta, 'crm_prueba-2026-11-12.zip')).mode & 0o777).toBe(0o600);
    }
  });

  it('una segunda vuelta el mismo día no vuelca ni manda otra vez', async () => {
    await runCopiaDiaria({ ahora: A_LAS_340, cfg: config() });
    const r = await runCopiaDiaria({ ahora: new Date('2026-11-12T03:10:00Z'), cfg: config() });
    expect(r).toEqual({ omitido: 'ya hecha', dia: '2026-11-12' });
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('si otro proceso tiene el cerrojo, no hace nada', async () => {
    h.cerrojoLibre = false;
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg: config() });
    expect(r.omitido).toBe('la está haciendo otro proceso');
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('si pasa del tope, no la adjunta: manda un enlace firmado de 48 h', async () => {
    const cfg = { ...config(), maxAdjuntoBytes: 100 };
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg });
    expect(r.via).toBe('enlace');
    const correo = h.sendEmail.mock.calls[0][0];
    expect(correo.attachment).toBeUndefined();
    const m = /https:\/\/crm\.ejemplo\.test\/crm\/api\/copia-diaria\/descarga\/(crm_prueba-2026-11-12\.zip)\?exp=(\d+)&amp;sig=([A-Za-z0-9_-]{43})/.exec(correo.htmlContent);
    expect(m).not.toBeNull();
    expect(enlace.firmaValida(m[1], m[2], m[3])).toBe(true);
    const horas = (Number(m[2]) * 1000 - Date.now()) / 3600_000;
    expect(horas).toBeGreaterThan(47.9);
    expect(horas).toBeLessThanOrEqual(48);
  });

  it('si pg_dump falla: no manda, no deja ficheros a medias y avisa al superadmin', async () => {
    h.spawn.mockImplementation(pgDumpFalso('', 1, 'pg_dump: error: permission denied for table alumnos\n'));
    await expect(runCopiaDiaria({ ahora: A_LAS_340, cfg: config() })).rejects.toThrow(/permission denied/);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(fs.readdirSync(carpeta)).toEqual([]);
    expect(h.notifyUsers).toHaveBeenCalledTimes(1);
    expect(h.notifyUsers.mock.calls[0][0]).toMatchObject({ targetUserIds: [1], type: 'copia_diaria_fallo', metadata: { dia: '2026-11-12' } });
  });

  it('si no hay pg_dump en el servidor, lo dice claro', async () => {
    h.spawn.mockImplementation(() => {
      const hijo = new EventEmitter();
      hijo.stdout = Readable.from([]);
      hijo.stderr = new EventEmitter();
      setImmediate(() => hijo.emit('error', Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' })));
      return hijo;
    });
    await expect(runCopiaDiaria({ ahora: A_LAS_340, cfg: config() })).rejects.toThrow(/COPIA_DIARIA_PG_DUMP/);
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(fs.readdirSync(carpeta)).toEqual([]);
  });

  it('si falla el correo, la siguiente vuelta lo manda sin volcar otra vez', async () => {
    h.sendEmail.mockResolvedValueOnce({ sent: false, reason: 'HTTP_400', details: 'x' });
    await expect(runCopiaDiaria({ ahora: A_LAS_340, cfg: config() })).rejects.toThrow(/no salió/);
    expect(h.notifyUsers).toHaveBeenCalledTimes(1);
    const r = await runCopiaDiaria({ ahora: new Date('2026-11-12T02:50:00Z'), cfg: config() });
    expect(r.via).toBe('adjunto');
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('no lo intenta más de tres veces el mismo día', async () => {
    h.spawn.mockImplementation(pgDumpFalso('', 1, 'fallo'));
    for (let i = 0; i < 3; i++) await expect(runCopiaDiaria({ ahora: A_LAS_340, cfg: config() })).rejects.toThrow();
    const r = await runCopiaDiaria({ ahora: A_LAS_340, cfg: config() });
    expect(r.omitido).toBe('sin más intentos hoy');
    expect(h.spawn).toHaveBeenCalledTimes(3);
  });
});

describe('el enlace firmado', () => {
  const fichero = 'crm_dev-2026-11-12.zip';

  it('vale con su firma y deja de valer al caducar', () => {
    const ahora = Date.now();
    const { exp, sig } = enlace.firmar(fichero, { horas: 48, ahora });
    expect(enlace.firmaValida(fichero, exp, sig, { ahora })).toBe(true);
    expect(enlace.firmaValida(fichero, exp, sig, { ahora: ahora + 47 * 3600_000 })).toBe(true);
    expect(enlace.firmaValida(fichero, exp, sig, { ahora: ahora + 49 * 3600_000 })).toBe(false);
  });

  it('no vale con la firma mala, con otra caducidad ni para otro fichero', () => {
    const { exp, sig } = enlace.firmar(fichero);
    const mala = `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    expect(enlace.firmaValida(fichero, exp, mala)).toBe(false);
    expect(enlace.firmaValida(fichero, exp + 3600, sig)).toBe(false);
    expect(enlace.firmaValida('crm_dev-2026-11-11.zip', exp, sig)).toBe(false);
    expect(enlace.firmaValida('../crm_dev-2026-11-12.zip', exp, sig)).toBe(false);
  });

  describe('la ruta de descarga', () => {
    const app = express();
    app.use('/api/copia-diaria', router);
    app.use(errorHandler);
    const antes = {};
    const vars = { COPIA_DIARIA_ACTIVA: 'true' };

    beforeEach(() => {
      vars.COPIA_DIARIA_CARPETA = carpeta;
      for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
      fs.writeFileSync(path.join(carpeta, fichero), 'PK-cifrado');
    });
    afterEach(() => {
      for (const k of Object.keys(vars)) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
    });

    it('con la firma buena da el zip, y solo el zip', async () => {
      const { exp, sig } = enlace.firmar(fichero);
      const r = await request(app).get(`/api/copia-diaria/descarga/${fichero}?exp=${exp}&sig=${sig}`)
        .buffer(true).parse((res, fin) => { const t = []; res.on('data', (d) => t.push(d)); res.on('end', () => fin(null, Buffer.concat(t))); });
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/zip');
      expect(r.headers['cache-control']).toContain('no-store');
      expect(Buffer.from(r.body).toString()).toBe('PK-cifrado');
    });

    it('caducado o con la firma mala: 403', async () => {
      const viejo = enlace.firmar(fichero, { ahora: Date.now() - 49 * 3600_000 });
      const r1 = await request(app).get(`/api/copia-diaria/descarga/${fichero}?exp=${viejo.exp}&sig=${viejo.sig}`);
      expect(r1.status).toBe(403);
      const { exp } = enlace.firmar(fichero);
      const r2 = await request(app).get(`/api/copia-diaria/descarga/${fichero}?exp=${exp}&sig=${'A'.repeat(43)}`);
      expect(r2.status).toBe(403);
    });

    it('con la copia apagada no sirve nada', async () => {
      process.env.COPIA_DIARIA_ACTIVA = 'false';
      const { exp, sig } = enlace.firmar(fichero);
      const r = await request(app).get(`/api/copia-diaria/descarga/${fichero}?exp=${exp}&sig=${sig}`);
      expect(r.status).toBe(404);
    });
  });
});

describe('la retención', () => {
  it('deja las 7 últimas de esta base y borra las demás con su .json', async () => {
    const dias = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    for (const d of dias) {
      fs.writeFileSync(path.join(carpeta, `crm_prueba-${d}.zip`), 'x');
      fs.writeFileSync(path.join(carpeta, `crm_prueba-${d}.json`), '{}');
    }
    fs.writeFileSync(path.join(carpeta, 'otra_base-2026-10-01.zip'), 'x');
    fs.writeFileSync(path.join(carpeta, 'nota.txt'), 'x');

    const { borradas } = await servicio.aplicarRetencion(config());
    expect(borradas.sort()).toEqual(['crm_prueba-2026-11-01.zip', 'crm_prueba-2026-11-02.zip', 'crm_prueba-2026-11-03.zip']);
    const quedan = fs.readdirSync(carpeta);
    expect(quedan.filter((n) => n.startsWith('crm_prueba') && n.endsWith('.zip'))).toHaveLength(7);
    expect(quedan).not.toContain('crm_prueba-2026-11-01.json');
    expect(quedan).toContain('crm_prueba-2026-11-04.zip');
    expect(quedan).toContain('otra_base-2026-10-01.zip');
    expect(quedan).toContain('nota.txt');
  });

  it('borra los restos de un volcado cortado de hace más de un día', async () => {
    const resto = path.join(carpeta, 'crm_prueba-2026-11-01.zip.part');
    fs.writeFileSync(resto, 'x');
    const ayer = new Date(Date.now() - 25 * 3600_000);
    fs.utimesSync(resto, ayer, ayer);
    await servicio.aplicarRetencion(config());
    expect(fs.existsSync(resto)).toBe(false);
  });
});
