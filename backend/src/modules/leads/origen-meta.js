/**
 * EL CONJUNTO Y EL ANUNCIO DE META DE CADA PROSPECTO (puerta 8, #487; gemela de CRM#806).
 *
 * Manuel, 16/11/2026: «qué creativos cambiamos». Para contestarlo leyendo solo el
 * CRM, cada prospecto de Meta tiene que decir de qué campaña, conjunto y anuncio
 * vino. Por dónde puede llegar:
 *
 *   · Los anuncios con la web de destino llevan las UTM dinámicas de Meta en la
 *     dirección: utm_campaign = {{campaign.id}}, utm_term = {{adset.id}},
 *     utm_content = {{ad.id}} (es lo que hay en los prospectos de Meta de la base
 *     de pruebas de MultiCRM). Como cada cuenta puede montar la plantilla a su manera, un id
 *     de las UTM NO se cree por su posición: se busca en las tablas de Meta del
 *     campus y vale lo que encuentre (`meta_origen_por = 'url'`).
 *   · Los formularios instantáneos (Lead Ads) entran por Make, que sí sabe los
 *     ids: `ad_id`, `adset_id`, `campaign_id` (o `meta_*`), sueltos o en
 *     `custom_fields`. Esos se creen tal cual (`meta_origen_por = 'envio'`).
 *
 * Con el anuncio se sabe su conjunto y su campaña; con el conjunto, su campaña.
 *
 * Y la formación de interés, si no vino: la del conjunto (`meta_adset_products`,
 * a mano o automática, puerta 7) o, si no, la de la campaña
 * (`meta_campaign_products`), solo cuando es UNA.
 *
 * Lo que entra antes de que la sincronización traiga el anuncio se completa
 * después: `rellenarOrigenMeta` corre tras cada sincronización de Meta.
 */
import { query } from '../../shared/config/db.js';

const ID_META = /^\d{6,30}$/;
const comoId = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return ID_META.test(s) ? s : null;
};

function parametros(url) {
  try { return new URL(url).searchParams; } catch { return new URLSearchParams(); }
}

/**
 * Lo que trae el envío: los ids que vienen con su nombre (se creen) y los números
 * de las UTM que PUEDEN ser ids (hay que confirmarlos). Sin tocar la base.
 */
export function idsMetaDelEnvio(leadData = {}) {
  const extra = leadData.custom_fields && typeof leadData.custom_fields === 'object' ? leadData.custom_fields : {};
  const url = parametros(leadData.landing_url);
  const primero = (...vals) => vals.map(comoId).find(Boolean) || null;
  const explicitos = {
    ad: primero(leadData.meta_ad_id, leadData.ad_id, extra.meta_ad_id, extra.ad_id, url.get('ad_id')),
    adset: primero(leadData.meta_adset_id, leadData.adset_id, extra.meta_adset_id, extra.adset_id, extra.ad_set_id, url.get('adset_id')),
    campaign: primero(leadData.meta_campaign_id, leadData.campaign_id, extra.meta_campaign_id, extra.campaign_id, url.get('campaign_id')),
  };
  const candidatos = [...new Set([
    leadData.utm_content, leadData.utm_term, leadData.utm_campaign, leadData.utm_id,
    url.get('utm_content'), url.get('utm_term'), url.get('utm_campaign'), url.get('utm_id'),
  ].map(comoId).filter(Boolean))];
  return { explicitos, candidatos };
}

/**
 * La campaña, el conjunto y el anuncio del prospecto, o null si no hay nada de
 * Meta. Solo lee.
 */
export async function resolverOrigenMeta(projectId, leadData, { q = query } = {}) {
  const { explicitos, candidatos } = idsMetaDelEnvio(leadData);
  const hayExplicitos = Boolean(explicitos.ad || explicitos.adset || explicitos.campaign);
  if (!hayExplicitos && !candidatos.length) return null;

  const todos = [...new Set([...candidatos, explicitos.ad, explicitos.adset].filter(Boolean))];
  const [{ rows: anuncios }, { rows: conjuntos }, { rows: campanas }] = await Promise.all([
    q(`SELECT ad_id, adset_id, campaign_id FROM meta_ads WHERE project_id = $1 AND ad_id = ANY($2::text[])`, [projectId, todos]),
    q(`SELECT adset_id, campaign_id FROM meta_adsets WHERE project_id = $1 AND adset_id = ANY($2::text[])`, [projectId, todos]),
    q(`SELECT campaign_id FROM meta_campaigns WHERE project_id = $1 AND campaign_id = ANY($2::text[])`, [projectId, candidatos]),
  ]);

  // Un número de las UTM vale si es UNO de cada tipo: con dos anuncios distintos no se adivina.
  const unico = (filas, col) => {
    const ids = [...new Set(filas.filter((f) => candidatos.includes(f[col])).map((f) => f[col]))];
    return ids.length === 1 ? ids[0] : null;
  };
  let ad = explicitos.ad || unico(anuncios, 'ad_id');
  let adset = explicitos.adset || unico(conjuntos, 'adset_id');
  let campaign = explicitos.campaign || unico(campanas, 'campaign_id');

  // Lo de arriba completa lo de abajo: el anuncio dice su conjunto y su campaña.
  const filaAd = ad ? anuncios.find((f) => f.ad_id === ad) : null;
  if (filaAd) {
    adset = adset || filaAd.adset_id;
    campaign = campaign || filaAd.campaign_id;
  }
  const filaAdset = adset ? conjuntos.find((f) => f.adset_id === adset) : null;
  if (filaAdset) campaign = campaign || filaAdset.campaign_id;
  if (adset && !campaign && !filaAdset) {
    const { rows } = await q(`SELECT campaign_id FROM meta_adsets WHERE project_id = $1 AND adset_id = $2`, [projectId, adset]);
    campaign = rows[0]?.campaign_id || null;
  }

  if (!ad && !adset && !campaign) return null;
  return {
    meta_campaign_id: campaign || null,
    meta_adset_id: adset || null,
    meta_ad_id: ad || null,
    meta_origen_por: hayExplicitos ? 'envio' : 'url',
  };
}

/**
 * La formación de la publicidad: la ÚNICA del conjunto y, si el conjunto no tiene,
 * la única de la campaña. Solo formaciones activas del campus. null si no hay o
 * hay varias.
 */
export async function formacionDeLaPublicidad(projectId, origen, { q = query } = {}) {
  if (!origen) return null;
  const una = async (sql, id) => {
    if (!id) return null;
    const { rows } = await q(sql, [projectId, id]);
    return rows.length === 1 ? rows[0].product_id : null;
  };
  return (await una(
    `SELECT DISTINCT x.product_id FROM meta_adset_products x JOIN products p ON p.id = x.product_id
      WHERE x.project_id = $1 AND x.adset_id = $2 AND p.project_id = $1 AND p.active = true`, origen.meta_adset_id))
    || (await una(
      `SELECT DISTINCT x.product_id FROM meta_campaign_products x JOIN products p ON p.id = x.product_id
        WHERE p.project_id = $1 AND x.campaign_id = $2 AND p.active = true`, origen.meta_campaign_id));
}

/**
 * Apunta el origen de Meta en la fila de UTM del prospecto (la crea si no hay).
 * Va aparte del alta y no la tumba: si falla, el prospecto entra igual.
 */
export async function guardarOrigenMeta(leadId, origen, { canal = null, q = query } = {}) {
  if (!leadId || !origen) return;
  await q(
    `INSERT INTO lead_utms (lead_id, canal_detectado, meta_campaign_id, meta_adset_id, meta_ad_id, meta_origen_por)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (lead_id) DO UPDATE SET
       meta_campaign_id = EXCLUDED.meta_campaign_id,
       meta_adset_id    = EXCLUDED.meta_adset_id,
       meta_ad_id       = EXCLUDED.meta_ad_id,
       meta_origen_por  = EXCLUDED.meta_origen_por`,
    [leadId, canal, origen.meta_campaign_id, origen.meta_adset_id, origen.meta_ad_id, origen.meta_origen_por]
  );
}

/**
 * Completa lo que entró antes de que la sincronización trajera su anuncio (y lo
 * de antes de esta migración): para los prospectos del campus sin origen de Meta
 * y con un número en las UTM que ahora SÍ está en las tablas de Meta. Y les pone
 * la formación de la publicidad si no tenían ninguna (solo los de los últimos
 * `dias`: lo viejo no se reescribe). Devuelve cuántos se tocaron.
 */
export async function rellenarOrigenMeta(projectId, { dias = 30, q = query } = {}) {
  const sinOrigen = `lu.meta_ad_id IS NULL AND lu.meta_adset_id IS NULL AND lu.meta_campaign_id IS NULL`;
  const anuncios = await q(
    `UPDATE lead_utms lu
        SET meta_ad_id = a.ad_id, meta_adset_id = a.adset_id, meta_campaign_id = a.campaign_id, meta_origen_por = 'url'
       FROM leads l, meta_ads a
      WHERE l.id = lu.lead_id AND l.project_id = $1 AND ${sinOrigen}
        AND a.project_id = $1 AND a.ad_id IN (lu.utm_content, lu.utm_term, lu.utm_campaign)`,
    [projectId]
  );
  const conjuntos = await q(
    `UPDATE lead_utms lu
        SET meta_adset_id = s.adset_id, meta_campaign_id = s.campaign_id, meta_origen_por = 'url'
       FROM leads l, meta_adsets s
      WHERE l.id = lu.lead_id AND l.project_id = $1 AND ${sinOrigen}
        AND s.project_id = $1 AND s.adset_id IN (lu.utm_term, lu.utm_content, lu.utm_campaign)`,
    [projectId]
  );
  const campanas = await q(
    `UPDATE lead_utms lu
        SET meta_campaign_id = c.campaign_id, meta_origen_por = 'url'
       FROM leads l, meta_campaigns c
      WHERE l.id = lu.lead_id AND l.project_id = $1 AND ${sinOrigen}
        AND c.project_id = $1 AND c.campaign_id IN (lu.utm_campaign, lu.utm_term, lu.utm_content)`,
    [projectId]
  );
  // La formación de interés, solo donde no hay ninguna y la publicidad tiene UNA.
  const formaciones = await q(
    `UPDATE leads l
        SET producto_interes_id = f.product_id, updated_at = NOW()
       FROM (
         SELECT lu.lead_id,
                COALESCE(
                  (SELECT MIN(x.product_id) FROM meta_adset_products x JOIN products p ON p.id = x.product_id AND p.active
                    WHERE x.adset_id = lu.meta_adset_id AND x.project_id = $1
                   HAVING COUNT(DISTINCT x.product_id) = 1),
                  (SELECT MIN(x.product_id) FROM meta_campaign_products x JOIN products p ON p.id = x.product_id AND p.active AND p.project_id = $1
                    WHERE x.campaign_id = lu.meta_campaign_id
                   HAVING COUNT(DISTINCT x.product_id) = 1)) AS product_id
           FROM lead_utms lu
          WHERE lu.meta_adset_id IS NOT NULL OR lu.meta_campaign_id IS NOT NULL
       ) f
      WHERE l.id = f.lead_id AND l.project_id = $1 AND l.producto_interes_id IS NULL AND f.product_id IS NOT NULL
        AND l.deleted_at IS NULL AND l.created_at > NOW() - make_interval(days => $2::int)`,
    [projectId, dias]
  );
  return {
    anuncios: anuncios.rowCount || 0,
    conjuntos: conjuntos.rowCount || 0,
    campanas: campanas.rowCount || 0,
    formaciones: formaciones.rowCount || 0,
  };
}
