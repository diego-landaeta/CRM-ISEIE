import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// #634: scripts/servidor/copia-base.sh y purgar-copias-backend.sh, con pg_dump, pg_restore y rclone de mentira.
// No hace falta Postgres: lo que se prueba es lo que el script decide (qué guarda, qué borra y cuándo falla).

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COPIA = join(RAIZ, 'scripts', 'servidor', 'copia-base.sh');
const PURGA = join(RAIZ, 'scripts', 'servidor', 'purgar-copias-backend.sh');
const EN_WINDOWS = process.platform === 'win32'; // chmod no cambia nada en Windows: ahí no se miran permisos

function falsos(dir) {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  // pg_dump -Fc --no-owner --no-privileges -f <fichero> <base>: «rota» falla y «vacia» deja un fichero vacío.
  writeFileSync(join(bin, 'pg_dump'), `#!/usr/bin/env bash
while [ "$1" != "-f" ]; do shift; done; f="$2"; base="\${@: -1}"
[ "$base" = rota ] && exit 1
[ "$base" = vacia ] && { : > "$f"; exit 0; }
printf 'PGDMP volcado de %s' "$base" > "$f"`, { mode: 0o755 });
  writeFileSync(join(bin, 'pg_restore'), `#!/usr/bin/env bash
grep -q PGDMP "$2"`, { mode: 0o755 });
  writeFileSync(join(bin, 'rclone'), `#!/usr/bin/env bash
echo "$*" >> "${dir.replace(/\\/g, '/')}/rclone.log"
[ -n "\${RCLONE_FALLA:-}" ] && [ "$1" = copyto ] && exit 1
exit 0`, { mode: 0o755 });
  return { PG_DUMP: join(bin, 'pg_dump'), PG_RESTORE: join(bin, 'pg_restore'), RCLONE: join(bin, 'rclone') };
}

function preparar() {
  const dir = mkdtempSync(join(tmpdir(), 'copia-base-'));
  const copias = join(dir, 'copias');
  return { dir, copias, env: { ...process.env, ...falsos(dir), COPIAS_DIR: copias } };
}

const bash = (script, args, env) => spawnSync('bash', [script, ...args], { env, encoding: 'utf8' });
const viejo = (fichero, dias) => spawnSync('touch', ['-d', `${dias} days ago`, fichero]);
const dumps = (copias) => readdirSync(copias).filter((f) => f.endsWith('.dump')).sort();

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
    if (!EN_WINDOWS) {
      expect(statSync(copias).mode & 0o777).toBe(0o700);
      expect(statSync(join(copias, f[0])).mode & 0o777).toBe(0o600);
    }
    expect(r.stdout).toContain('sin COPIAS_REMOTO'); // sin destino fuera, lo dice
  });

  it('borra las copias de más de COPIAS_DIAS días, solo de esa base y con su nombre', () => {
    const { copias, env } = preparar();
    mkdirSync(copias);
    const antigua = join(copias, 'crm_prod_db-20250101-000000.dump');
    const ajena = join(copias, 'volcado-a-mano.dump');
    const reciente = join(copias, 'crm_prod_db-20261101-000000.dump');
    for (const f of [antigua, ajena, reciente]) writeFileSync(f, 'PGDMP');
    viejo(antigua, 20); viejo(ajena, 20); viejo(reciente, 3);
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_DIAS: '14' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(existsSync(antigua)).toBe(false);
    expect(existsSync(ajena)).toBe(true); // no la puso este script: no la toca
    expect(existsSync(reciente)).toBe(true);
    if (!EN_WINDOWS) expect(statSync(ajena).mode & 0o777).toBe(0o600); // pero sí la cierra
  });

  it('si el volcado falla o sale vacío: sale con 1, no deja fichero y NO borra las copias viejas', () => {
    const { copias, env } = preparar();
    mkdirSync(copias);
    const antigua = join(copias, 'rota-20250101-000000.dump');
    writeFileSync(antigua, 'PGDMP');
    viejo(antigua, 40);
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'rota vacia crm_prod_db' });
    expect(r.status).toBe(1);
    expect(existsSync(antigua)).toBe(true);
    expect(dumps(copias).filter((f) => f.startsWith('vacia'))).toHaveLength(0);
    expect(dumps(copias).filter((f) => f.startsWith('crm_prod_db'))).toHaveLength(1); // las demás sí se copian
    expect(readdirSync(copias).some((x) => x.endsWith('.parcial'))).toBe(false);
    expect(r.stdout).toMatch(/ERROR rota/);
    expect(r.stdout).toMatch(/ERROR vacia/);
  });

  it('con COPIAS_REMOTO sube cada copia y rota allí; si la subida falla, sale con 1', () => {
    const { dir, env } = preparar();
    const r = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_REMOTO: 'r2-copias:crm-copias/360' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const log = readFileSync(join(dir, 'rclone.log'), 'utf8');
    expect(log).toMatch(/^copyto .*crm_prod_db-\d{8}-\d{6}\.dump r2-copias:crm-copias\/360\/crm_prod_db-\d{8}-\d{6}\.dump$/m);
    expect(log).toMatch(/^delete r2-copias:crm-copias\/360 --min-age 14d --include crm_prod_db-\*\.dump$/m);

    const mal = bash(COPIA, [], { ...env, COPIAS_BASES: 'crm_prod_db', COPIAS_REMOTO: 'r2-copias:x', RCLONE_FALLA: '1' });
    expect(mal.status).toBe(1);
    expect(mal.stdout).toContain('la copia local sí está');
  });

  it('sin COPIAS_BASES no hace nada y lo dice', () => {
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
