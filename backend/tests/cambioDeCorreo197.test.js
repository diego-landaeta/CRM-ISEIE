import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import pool from '../src/shared/config/db.js';
import { pedirCodigo, confirmarCodigo, nuevoCodigo, INTENTOS, MENSAJE_FRENADO, codigoFrenadoPara } from '../src/modules/users/cambio-de-correo.js';
import { cambiarCorreo } from '../src/modules/users/user.service.js';
import { NO_ESCRIBIR_A_TUTORES } from '../src/shared/config/frenoTutores.js';

/**
 * #197 (gemela de CRM#211) · Cambiar el correo con un código a la dirección nueva.
 *
 * El mecanismo: pedir el código (va a la dirección NUEVA y no cambia nada),
 * confirmarlo (con el bueno cambia; con el malo suma un intento; al quinto se
 * anula), que caduque, que una petición nueva anule la anterior, y que quede en
 * el registro. Y lo que pidió Diego el 06/11 en la #688: el freno de tutores,
 * la misma respuesta si el correo ya es de otro, el HMAC, dos peticiones a la
 * vez y que un cambio del superadmin anule el código pendiente.
 *
 * Contra la base real. El correo no sale: se le pasa un `enviar` que guarda el
 * código, para poder meterlo como lo haría la persona.
 */

const MARCA = `C197${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [] };
let ANA; let OTRA; let TUTOR;
let enviado = null;
const enviar = async (m) => { enviado = m; return { sent: true }; };
// El correo sale sin esperar (revisión de Diego, #688): se deja correr la cola.
const pedir = async (args) => { const r = await pedirCodigo(args); await new Promise((ok) => setImmediate(ok)); return r; };
const correoDe = async (id) => (await one('SELECT email FROM users WHERE id = $1', [id])).email;

beforeAll(async () => {
  const persona = async (n, role = 'gestor') => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    return u.id;
  };
  ANA = await persona('ana'); OTRA = await persona('otra');
  // Sin superadmin de prueba: otras pruebas (certifexDiplomas) cuentan los
  // superadmin de la base mientras corren en paralelo, y uno que aparece y
  // desaparece se las rompe. Para cambiarle el correo a una gestora basta
  // cualquiera (el superadmin solo se exige si la persona lo es).
  TUTOR = await persona('tutor', 'tutor');
}, 60000);

beforeEach(async () => {
  enviado = null;
  await q(`UPDATE users SET email = $2 WHERE id = $1`, [ANA, `ana@${MARCA.toLowerCase()}.test`]);
  await q('DELETE FROM cambios_de_correo WHERE user_id = $1', [ANA]);
});

afterAll(async () => {
  await q('DELETE FROM cambios_de_correo WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM refresh_tokens WHERE user_id = ANY($1::int[])', [ids.users]).catch(() => {});
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await pool.end();
});

const NUEVO = () => `ana.nueva@${MARCA.toLowerCase()}.test`;

describe('#197 (CRM#211) · el código', () => {
  it('son seis cifras, también con ceros delante', () => {
    for (let i = 0; i < 50; i++) expect(nuevoCodigo()).toMatch(/^\d{6}$/);
  });

  it('pedirlo manda el código a la dirección NUEVA y todavía no cambia nada', async () => {
    const r = await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    expect(r.enviado).toBe(true);
    expect(enviado.a).toBe(NUEVO());
    expect(enviado.codigo).toMatch(/^\d{6}$/);
    expect(await correoDe(ANA)).toBe(`ana@${MARCA.toLowerCase()}.test`);
    // Solo se guarda el hash, nunca el código.
    const fila = await one('SELECT codigo_hash FROM cambios_de_correo WHERE user_id = $1', [ANA]);
    expect(fila.codigo_hash).not.toContain(enviado.codigo);
  });

  it('con el código bueno, el correo cambia y queda en el registro', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const r = await confirmarCodigo({ userId: ANA, codigo: enviado.codigo });
    expect(r.cambiado).toBe(true);
    expect(await correoDe(ANA)).toBe(NUEVO());
    const acciones = (await q(`SELECT action FROM user_activity_log WHERE user_id = $1 ORDER BY id`, [ANA])).map((x) => x.action);
    expect(acciones).toEqual(expect.arrayContaining(['usuario.pedir_cambio_correo', 'usuario.cambiar_correo', 'usuario.confirmar_cambio_correo']));
  });

  it('con uno malo no cambia y avisa de cuántos intentos quedan; al quinto, se anula', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const malo = enviado.codigo === '000000' ? '111111' : '000000';
    for (let i = 1; i < INTENTOS; i++) {
      await expect(confirmarCodigo({ userId: ANA, codigo: malo })).rejects.toMatchObject({ code: 'CODIGO_INCORRECTO' });
    }
    await expect(confirmarCodigo({ userId: ANA, codigo: malo })).rejects.toMatchObject({ code: 'DEMASIADOS_INTENTOS' });
    // Ni el bueno vale ya: hay que pedir otro.
    await expect(confirmarCodigo({ userId: ANA, codigo: enviado.codigo })).rejects.toMatchObject({ code: 'SIN_CODIGO' });
    expect(await correoDe(ANA)).toBe(`ana@${MARCA.toLowerCase()}.test`);
  });

  it('caduca: pasado el plazo no vale', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    await q(`UPDATE cambios_de_correo SET expira_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [ANA]);
    await expect(confirmarCodigo({ userId: ANA, codigo: enviado.codigo })).rejects.toMatchObject({ code: 'CODIGO_CADUCADO' });
  });

  it('una petición nueva anula la anterior: solo vale el último código', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const primero = enviado.codigo;
    await pedir({ userId: ANA, emailNuevo: `otra.direccion@${MARCA.toLowerCase()}.test`, enviar });
    const segundo = enviado.codigo;
    if (primero !== segundo) {
      await expect(confirmarCodigo({ userId: ANA, codigo: primero })).rejects.toMatchObject({ code: 'CODIGO_INCORRECTO' });
    }
    await confirmarCodigo({ userId: ANA, codigo: segundo });
    expect(await correoDe(ANA)).toBe(`otra.direccion@${MARCA.toLowerCase()}.test`);
  });

  it('no se pide para el mismo correo', async () => {
    await expect(pedirCodigo({ userId: ANA, emailNuevo: `ana@${MARCA.toLowerCase()}.test`, enviar })).rejects.toMatchObject({ code: 'MISMO_CORREO' });
    expect(enviado).toBeNull();
  });

  // Revisión de Diego (#688, 06/11): antes un 409 EMAIL_EXISTS decía quién tiene cuenta.
  it('para uno que ya usa otra persona responde IGUAL, y no manda nada', async () => {
    const libre = await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const codigoDeLaLibre = enviado.codigo;
    enviado = null;
    const deOtra = await pedir({ userId: ANA, emailNuevo: `OTRA@${MARCA.toLowerCase()}.test`, enviar });
    expect(Object.keys(deOtra).sort()).toEqual(Object.keys(libre).sort());
    expect(deOtra).toMatchObject({ email: `otra@${MARCA.toLowerCase()}.test`, enviado: true });
    expect(enviado).toBeNull();
    // La que había pendiente se anula igual (solo vale la última petición): su código ya no abre nada.
    await expect(confirmarCodigo({ userId: ANA, codigo: codigoDeLaLibre })).rejects.toMatchObject({ code: 'CODIGO_INCORRECTO' });
    // Queda en el registro que no se mandó, y por qué.
    const r = await one(`SELECT details FROM user_activity_log WHERE user_id = $1 AND action = 'usuario.pedir_cambio_correo' ORDER BY id DESC LIMIT 1`, [ANA]);
    expect(JSON.stringify(r.details)).toMatch(/ya es de otro usuario/);
  });

  it('y confirmar tampoco lo delata: igual que con un correo libre, «incorrecto», cuenta intentos y al quinto se anula', async () => {
    const recorrido = async (email) => {
      await q('DELETE FROM cambios_de_correo WHERE user_id = $1', [ANA]);
      await pedir({ userId: ANA, emailNuevo: email, enviar });
      const codigos = [];
      // Códigos que no son el de la libre (si lo hay): lo que importa es la forma de las respuestas.
      const prueba = ['000000', '111111', '222222', '333333', '444444', '555555'].filter((c) => c !== enviado?.codigo);
      for (const c of prueba.slice(0, INTENTOS + 1)) {
        codigos.push(await confirmarCodigo({ userId: ANA, codigo: c }).then(() => 'CAMBIADO', (e) => e.code));
      }
      return codigos;
    };
    const libre = await recorrido(`libre.${NUEVO()}`);
    enviado = null;
    const deOtra = await recorrido(`OTRA@${MARCA.toLowerCase()}.test`);
    expect(deOtra).toEqual(libre);
    expect(libre).toEqual([...Array(INTENTOS - 1).fill('CODIGO_INCORRECTO'), 'DEMASIADOS_INTENTOS', 'SIN_CODIGO']);
    expect(await correoDe(ANA)).toBe(`ana@${MARCA.toLowerCase()}.test`);
  });

  it('el código se guarda como HMAC con la clave del servidor, no como un sha256 sin secreto', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const { codigo_hash: guardado } = await one('SELECT codigo_hash FROM cambios_de_correo WHERE user_id = $1 AND anulado_at IS NULL', [ANA]);
    const sinSecreto = crypto.createHash('sha256').update(enviado.codigo).digest('hex');
    const clave = process.env.CODIGO_CORREO_SECRET || process.env.JWT_SECRET;
    expect(guardado).not.toBe(sinSecreto);
    expect(guardado).toBe(crypto.createHmac('sha256', clave).update(enviado.codigo).digest('hex'));
  });

  it('dos peticiones a la vez no dan 500: se ponen en fila y queda viva solo una', async () => {
    const r = await Promise.allSettled([1, 2, 3].map((n) => pedirCodigo({ userId: ANA, emailNuevo: `a${n}.${NUEVO()}`, enviar })));
    expect(r.filter((x) => x.status === 'rejected').map((x) => x.reason?.message)).toEqual([]);
    const vivas = await q('SELECT id FROM cambios_de_correo WHERE user_id = $1 AND confirmado_at IS NULL AND anulado_at IS NULL', [ANA]);
    expect(vivas).toHaveLength(1);
  });

  it('si administración le cambia el correo, el código pendiente ya no vale (no deshace su cambio)', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const pendiente = enviado.codigo;
    const puesto = `puesto.por.super@${MARCA.toLowerCase()}.test`;
    await cambiarCorreo(ANA, puesto, { porUserId: OTRA });
    await expect(confirmarCodigo({ userId: ANA, codigo: pendiente })).rejects.toMatchObject({ code: 'SIN_CODIGO' });
    expect(await correoDe(ANA)).toBe(puesto);
  });
});

describe('#197 (CRM#211) · el freno de correos a tutores (Diego, 06/11, #688)', () => {
  it('con el freno puesto, a un tutor no se le manda el código: lo dice sin error y no guarda nada', async () => {
    expect(NO_ESCRIBIR_A_TUTORES).toBe(true);
    const r = await pedir({ userId: TUTOR, emailNuevo: `tutor.nuevo@${MARCA.toLowerCase()}.test`, enviar });
    expect(r).toMatchObject({ enviado: false, frenado: true, motivo: MENSAJE_FRENADO });
    expect(enviado).toBeNull();
    expect(await q('SELECT id FROM cambios_de_correo WHERE user_id = $1', [TUTOR])).toHaveLength(0);
  });

  it('también si es tutor como rol de más', async () => {
    await q(`UPDATE users SET roles_extra = '{tutor}' WHERE id = $1`, [OTRA]);
    try {
      const r = await pedir({ userId: OTRA, emailNuevo: `otra.nueva@${MARCA.toLowerCase()}.test`, enviar });
      expect(r.frenado).toBe(true);
      expect(enviado).toBeNull();
    } finally {
      await q(`UPDATE users SET roles_extra = '{}' WHERE id = $1`, [OTRA]);
    }
  });

  it('el tutor redactor (#708) cuenta como tutor: también frenado, de rol principal o de más', async () => {
    expect(codigoFrenadoPara({ role: 'tutor_redactor', roles_extra: [] })).toBe(true);
    expect(codigoFrenadoPara({ role: 'colaborador', roles_extra: ['tutor_redactor'] })).toBe(true);
    expect(codigoFrenadoPara({ role: 'colaborador', roles_extra: [] })).toBe(false);
    await q(`UPDATE users SET roles_extra = '{tutor_redactor}' WHERE id = $1`, [OTRA]);
    try {
      const r = await pedir({ userId: OTRA, emailNuevo: `otra.redactora@${MARCA.toLowerCase()}.test`, enviar });
      expect(r.frenado).toBe(true);
      expect(enviado).toBeNull();
    } finally {
      await q(`UPDATE users SET roles_extra = '{}' WHERE id = $1`, [OTRA]);
    }
  });
});

describe('#197 (CRM#211) · a la vez (revisión de Diego, #688, 05/11)', () => {
  // El intento se cuenta en una sola sentencia.
  it('a la vez, 20 intentos con códigos malos no pasan de 5: el resto ya no compara', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const bueno = enviado.codigo;
    // Veinte códigos malos, distintos del bueno, todos a la vez.
    const malos = [];
    for (let n = 0; malos.length < 20; n++) { const c = String(n).padStart(6, '0'); if (c !== bueno) malos.push(c); }
    const r = await Promise.allSettled(malos.map((c) => confirmarCodigo({ userId: ANA, codigo: c })));
    const codigos = r.map((x) => x.reason?.code);
    // Solo 5 llegan a comparar (4 «incorrecto» y el quinto anula); el resto, sin intentos.
    expect(codigos.filter((c) => c === 'CODIGO_INCORRECTO').length).toBeLessThanOrEqual(INTENTOS - 1);
    expect(codigos.every((c) => ['CODIGO_INCORRECTO', 'DEMASIADOS_INTENTOS', 'SIN_CODIGO'].includes(c))).toBe(true);
    const fila = await one('SELECT intentos, anulado_at FROM cambios_de_correo WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ANA]);
    expect(fila.intentos).toBe(INTENTOS);
    expect(fila.anulado_at).not.toBeNull();
    // Y ni el bueno vale ya.
    await expect(confirmarCodigo({ userId: ANA, codigo: bueno })).rejects.toMatchObject({ code: 'SIN_CODIGO' });
    expect(await correoDe(ANA)).toBe(`ana@${MARCA.toLowerCase()}.test`);
  });

  it('con el bueno dos veces a la vez, cambia una sola', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    const r = await Promise.allSettled([1, 2].map(() => confirmarCodigo({ userId: ANA, codigo: enviado.codigo })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await correoDe(ANA)).toBe(NUEVO());
  });

  it('si el cambio falla (el correo lo ha cogido otra persona), la petición no queda viva', async () => {
    await pedir({ userId: ANA, emailNuevo: NUEVO(), enviar });
    // Entre pedir el código y meterlo, otra persona se queda con ese correo.
    await q('UPDATE users SET email = $2 WHERE id = $1', [OTRA, NUEVO()]);
    try {
      await expect(confirmarCodigo({ userId: ANA, codigo: enviado.codigo })).rejects.toMatchObject({ code: 'EMAIL_EXISTS' });
      const fila = await one('SELECT confirmado_at, anulado_at FROM cambios_de_correo WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [ANA]);
      expect(fila.confirmado_at).toBeNull();
      expect(fila.anulado_at).not.toBeNull();
    } finally {
      await q('UPDATE users SET email = $2 WHERE id = $1', [OTRA, `otra@${MARCA.toLowerCase()}.test`]);
    }
  });
});
