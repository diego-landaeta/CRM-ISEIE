import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// #361: el antiguo scripts/backup-db.sh (solo crm_iseie, legible por cualquiera, instalado con `crontab -`)
// ahora delega en scripts/servidor/copia-base.sh con las dos bases de ISEIE.

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('backup-db.sh (#361)', () => {
  it('delega en copia-base.sh y copia crm_iseie y crm_iseie_staging', () => {
    const dir = mkdtempSync(join(tmpdir(), 'backup-db-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // Como en copiaBase.test.js: copia-base.sh (gemela de CRM#844) vuelca por la salida, sin
    // `-f`. El falso de antes buscaba `-f` en bucle y, sin él, no acababa nunca: colgaba la CI.
    writeFileSync(join(bin, 'pg_dump'), `#!/usr/bin/env bash
printf 'PGDMP volcado de %s' "\${@: -1}"`, { mode: 0o755 });
    writeFileSync(join(bin, 'pg_restore'), `#!/usr/bin/env bash
if [ "$1" = --list ] && [ -n "\${2:-}" ]; then grep -q PGDMP "$2"; else grep -q PGDMP; fi`, { mode: 0o755 });
    const copias = join(dir, 'copias');
    const r = spawnSync('bash', [join(RAIZ, 'scripts', 'backup-db.sh')], {
      encoding: 'utf8',
      // PG_COMO vacío: el falso se lanza tal cual aunque la prueba corra como root. Y un tope,
      // para que un cuelgue sea un fallo y no una CI parada.
      env: { ...process.env, PG_DUMP: join(bin, 'pg_dump'), PG_RESTORE: join(bin, 'pg_restore'), COPIAS_DIR: copias, COPIAS_MIN_LIBRE_MB: '0', PG_COMO: '' },
      timeout: 60000,
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stderr).toContain('sustituido por scripts/servidor/copia-base.sh');
    // Solo los volcados: copia-base.sh deja también la carpeta de las semanales.
    const f = readdirSync(copias).filter((x) => x.endsWith('.dump')).sort();
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/^crm_iseie-\d{8}-\d{6}\.dump$/);
    expect(f[1]).toMatch(/^crm_iseie_staging-\d{8}-\d{6}\.dump$/);
  });
});
