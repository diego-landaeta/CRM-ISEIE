/**
 * Rellenar el país de entrada de los prospectos que ya estaban (#221).
 *
 * Lo llama `scripts/rellenar-pais-origen.mjs`; aquí está la lógica para poder
 * probarla sin base (la regla, en `pais.js`, es la misma que usa el alta).
 *
 * De dónde saca la dirección de cada prospecto, por este orden:
 *   1. `leads.landing_url`                         (ficha)
 *   2. `lead_utms.landing_url`                     (origen)
 *   3. el envío de Make que lo creó                (make)       — `make_webhook_deliveries.payload`
 *   4. la decisión de la asignación por actividad  (asignacion) — `asignacion_decisiones.datos`
 * Las dos últimas cubren los que entraron por un webhook de Make cuyo mapeo no
 * tenía `landing_url` aunque el envío trajera la página.
 *
 * Qué toca: SOLO `leads.pais_origen` de los que no lo tienen, en los campus que
 * tienen tabla de países. Uno con país no se toca: por eso se puede pasar
 * tantas veces como haga falta (también después de añadir un país nuevo a la
 * tabla de un campus). No rellena `landing_url` ni nada más.
 */
import { planearPaises, normalizarMapa } from './pais.js';
import { urlDeLaPagina } from '../make/make.campos-habituales.js';

/** ¿Existe la tabla? (en una base a medias puede faltar la de asignación) */
async function hayTabla(db, nombre) {
  const { rows } = await db.query('SELECT to_regclass($1) IS NOT NULL AS hay', [nombre]);
  return Boolean(rows[0]?.hay);
}

/**
 * @param db       pool o cliente de `pg` (con `.query`)
 * @param opciones { aplicar = false, campus = null (id de un campus) }
 * @returns resumen { campus, revisados, cambios, yaTenian, sinUrl, sinTabla, sinPais, porPais, porFuente, aplicado }
 */
export async function rellenarPaisOrigen(db, { aplicar = false, campus = null } = {}) {
  // Los campus con tabla de países.
  const { rows: proyectos } = await db.query(
    `SELECT id, nombre, paises_por_subdominio AS mapa
       FROM projects
      WHERE paises_por_subdominio <> '{}'::jsonb
        AND ($1::int IS NULL OR id = $1::int)`,
    [campus]
  );
  const mapas = {};
  for (const p of proyectos) {
    const mapa = normalizarMapa(p.mapa);
    if (Object.keys(mapa).length) mapas[p.id] = mapa;
  }
  const ids = Object.keys(mapas).map(Number);
  const vacio = { campus: proyectos.map((p) => ({ id: Number(p.id), nombre: p.nombre })), revisados: 0, cambios: [], yaTenian: 0, sinUrl: 0, sinTabla: 0, sinPais: 0, porPais: {}, porFuente: {}, aplicado: false };
  if (!ids.length) return vacio;

  // Los prospectos sin país de esos campus, con las dos direcciones que guarda el CRM.
  const { rows: leads } = await db.query(
    `SELECT l.id AS lead_id, l.project_id, l.pais_origen,
            NULLIF(l.landing_url, '') AS url_ficha,
            NULLIF(u.landing_url, '') AS url_origen
       FROM leads l
       LEFT JOIN lead_utms u ON u.lead_id = l.id
      WHERE l.deleted_at IS NULL
        AND l.pais_origen IS NULL
        AND l.project_id = ANY($1::int[])`,
    [ids]
  );
  if (!leads.length) return { ...vacio, revisados: 0 };

  // Lo que mandó Make, para los que no traen dirección propia.
  const sinDireccion = leads.filter((l) => !l.url_ficha && !l.url_origen).map((l) => Number(l.lead_id));
  const deMake = new Map();
  const deAsignacion = new Map();
  if (sinDireccion.length) {
    if (await hayTabla(db, 'make_webhook_deliveries')) {
      const { rows } = await db.query(
        `SELECT lead_id, payload FROM make_webhook_deliveries
          WHERE lead_id = ANY($1::int[]) AND payload IS NOT NULL
          ORDER BY received_at ASC`,
        [sinDireccion]
      );
      for (const r of rows) {
        const url = urlDeLaPagina(r.payload);
        if (url && !deMake.has(Number(r.lead_id))) deMake.set(Number(r.lead_id), url);
      }
    }
    if (await hayTabla(db, 'asignacion_decisiones')) {
      const { rows } = await db.query(
        `SELECT lead_id, datos FROM asignacion_decisiones
          WHERE lead_id = ANY($1::int[]) AND datos IS NOT NULL`,
        [sinDireccion]
      );
      for (const r of rows) {
        const url = urlDeLaPagina(r.datos);
        if (url && !deAsignacion.has(Number(r.lead_id))) deAsignacion.set(Number(r.lead_id), url);
      }
    }
  }

  const filas = leads.map((l) => ({
    lead_id: Number(l.lead_id),
    project_id: Number(l.project_id),
    pais_origen: l.pais_origen,
    urls: [
      { url: l.url_ficha, fuente: 'ficha' },
      { url: l.url_origen, fuente: 'origen' },
      { url: deMake.get(Number(l.lead_id)), fuente: 'make' },
      { url: deAsignacion.get(Number(l.lead_id)), fuente: 'asignacion' },
    ],
  }));
  const plan = planearPaises(filas, mapas);

  const porPais = {};
  const porFuente = {};
  for (const c of plan.cambios) {
    porPais[c.pais] = (porPais[c.pais] || 0) + 1;
    porFuente[c.fuente] = (porFuente[c.fuente] || 0) + 1;
  }

  if (aplicar && plan.cambios.length) {
    await db.query('BEGIN');
    try {
      // Para deshacer: qué se rellenó y de dónde salió.
      await db.query(
        `CREATE TABLE IF NOT EXISTS leads_pais_origen_rellenado (
           lead_id INTEGER NOT NULL, pais VARCHAR(2) NOT NULL, fuente TEXT, url TEXT,
           rellenado_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
      );
      for (const c of plan.cambios) {
        // `pais_origen IS NULL` otra vez: si el alta lo puso entre medias, se respeta.
        const { rowCount } = await db.query(
          'UPDATE leads SET pais_origen = $2 WHERE id = $1 AND pais_origen IS NULL',
          [c.lead_id, c.pais]
        );
        if (rowCount) {
          await db.query(
            'INSERT INTO leads_pais_origen_rellenado (lead_id, pais, fuente, url) VALUES ($1, $2, $3, $4)',
            [c.lead_id, c.pais, c.fuente, c.url]
          );
        }
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  return {
    campus: proyectos.map((p) => ({ id: Number(p.id), nombre: p.nombre })),
    revisados: leads.length,
    cambios: plan.cambios,
    yaTenian: plan.yaTenian,
    sinUrl: plan.sinUrl,
    sinTabla: plan.sinTabla,
    sinPais: plan.sinPais,
    porPais,
    porFuente,
    aplicado: Boolean(aplicar && plan.cambios.length),
  };
}
