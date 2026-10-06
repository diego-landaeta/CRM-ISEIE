import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { construirAmbito } from '../src/modules/mcp/mcp.acceso.js';
import { HERRAMIENTAS } from '../src/modules/mcp/mcp.tools.js';

/**
 * #215 (Carlos, 05/10): «¿cuánto cuesta el Máster X en Psiko?» o «dame los
 * precios de los cursos de CEDIA», con los mismos datos que la pantalla de
 * Productos. Contra la base de verdad, con un campus de prueba y tres
 * formaciones (una sin precio y otra con tutor), como pide la ficha de Diego.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/catalogoEnClaude.test.js
 */

const marca = `cat${Date.now().toString(36)}`;
const ids = { usuarios: [], productos: [], proyectos: [], colaboraciones: [] };
let CAMPUS; let OTRO;

const uno = async (sql, p) => (await query(sql, p)).rows[0];
const herramienta = (n) => HERRAMIENTAS.find((h) => h.nombre === n);
const admin = () => construirAmbito(
  { id: 999999, nombre: 'Admin de prueba', role: 'admin', active: true },
  [{ id: CAMPUS, nombre: `Campus ${marca}`, sociedad_id: null }, { id: OTRO, nombre: `Otro ${marca}`, sociedad_id: null }]
);
const gestoraDelCampus = () => construirAmbito(
  { id: 999998, nombre: 'Gestora de prueba', role: 'gestor', active: true },
  [{ id: CAMPUS, nombre: `Campus ${marca}`, sociedad_id: null }]
);

async function campus(nombre) {
  const p = await uno(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [nombre, nombre.toLowerCase().replace(/\s+/g, '-'), `${nombre}-key`]);
  ids.proyectos.push(p.id);
  return p.id;
}

async function formacion(projectId, nombre, { precio = null, url = null, plazas = null, ocupadas = 0, active = true } = {}) {
  const p = await uno(
    `INSERT INTO products (project_id, nombre, precio, moneda, url_info, plazas_totales, plazas_ocupadas_previas, active, stripe_link)
     VALUES ($1, $2, $3, 'EUR', $4, $5, $6, $7, 'https://buy.stripe.com/no-debe-salir') RETURNING id`,
    [projectId, nombre, precio, url, plazas, ocupadas, active]
  );
  ids.productos.push(p.id);
  return p.id;
}

let MASTER; let SIN_PRECIO; let CON_TUTOR; let AJENA;

beforeAll(async () => {
  CAMPUS = await campus(`Campus ${marca}`);
  OTRO = await campus(`Otro ${marca}`);
  MASTER = await formacion(CAMPUS, `Máster en Psicología Clínica ${marca}`, { precio: 1490, url: 'https://campus.test/master', plazas: 30, ocupadas: 12 });
  SIN_PRECIO = await formacion(CAMPUS, `Curso sin precio ${marca}`);
  CON_TUTOR = await formacion(CAMPUS, `Experto en Neuropsicología ${marca}`, { precio: 690, url: 'https://campus.test/experto' });
  await formacion(CAMPUS, `Retirado ${marca}`, { precio: 99, active: false });
  AJENA = await formacion(OTRO, `Máster de otro campus ${marca}`, { precio: 2000 });

  const t = await uno(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'tutor', true) RETURNING id`,
    [`Tutora ${marca}`, `tutora.${marca}@test.local`]
  );
  ids.usuarios.push(t.id);
  const c = await uno(
    `INSERT INTO tutor_collaborations (tutor_id, product_id, pct, vigente_desde, activa) VALUES ($1, $2, 17, '2026-01-01', true) RETURNING id`,
    [t.id, CON_TUTOR]
  );
  ids.colaboraciones.push(c.id);
}, 60000);

afterAll(async () => {
  await query('DELETE FROM tutor_collaborations WHERE id = ANY($1::int[])', [ids.colaboraciones]);
  await query('DELETE FROM products WHERE project_id = ANY($1::int[])', [ids.proyectos]);
  await query('DELETE FROM users WHERE id = ANY($1::int[])', [ids.usuarios]);
  await query('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.proyectos]);
}, 60000);

describe('listar_formaciones', () => {
  it('da precio, moneda, campus y enlace de cada formación activa, como la pantalla', async () => {
    const r = await herramienta('listar_formaciones').ejecutar(admin(), { proyecto_id: CAMPUS, pagina: 1, limite: 25 });
    expect(r.total).toBe(3); // la retirada no sale
    const master = r.formaciones.find((f) => f.id === MASTER);
    expect(master).toMatchObject({ precio: 1490, moneda: 'EUR', campus: `Campus ${marca}`, enlace: 'https://campus.test/master' });
    expect(r.formaciones.find((f) => f.id === SIN_PRECIO).precio).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/stripe/);
  });

  it('busca sin distinguir mayúsculas ni tildes', async () => {
    for (const texto of ['psicologia clinica', 'PSICOLOGÍA CLÍNICA', 'neuropsicologia']) {
      const r = await herramienta('listar_formaciones').ejecutar(admin(), { proyecto_id: CAMPUS, texto, pagina: 1, limite: 25 });
      expect(r.total, texto).toBe(1);
    }
  });

  it('un «%» escrito por Claude no es un comodín', async () => {
    const r = await herramienta('listar_formaciones').ejecutar(admin(), { proyecto_id: CAMPUS, texto: '%', pagina: 1, limite: 25 });
    expect(r.total).toBe(0);
  });

  it('pagina, y dice el total y las páginas', async () => {
    const p1 = await herramienta('listar_formaciones').ejecutar(admin(), { proyecto_id: CAMPUS, pagina: 1, limite: 2 });
    const p2 = await herramienta('listar_formaciones').ejecutar(admin(), { proyecto_id: CAMPUS, pagina: 2, limite: 2 });
    expect([p1.total, p1.paginas, p1.formaciones.length, p2.formaciones.length]).toEqual([3, 2, 2, 1]);
    expect(p1.formaciones.map((f) => f.id)).not.toContain(p2.formaciones[0].id);
  });

  it('sin texto y con más de 100, avisa de que pida un nombre o use el resumen', async () => {
    const { rows } = await query(
      `INSERT INTO products (project_id, nombre, precio, moneda, active)
       SELECT $1, 'Relleno ' || g || ' ${marca}', 100, 'EUR', true FROM generate_series(1, 100) g RETURNING id`,
      [OTRO]
    );
    ids.productos.push(...rows.map((r) => r.id));
    const r = await herramienta('listar_formaciones').ejecutar(admin(), { proyecto_id: OTRO, pagina: 1, limite: 25 });
    expect(r.total).toBe(101);
    expect(r.aviso).toMatch(/^Hay 101 formaciones en Otro .*: pide un nombre \(texto\) o usa «resumen_catalogo»\.$/);
    await query('DELETE FROM products WHERE id = ANY($1::int[])', [rows.map((x) => x.id)]);
  });

  it('una gestora ve las de su campus y no las de otro', async () => {
    const r = await herramienta('listar_formaciones').ejecutar(gestoraDelCampus(), { pagina: 1, limite: 25 });
    expect(r.formaciones.map((f) => f.id)).toEqual(expect.arrayContaining([MASTER, SIN_PRECIO, CON_TUTOR]));
    expect(r.formaciones.map((f) => f.id)).not.toContain(AJENA);
    // Como en mcpAmbito: el 403 sale antes de llegar a la base, sin promesa de por medio.
    await expect((async () => herramienta('listar_formaciones').ejecutar(gestoraDelCampus(), { proyecto_id: OTRO, pagina: 1, limite: 25 }))())
      .rejects.toThrow(/No tienes acceso al campus/);
  });
});

describe('resumen_catalogo', () => {
  it('por campus: cuántas, precio mínimo, máximo y más habitual, monedas, y cuántas sin precio o sin enlace', async () => {
    const r = await herramienta('resumen_catalogo').ejecutar(admin(), { proyecto_id: CAMPUS });
    expect(r.campus).toHaveLength(1);
    expect(r.campus[0]).toMatchObject({
      campus: `Campus ${marca}`, formaciones: 3,
      precio_minimo: 690, precio_maximo: 1490, monedas: ['EUR'],
      sin_precio: 1, sin_enlace: 1,
    });
    // 690 y 1490 salen una vez cada uno: no hay uno «más habitual».
    expect(r.campus[0].precio_mas_habitual).toBeNull();
  });

  it('el más habitual es el que se repite (prueba con Claude, 06/10: con 385, 490 y 560 decía «385»)', async () => {
    const { rows } = await query(
      `INSERT INTO products (project_id, nombre, precio, moneda, active)
       VALUES ($1, 'Repetido A ${marca}', 690, 'EUR', true), ($1, 'Repetido B ${marca}', 690, 'EUR', true) RETURNING id`,
      [OTRO]
    );
    try {
      const r = await herramienta('resumen_catalogo').ejecutar(admin(), { proyecto_id: OTRO });
      expect(r.campus[0]).toMatchObject({ formaciones: 3, precio_mas_habitual: 690, precio_minimo: 690, precio_maximo: 2000 });
    } finally {
      await query('DELETE FROM products WHERE id = ANY($1::int[])', [rows.map((x) => x.id)]);
    }
  });
});

describe('ver_formacion', () => {
  it('la ficha, con plazas libres, y del tutor solo el nombre (nunca su porcentaje)', async () => {
    const m = await herramienta('ver_formacion').ejecutar(admin(), { id: MASTER });
    expect(m).toMatchObject({ curso: `Máster en Psicología Clínica ${marca}`, precio: 1490, plazas_totales: 30, plazas_libres: 18, tiene_dossier: false });
    const t = await herramienta('ver_formacion').ejecutar(admin(), { id: CON_TUTOR });
    expect(t.tutor).toBe(`Tutora ${marca}`);
    // Ni el campo del porcentaje ni el enlace de pago. (Se mira el campo, no el
    // número 17: en el CI el campus de prueba salió con el id 17.)
    expect(Object.keys(t)).not.toEqual(expect.arrayContaining(['pct']));
    expect(JSON.stringify(t)).not.toMatch(/"pct"|porcentaje|comision|stripe/i);
  });

  it('lo que el CRM no tiene, vacío: plazas, cierre de convocatoria y dossier (Claude dirá «no consta»)', async () => {
    const s = await herramienta('ver_formacion').ejecutar(admin(), { id: SIN_PRECIO });
    expect(s).toMatchObject({ precio: null, plazas_totales: null, plazas_libres: null, cierre_convocatoria: null, tiene_dossier: false, tutor: null });
  });

  it('una de otro campus: 403, y una que no existe: 404', async () => {
    await expect(herramienta('ver_formacion').ejecutar(gestoraDelCampus(), { id: AJENA })).rejects.toMatchObject({ statusCode: 403 });
    await expect(herramienta('ver_formacion').ejecutar(admin(), { id: 2147483000 })).rejects.toMatchObject({ statusCode: 404 });
  });
});
