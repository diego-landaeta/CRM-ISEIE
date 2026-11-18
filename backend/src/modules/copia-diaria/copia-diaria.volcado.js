import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { ZipWriter, configure } from '@zip.js/zip.js';

/**
 * El volcado de la base, cifrado al vuelo.
 *
 * `pg_dump` escribe SQL plano por su salida y eso entra directo en un zip con
 * AES-256 (el formato de WinZip, el que abren 7-Zip y WinRAR en Windows). El
 * SQL sin cifrar no toca nunca el disco: lleva datos personales de alumnos y
 * clientes, y un fichero temporal olvidado es justo lo que no puede quedar.
 *
 * SQL plano y no el formato propio de pg_dump: se restaura con un `psql` y se
 * puede abrir y leer si hace falta mirar algo, sin tener Postgres a mano.
 */

// Sin hilos de trabajo: en Node no hacen falta y así no hay ficheros de trabajador que servir.
configure({ useWebWorkers: false });

/**
 * La conexión de la app, pasada a pg_dump por variables de entorno y no por la
 * línea de órdenes: ahí la contraseña la vería cualquiera con un `ps`.
 * Al hijo solo le llega lo que necesita, no el .env entero de la app.
 */
export function entornoDeConexion(url, base = process.env) {
  const u = new URL(url);
  const env = {
    PATH: base.PATH || base.Path || '',
    HOME: base.HOME || '',
    LANG: base.LANG || 'C.UTF-8',
    PGHOST: u.searchParams.get('host') || decodeURIComponent(u.hostname) || 'localhost',
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\/+/, '')),
    PGAPPNAME: 'copia-diaria',
  };
  const ssl = u.searchParams.get('sslmode');
  if (ssl) env.PGSSLMODE = ssl;
  // Windows (solo en local) necesita esta para lanzar procesos.
  if (base.SystemRoot) env.SystemRoot = base.SystemRoot;
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
}

/** Los argumentos: sin dueño ni permisos, para que se pueda restaurar con otro usuario. */
export const ARGUMENTOS_PG_DUMP = ['--no-owner', '--no-privileges', '--format=plain', '--encoding=UTF8'];

export async function sha256DeFichero(ruta) {
  const h = crypto.createHash('sha256');
  for await (const trozo of fs.createReadStream(ruta)) h.update(trozo);
  return h.digest('hex');
}

/**
 * Vuelca la base y la deja cifrada en `destino`.
 *
 * Se escribe en `destino + '.part'` y se renombra al final: si algo falla a
 * medias no queda un zip roto que parezca una copia buena.
 *
 * @returns {{ bytesSql: number, bytes: number, sha256: string }}
 */
export async function volcarCifrado({ destino, nombreDentro, clave, conexion, pgDump = 'pg_dump', spawnFn = spawn }) {
  const parcial = `${destino}.part`;
  const hijo = spawnFn(pgDump, ARGUMENTOS_PG_DUMP, {
    env: entornoDeConexion(conexion),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Lo último que diga pg_dump por su salida de errores: es lo que explica un fallo.
  let errores = '';
  hijo.stderr?.on('data', (d) => { errores = (errores + d).slice(-4000); });
  const termina = new Promise((resolver, rechazar) => {
    hijo.once('error', rechazar);
    hijo.once('close', (codigo, senal) => resolver({ codigo, senal }));
  });

  let bytesSql = 0;
  const contador = new TransformStream({
    transform(trozo, ctl) { bytesSql += trozo.byteLength; ctl.enqueue(trozo); },
  });

  const salida = fs.createWriteStream(parcial, { mode: 0o600 });
  const escribir = async () => {
    const zip = new ZipWriter(Writable.toWeb(salida));
    await zip.add(nombreDentro, Readable.toWeb(hijo.stdout).pipeThrough(contador), {
      password: clave,
      encryptionStrength: 3, // 3 = AES-256
      level: 6,
    });
    await zip.close();
    if (!salida.closed) await once(salida, 'close');
  };

  // Si pg_dump no llega a arrancar, el zip se queda a medias y su promesa falla
  // después: se recoge aquí para que no salga como «promesa rechazada sin capturar».
  const zip = escribir();
  zip.catch(() => {});

  try {
    const [, { codigo, senal }] = await Promise.all([zip, termina]);
    if (codigo !== 0) {
      const motivo = errores.trim().split('\n').slice(-3).join(' · ') || 'sin mensaje';
      throw new Error(`pg_dump terminó con ${senal ? `la señal ${senal}` : `el código ${codigo}`}: ${motivo}`);
    }
    if (bytesSql === 0) throw new Error('pg_dump no devolvió nada');
  } catch (err) {
    try { hijo.kill?.(); } catch { /* ya había terminado */ }
    salida.destroy();
    await fs.promises.rm(parcial, { force: true });
    if (err?.code === 'ENOENT') throw new Error(`No se encuentra «${pgDump}» en el servidor: instala el cliente de PostgreSQL o pon su ruta en COPIA_DIARIA_PG_DUMP`);
    throw err;
  }

  await fs.promises.chmod(parcial, 0o600);
  await fs.promises.rename(parcial, destino);
  const { size } = await fs.promises.stat(destino);
  return { bytesSql, bytes: size, sha256: await sha256DeFichero(destino) };
}
