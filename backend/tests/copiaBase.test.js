import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// #634: scripts/servidor/copia-base.sh y purgar-copias-backend.sh, con pg_dump, pg_restore, docker
// y rclone de mentira. No hace falta Postgres ni Docker: lo que se prueba es lo que el script
// decide (qué guarda, qué borra y cuándo falla).

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COPIA = join(RAIZ, 'scripts', 'servidor', 'copia-base.sh');
const PURGA = join(RAIZ, 'scripts', 'servidor', 'purgar-copias-backend.sh');
const EN_WINDOWS = process.platform === 'win32'; // chmod no cambia nada en Windows: ahí no se miran permisos
const HAY_PYTHON = spawnSync('python3', ['-c', 'import sqlite3; c = sqlite3.connect(":memory:"); c.execute("create table t(x)"); c.serialize()']).status === 0;

function falsos(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // pg_dump -Fc --no-owner --no-privileges <base>, por la salida: «rota» falla y «vacia» no saca nada.
  writeFileSync(join(bin, 'pg_dump'), `#!/usr/bin/env bash
base="\${@: -1}"
[ "$base" = rota ] && exit 1
[ "$base" = vacia ] && exit 0
printf 'PGDMP volcado de %s' "$base"`, { mode: 0o755 });
  writeFileSync(join(bin, 'pg_restore'), `#!/usr/bin/env bash
if [ "$1" = --list ] && [ -n "\${2:-}" ]; then grep -q PGDMP "$2"; else grep -q PGDMP; fi`, { mode: 0o755 });
  // docker exec <c> sh -c '…pg_dump…' sh <base>  ·  docker exec -i <c> pg_restore --list < fichero
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "$*" >> "${dir.replace(/\\/g, '/')}/docker.log"
[ "$1" = exec ] || exit 1; shift
[ "$1" = -i ] && { shift; c="$1"; [ "$c" = caido ] && exit 1; grep -q PGDMP; exit; }
c="$1"; [ "$c" = caido ] && exit 1
printf 'PGDMP volcado de %s en %s' "\${@: -1}" "$c"`, { mode: 0o755 });
  writeFileSync(join(bin, 'rclone'), `#!/usr/bin/env bash
echo "$*" >> "${dir.replace(/\\/g, '/')}/rclone.log"
[ -n "\${RCLONE_FALLA:-}" ] && [ "$1" = copyto ] && exit 1
exit 0`, { mode: 0o755 });
  return {
    PG_DUMP: join(bin, 'pg_dump'), PG_RESTORE: join(bin, 'pg_restore'),
    DOCKER: join(bin, 'docker'), RCLONE: join(bin, 'rclone'),
  };
}

function preparar() {
  const dir = mkdtempSync(join(tmpdir(), 'copia-base-'));
  const copias = join(dir, 'copias');
  // PG_COMO vacío: el pg_dump de mentira se lanza tal cual aunque la prueba corra como root (CI en contenedor).
  return { dir, copias, env: { ...process.env, ...falsos(dir), COPIAS_DIR: copias, COPIAS_MIN_LIBRE_MB: '0', PG_COMO: '' } };
}

const bash = (script, args, env) => spawnSync('bash', [script, ...args], { env, encoding: 'utf8' });
const viejo = (fichero, dias) => spawnSync('touch', ['-d', `${dias} days ago`, fichero]);
const dumps = (carpeta) => (existsSync(carpeta) ? readdirSync(carpeta).filter((f) => f.endsWith('.dump')).sort() : []);

describe('copia-base.sh (#634)', () => {
  it('copia cada base con su nombre, comprobada, y deja carpeta 700 y ficheros 600', () => {
    const { copias, env } = preparar();
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db crm_test_db' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const f = dumps(copias);
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/^crm_prod_db-\d{8}-\d{6}\.dump$/);
    expect(f[1]).toMatch(/^crm_test_db-\d{8}-\d{6}\.dump$/);
    expect(readFileSync(join(copias, f[0]), 'utf8')).toContain('PGDMP');
    expect(readdirSync(copias).some((x) => x.endsWith('.parcial'))).toBe(false);
    expect(readFileSync(join(copias, 'ESTADO'), 'utf8')).toMatch(/ OK$/m);
    if (!EN_WINDOWS) {
      expect(statSync(copias).mode & 0o777).toBe(0o700);
      expect(statSync(join(copias, f[0])).mode & 0o777).toBe(0o600);
    }
    expect(r.stdout).toContain('sin COPIAS_REMOTO'); // sin destino fuera, lo dice
  });

  it('deja las COPIAS_DIARIAS más nuevas de cada base y no toca los volcados a mano', () => {
    const { copias, env } = preparar();
    mkdirSync(copias);
    const antiguas = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => join(copias, `crm_prod_db-2026100${d}-031500.dump`));
    const aMano = join(copias, 'crm_prod_db-antes-v2.5.0-20261028-134642.dump');
    const otraBase = join(copias, 'crm_test_db-20250101-000000.dump');
    for (const f of [...antiguas, aMano, otraBase]) writeFileSync(f, 'PGDMP');
    viejo(aMano, 60);
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_DIARIAS: '7' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const quedan = dumps(copias).filter((f) => /^crm_prod_db-\d{8}-\d{6}\.dump$/.test(f));
    expect(quedan).toHaveLength(7); // la de hoy + las 6 más nuevas de antes
    expect(existsSync(antiguas[0])).toBe(false);
    expect(existsSync(antiguas[1])).toBe(false);
    expect(existsSync(antiguas[7])).toBe(true);
    expect(existsSync(aMano)).toBe(true); // no la puso este script: no la toca
    expect(existsSync(otraBase)).toBe(true); // otra base, otra cuenta
    if (!EN_WINDOWS) expect(statSync(aMano).mode & 0o777).toBe(0o600); // pero sí la cierra
  });

  it('COPIAS_DIAS (el nombre antiguo) sigue valiendo como número de diarias', () => {
    const { copias, env } = preparar();
    mkdirSync(copias);
    for (const d of [1, 2, 3]) writeFileSync(join(copias, `crm_prod_db-2026100${d}-031500.dump`), 'PGDMP');
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_DIAS: '2' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(dumps(copias)).toHaveLength(2);
  });

  it('una semanal cada 7 días (enlazada, no copiada dos veces) y solo las COPIAS_SEMANALES más nuevas', () => {
    const { copias, env } = preparar();
    const sem = join(copias, 'semanales');
    const e = { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_SEMANALES: '2' };
    expect(bash(COPIA, [], e).status).toBe(0);
    expect(dumps(sem)).toHaveLength(1);
    // Otra el mismo día: ya hay semanal de esta semana, no se añade.
    spawnSync('sleep', ['1']);
    expect(bash(COPIA, [], e).status).toBe(0);
    expect(dumps(sem)).toHaveLength(1);
    // Si la última semanal tiene más de 7 días, la de hoy pasa a semanal, y se guardan solo 2.
    for (const f of dumps(sem)) viejo(join(sem, f), 8);
    writeFileSync(join(sem, 'crm_prod_db-20250101-000000.dump'), 'PGDMP');
    viejo(join(sem, 'crm_prod_db-20250101-000000.dump'), 300);
    spawnSync('sleep', ['1']);
    const r = bash(COPIA, [], e);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/semanal crm_prod_db/);
    expect(dumps(sem)).toHaveLength(2);
    expect(existsSync(join(sem, 'crm_prod_db-20250101-000000.dump'))).toBe(false);
  });

  it('si el volcado falla o sale vacío: sale con 1, no deja fichero y NO borra las copias viejas', () => {
    const { copias, env } = preparar();
    mkdirSync(copias);
    const antiguas = [1, 2, 3].map((d) => join(copias, `rota-2025010${d}-000000.dump`));
    for (const f of antiguas) writeFileSync(f, 'PGDMP');
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'rota vacia crm_prod_db', COPIAS_DIARIAS: '1' });
    expect(r.status).toBe(1);
    expect(antiguas.every((f) => existsSync(f))).toBe(true);
    expect(dumps(copias).filter((f) => f.startsWith('vacia'))).toHaveLength(0);
    expect(dumps(copias).filter((f) => f.startsWith('crm_prod_db'))).toHaveLength(1); // las demás sí se copian
    expect(readdirSync(copias).some((x) => x.endsWith('.parcial'))).toBe(false);
    expect(r.stdout).toMatch(/ERROR rota/);
    expect(r.stdout).toMatch(/ERROR vacia/);
    expect(readFileSync(join(copias, 'ESTADO'), 'utf8')).toMatch(/ERROR 2 fallo/);
  });

  it('copia la base de un contenedor (contenedor:base) y la comprueba dentro del contenedor', () => {
    const { dir, copias, env } = preparar();
    const r = bash(COPIA, [], { ...env, COPIAS_DOCKER_PG: 'pg-contenedor:mibase caido:x mal' });
    expect(r.status).toBe(1); // «caido» falla y «mal» no tiene base
    const f = dumps(copias);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^docker-pg-contenedor-mibase-\d{8}-\d{6}\.dump$/);
    expect(readFileSync(join(copias, f[0]), 'utf8')).toBe('PGDMP volcado de mibase en pg-contenedor');
    const log = readFileSync(join(dir, 'docker.log'), 'utf8');
    expect(log).toMatch(/^exec -i pg-contenedor pg_restore --list$/m);
    expect(r.stdout).toMatch(/ERROR docker-caido-x/);
    expect(r.stdout).toMatch(/«mal» en COPIAS_DOCKER_PG/);
  });

  it.skipIf(!HAY_PYTHON)('copia una SQLite en caliente, comprimida y comprobada; si no existe, falla sin crearla', () => {
    const { dir, copias, env } = preparar();
    const db = join(dir, 'app.db');
    spawnSync('python3', ['-c', `import sqlite3; c=sqlite3.connect(r"${db}"); c.execute("pragma journal_mode=wal"); c.execute("create table t(x)"); c.execute("insert into t values (42)"); c.commit()`]);
    const noHay = join(dir, 'no-existe.db');
    const r = bash(COPIA, [], { ...env, COPIAS_SQLITE: `vet=${db} otra=${noHay}` });
    expect(r.status).toBe(1);
    const f = readdirSync(copias).filter((x) => x.endsWith('.sqlite.gz'));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/^sqlite-vet-\d{8}-\d{6}\.sqlite\.gz$/);
    expect(existsSync(noHay)).toBe(false);
    // Se restaura como se haría de verdad: descomprimir a un fichero y abrirlo.
    const restaurada = join(dir, 'restaurada.db');
    const leer = spawnSync('bash', ['-c', `gzip -dc "${join(copias, f[0])}" > "${restaurada}" && python3 -c "import sqlite3; print(sqlite3.connect(r'${restaurada}').execute('select x from t').fetchone()[0])"`], { encoding: 'utf8' });
    expect(leer.stdout.trim()).toBe('42');
  });

  it('con COPIAS_REMOTO sube cada copia y rota allí; si la subida falla, sale con 1', () => {
    const { dir, env } = preparar();
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_REMOTO: 'r2-copias:crm-copias/360' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const log = readFileSync(join(dir, 'rclone.log'), 'utf8');
    expect(log).toMatch(/^copyto .*crm_prod_db-\d{8}-\d{6}\.dump r2-copias:crm-copias\/360\/crm_prod_db-\d{8}-\d{6}\.dump$/m);
    expect(log).toMatch(/^delete r2-copias:crm-copias\/360 --max-depth 1 --min-age 7d --include crm_prod_db-\*\.dump$/m);
    // La primera es también la semanal, y va a su carpeta.
    expect(log).toMatch(/^copyto .*semanales.*crm_prod_db-\d{8}-\d{6}\.dump r2-copias:crm-copias\/360\/semanales\//m);
    expect(log).toMatch(/^delete r2-copias:crm-copias\/360\/semanales --max-depth 1 --min-age 28d /m);

    const mal = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_REMOTO: 'r2-copias:x', RCLONE_FALLA: '1' });
    expect(mal.status).toBe(1);
    expect(mal.stdout).toContain('la copia local sí está');
  });

  it('si queda menos espacio libre que COPIAS_MIN_LIBRE_MB, no copia y sale con 1', () => {
    const { copias, env } = preparar();
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_MIN_LIBRE_MB: '999999999' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('para no llenar el disco');
    expect(dumps(copias)).toHaveLength(0);
  });

  it('sin nada que copiar no hace nada y lo dice', () => {
    const { env } = preparar();
    const r = bash(COPIA, [], env);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('falta COPIAS_BASES');
  });
});

describe('purgar-copias-backend.sh (#634)', () => {
  function carpetaConCopias() {
    const dir = mkdtempSync(join(tmpdir(), 'purga-'));
    const nombres = [];
    for (let i = 0; i < 8; i++) {
      const f = join(dir, `backend-${i}.tgz`);
      writeFileSync(f, 'x');
      viejo(f, 60 + i); // backend-0 es la más nueva
      nombres.push(f);
    }
    const dump = join(dir, 'crm_prod_db-20250101-000000.dump');
    writeFileSync(dump, 'PGDMP');
    viejo(dump, 90);
    return { dir, nombres, dump };
  }

  it('sin --si es una simulación: lo dice y no borra nada', () => {
    const { dir, nombres } = carpetaConCopias();
    const r = bash(PURGA, [dir], process.env);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('Simulación');
    expect(nombres.every((f) => existsSync(f))).toBe(true);
  });

  it('con --si borra las viejas pero conserva las 5 más nuevas y no toca los .dump', () => {
    const { dir, nombres, dump } = carpetaConCopias();
    const r = bash(PURGA, [dir, '--si'], process.env);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(nombres.slice(0, 5).every((f) => existsSync(f))).toBe(true);
    expect(nombres.slice(5).some((f) => existsSync(f))).toBe(false);
    expect(existsSync(dump)).toBe(true);
  });
});
