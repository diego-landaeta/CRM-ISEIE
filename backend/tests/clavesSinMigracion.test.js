import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El panel de claves NO puede romper lo que ya funcionaba (#80, portado aqui en #113).
 *
 * El `ON CONFLICT` del guardado nombra las expresiones del indice unico por
 * entorno. Si ese indice no esta, Postgres no lo ignora: contesta
 *
 *     42P10  there is no unique or exclusion constraint matching
 *            the ON CONFLICT specification
 *
 * y deja de poder guardarse CUALQUIER credencial. Comprobado contra Postgres
 * antes de escribir esto, no supuesto.
 *
 * Importa porque las migraciones se preparan aqui y se aplican en el servidor.
 * Entre una cosa y otra hay una ventana, y en ISEIE ademas ya existe una
 * pantalla de Configuracion que guarda credenciales y hoy funciona. Un puerto
 * que la rompe hasta que alguien corra una migracion no es un puerto.
 *
 * Lo que se fija aqui son las dos ramas y, sobre todo, que la de abajo no pueda
 * perder una clave de produccion en silencio.
 */

const consultas = [];
let hayIndice = true;

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (sql.includes('pg_indexes')) return { rows: hayIndice ? [{ '?column?': 1 }] : [] };
    return { rows: [{ id: 1, project_id: 1, service: 'brevo', metadata: {}, active: true }] };
  }),
}));

vi.mock('../src/shared/utils/crypto.js', () => ({
  encrypt: () => ({ encrypted: 'e', iv: 'i', authTag: 'a' }),
  decrypt: () => 'descifrado',
  maskSecret: (v) => `••••${String(v).slice(-4)}`,
}));

vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const modelo = await import('../src/modules/credentials/credentials.model.js');

/** El INSERT que se acaba de mandar. */
const elInsert = () => consultas.find((c) => c.sql.includes('INSERT INTO api_credentials'));

beforeEach(() => {
  consultas.length = 0;
  hayIndice = true;
  modelo.olvidarIndice();
});

describe('con la migracion aplicada, que es el caso bueno', () => {
  it('el conflicto va por proyecto, servicio Y entorno', async () => {
    await modelo.upsert({ project_id: 1, service: 'brevo', value: 'xk-1234', entorno: 'pruebas' });
    expect(elInsert().sql).toContain("COALESCE(metadata->>'entorno', 'produccion')");
  });

  it('y la de pruebas se guarda sin protestar', async () => {
    await expect(
      modelo.upsert({ project_id: 1, service: 'brevo', value: 'xk-1234', entorno: 'pruebas' })
    ).resolves.toBeTruthy();
  });
});

describe('sin la migracion, lo de siempre sigue funcionando', () => {
  beforeEach(() => { hayIndice = false; modelo.olvidarIndice(); });

  it('el conflicto cae al par de siempre', async () => {
    await modelo.upsert({ project_id: 1, service: 'brevo', value: 'xk-1234' });
    expect(elInsert().sql).toContain('ON CONFLICT (project_id, service)');
    expect(elInsert().sql).not.toContain("metadata->>'entorno'");
  });

  it('guardar la de produccion se puede, como antes', async () => {
    await expect(
      modelo.upsert({ project_id: 1, service: 'brevo', value: 'xk-1234', entorno: 'produccion' })
    ).resolves.toBeTruthy();
  });

  it('y sin decir entorno tambien, que es como lo manda la pantalla vieja', async () => {
    await expect(
      modelo.upsert({ project_id: 1, service: 'brevo', value: 'xk-1234' })
    ).resolves.toBeTruthy();
  });
});

describe('lo que NO se deja hacer sin la migracion', () => {
  beforeEach(() => { hayIndice = false; modelo.olvidarIndice(); });

  it('guardar una de pruebas se rechaza', async () => {
    // Sin el indice solo cabe UNA fila por proyecto y servicio: la de pruebas
    // pisaria la de produccion. Perder una clave de produccion en silencio es
    // lo peor que puede hacer esta pantalla.
    await expect(
      modelo.upsert({ project_id: 1, service: 'brevo', value: 'xk-1234', entorno: 'pruebas' })
    ).rejects.toMatchObject({ code: 'FALTA_MIGRACION_ENTORNO', statusCode: 409 });
  });

  it('y no llega a tocar la base', async () => {
    await modelo.upsert({ project_id: 1, service: 'brevo', value: 'x', entorno: 'pruebas' }).catch(() => {});
    expect(elInsert()).toBeUndefined();
  });

  it('el motivo se dice, no se contesta «error»', async () => {
    // Quien lo lea tiene que saber que hacer: aplicar la migracion.
    await expect(
      modelo.upsert({ project_id: 1, service: 'brevo', value: 'x', entorno: 'pruebas' })
    ).rejects.toThrow(/migracion/i);
  });
});

describe('preguntar por el indice sale una vez', () => {
  it('no se mira pg_indexes en cada guardado', async () => {
    await modelo.upsert({ project_id: 1, service: 'brevo', value: 'a1234' });
    await modelo.upsert({ project_id: 1, service: 'stripe', value: 'b1234' });
    expect(consultas.filter((c) => c.sql.includes('pg_indexes'))).toHaveLength(1);
  });

  it('pero se puede olvidar, para no reiniciar tras aplicar la migracion', async () => {
    hayIndice = false;
    modelo.olvidarIndice();
    await modelo.upsert({ project_id: 1, service: 'brevo', value: 'a1234' });
    expect(elInsert().sql).toContain('ON CONFLICT (project_id, service)');

    consultas.length = 0;
    hayIndice = true;
    modelo.olvidarIndice();
    await modelo.upsert({ project_id: 1, service: 'brevo', value: 'a1234' });
    expect(elInsert().sql).toContain("metadata->>'entorno'");
  });
});

describe('el listado no descifra nada, con migracion o sin ella', () => {
  it('no se piden ni el valor ni el iv ni el auth_tag', async () => {
    // Es la regla de la #80: «el valor no se devuelve nunca en un listado». Un
    // listado de veinte credenciales descifraba veinte secretos en memoria para
    // enseñar cuatro caracteres de cada uno.
    await modelo.list({});
    const select = consultas.find((c) => c.sql.includes('FROM api_credentials'));
    expect(select.sql).not.toContain('encrypted_value');
    expect(select.sql).not.toContain('auth_tag');
  });
});
