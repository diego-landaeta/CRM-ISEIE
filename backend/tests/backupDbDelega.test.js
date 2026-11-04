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
    writeFileSync(join(bin, 'pg_dump'), `#!/usr/bin/env bash
while [ "$1" != "-f" ]; do shift; done; printf 'PGDMP' > "$2"`, { mode: 0o755 });
    writeFileSync(join(bin, 'pg_restore'), '#!/usr/bin/env bash\ngrep -q PGDMP "$2"', { mode: 0o755 });
    const copias = join(dir, 'copias');
    const r = spawnSync('bash', [join(RAIZ, 'scripts', 'backup-db.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PG_DUMP: join(bin, 'pg_dump'), PG_RESTORE: join(bin, 'pg_restore'), COPIAS_DIR: copias },
    });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stderr).toContain('sustituido por scripts/servidor/copia-base.sh');
    const f = readdirSync(copias).sort();
    expect(f).toHaveLength(2);
    expect(f[0]).toMatch(/^crm_iseie-\d{8}-\d{6}\.dump$/);
    expect(f[1]).toMatch(/^crm_iseie_staging-\d{8}-\d{6}\.dump$/);
  });
});
