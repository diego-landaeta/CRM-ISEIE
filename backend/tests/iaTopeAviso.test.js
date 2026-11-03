import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * El aviso cuando el gasto de IA se acerca al tope (#30, #22), contra la base.
 *
 * El tope ya CORTA; esto avisa antes (80 %) y al cortar (100 %) al super admin,
 * que es quien puede subirlo. Lo que se defiende:
 *   · UNA sola vez por umbral y mes, aunque la comprobacion se repita o llegue
 *     a la vez desde varias llamadas;
 *   · cruzar el 80 y luego el 100 da dos avisos; un salto de 70 a 105 da uno;
 *   · sin tope no hay umbral que cruzar;
 *   · llega solo a los super admin activos, nunca como broadcast;
 *   · el mes siguiente vuelve a avisar.
 *
 * «Ya avisado» se deduce de las propias notificaciones: sin migracion.
 *
 * Para no tocar las notificaciones reales de nadie, cada ejecucion usa un AÑO
 * inventado (lejos en el futuro): el mes del aviso es `<año>-06`, y se borra todo
 * lo de ese año al terminar. Los destinatarios son un usuario INACTIVO de la
 * marca — nunca se crea un super admin activo: otras pruebas enumeran los que
 * hay, y ya se rompio una por eso.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/iaTopeAviso.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const aviso = await import('../src/shared/services/gastoIAAviso.service.js');
const { claseDe, metaDe, ACCION } = await import('../src/modules/notifications/tipos.js');

const MARCA = `IAC${Date.now().toString(36)}`;
const ANIO = 3000 + (Date.now() % 5000);
const JUNIO = new Date(ANIO, 5, 15);
const JULIO = new Date(ANIO, 6, 15);
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
let ELLA; let OTRA; let INACTIVO_SUPER;

const avisos = (mes) => q(
  `SELECT id, title, message, metadata, target_user_ids FROM admin_notifications
    WHERE type = $1 AND metadata->>'mes' = $2 ORDER BY id`,
  [aviso.TIPO_AVISO, mes]
);
const borra = () => q(
  `DELETE FROM admin_notifications WHERE type = $1 AND metadata->>'mes' LIKE $2`,
  [aviso.TIPO_AVISO, `${ANIO}-%`]
);

beforeAll(async () => {
  const usuario = async (clave, role) => (await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, false) RETURNING id`,
    [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}@prueba.invalid`, role]
  ))[0].id;
  ELLA = await usuario('ella', 'gestor');
  OTRA = await usuario('otra', 'gestor');
  INACTIVO_SUPER = await usuario('super-inactivo', 'superadmin');
  await borra();
}, 30000);

afterAll(async () => {
  await borra();
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [[ELLA, OTRA, INACTIVO_SUPER]]);
  await pool.end();
}, 30000);

// Cada caso empieza sin avisos de ese año.
const limpio = async () => { await borra(); };

describe('que umbral se ha cruzado', () => {
  it.each([
    [0, 10, null],
    [7.9, 10, null], // 79 %
    [7.96, 10, null], // 79,6 % redondea a 80 y todavia no es el 80
    [8, 10, 80],
    [9.99, 10, 80],
    [10, 10, 100],
    [12, 10, 100],
    [5, 0, null], // sin tope
    [NaN, 10, null],
  ])('gastado %s de %s → %s', (gastado, tope, esperado) => {
    expect(aviso.umbralCruzado(gastado, tope)).toBe(esperado);
  });
});

describe('una sola vez por umbral y mes', () => {
  it('por debajo del 80 % no avisa', async () => {
    await limpio();
    const r = await aviso.avisaSiCruzaUmbral({ gastado: 7, tope: 10, ahora: JUNIO, destinatarios: [ELLA] });
    expect(r).toMatchObject({ avisado: false, motivo: 'por_debajo' });
    expect(await avisos(`${ANIO}-06`)).toHaveLength(0);
  });

  it('al cruzar el 80 % avisa a los destinatarios; repetirlo no da otro', async () => {
    await limpio();
    const r1 = await aviso.avisaSiCruzaUmbral({ gastado: 8.2, tope: 10, ahora: JUNIO, destinatarios: [ELLA, OTRA] });
    expect(r1).toMatchObject({ avisado: true, umbral: 80, mes: `${ANIO}-06` });

    for (const gastado of [8.2, 8.5, 9.9]) {
      const r = await aviso.avisaSiCruzaUmbral({ gastado, tope: 10, ahora: JUNIO, destinatarios: [ELLA, OTRA] });
      expect(r).toMatchObject({ avisado: false, motivo: 'ya_avisado' });
    }

    const filas = await avisos(`${ANIO}-06`);
    expect(filas).toHaveLength(1);
    expect(filas[0].target_user_ids.sort()).toEqual([ELLA, OTRA].sort());
    expect(filas[0].metadata).toMatchObject({ umbral: 80, gastado: 8.2, tope: 10 });
    expect(filas[0].title).toMatch(/80 %/);
    expect(filas[0].message).toMatch(/IA_TOPE_MENSUAL_USD/);
  });

  it('cruzar el 80 % y luego el 100 % da DOS avisos, y repetir el 100 % no da un tercero', async () => {
    await limpio();
    await aviso.avisaSiCruzaUmbral({ gastado: 8.1, tope: 10, ahora: JUNIO, destinatarios: [ELLA] });
    const r = await aviso.avisaSiCruzaUmbral({ gastado: 10.4, tope: 10, ahora: JUNIO, destinatarios: [ELLA] });
    expect(r).toMatchObject({ avisado: true, umbral: 100 });
    await aviso.avisaSiCruzaUmbral({ gastado: 11, tope: 10, ahora: JUNIO, destinatarios: [ELLA] });

    const filas = await avisos(`${ANIO}-06`);
    expect(filas.map((f) => f.metadata.umbral)).toEqual([80, 100]);
    expect(filas[1].title).toMatch(/alcanzado/i);
  });

  it('un salto de golpe del 70 al 105 % da solo el aviso del 100 %, y el del 80 no aparece despues', async () => {
    await limpio();
    const r = await aviso.avisaSiCruzaUmbral({ gastado: 10.5, tope: 10, ahora: JUNIO, destinatarios: [ELLA] });
    expect(r).toMatchObject({ avisado: true, umbral: 100 });
    // El gasto del mes solo sube: lo que ya paso del 100 no vuelve a ser un 80.
    await aviso.avisaSiCruzaUmbral({ gastado: 10.6, tope: 10, ahora: JUNIO, destinatarios: [ELLA] });
    expect((await avisos(`${ANIO}-06`)).map((f) => f.metadata.umbral)).toEqual([100]);
  });

  it('llamadas a la vez que cruzan el mismo umbral dan UN aviso', async () => {
    await limpio();
    const resultados = await Promise.all(
      Array.from({ length: 6 }, () => aviso.avisaSiCruzaUmbral({ gastado: 8.3, tope: 10, ahora: JUNIO, destinatarios: [ELLA] }))
    );
    expect(resultados.filter((r) => r.avisado)).toHaveLength(1);
    expect(await avisos(`${ANIO}-06`)).toHaveLength(1);
  });

  it('el mes siguiente vuelve a avisar', async () => {
    await limpio();
    await aviso.avisaSiCruzaUmbral({ gastado: 8.3, tope: 10, ahora: JUNIO, destinatarios: [ELLA] });
    const r = await aviso.avisaSiCruzaUmbral({ gastado: 8.3, tope: 10, ahora: JULIO, destinatarios: [ELLA] });
    expect(r).toMatchObject({ avisado: true, mes: `${ANIO}-07` });
    expect(await avisos(`${ANIO}-06`)).toHaveLength(1);
    expect(await avisos(`${ANIO}-07`)).toHaveLength(1);
  });

  it('sin tope configurado (0) no avisa, gaste lo que gaste', async () => {
    await limpio();
    const r = await aviso.avisaSiCruzaUmbral({ gastado: 500, tope: 0, ahora: JUNIO, destinatarios: [ELLA] });
    expect(r).toMatchObject({ avisado: false, motivo: 'por_debajo' });
    expect(await avisos(`${ANIO}-06`)).toHaveLength(0);
  });
});

describe('a quien llega', () => {
  it('por defecto, solo a super admin ACTIVOS: ni un gestor ni un super admin inactivo', async () => {
    await limpio();
    const r = await aviso.avisaSiCruzaUmbral({ gastado: 9, tope: 10, ahora: JUNIO });
    const activos = (await q(`SELECT id FROM users WHERE active AND role = 'superadmin'`)).map((u) => u.id);
    const filas = await avisos(`${ANIO}-06`);
    if (activos.length === 0) {
      // Sin ningun super admin activo NO se avisa: lista vacia seria un broadcast a todos los admins.
      expect(r).toMatchObject({ avisado: false, motivo: 'sin_destinatarios' });
      expect(filas).toHaveLength(0);
    } else {
      expect(r.avisado).toBe(true);
      expect(filas).toHaveLength(1);
      const para = filas[0].target_user_ids;
      expect(para.length).toBeGreaterThan(0);
      for (const id of para) expect(activos).toContain(id);
      expect(para).not.toContain(INACTIVO_SUPER);
      expect(para).not.toContain(ELLA);
    }
  });

  it('el aviso es de tipo «accion» y tiene su texto en el mapa de tipos', () => {
    expect(claseDe(aviso.TIPO_AVISO)).toBe(ACCION);
    const meta = metaDe(aviso.TIPO_AVISO);
    expect(meta.etiqueta).toBe('Tope de gasto de IA');
    expect(meta.descripcion).toMatch(/80 %/);
  });
});
