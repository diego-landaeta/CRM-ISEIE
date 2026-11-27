import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as metaClient from './meta-ads.client.js';
import { packToken, unpackToken } from './meta-ads.service.js';
import { notifyAdmins } from '../notifications/notifications.service.js';

// Busqueda insensible a tildes sin depender de la extension unaccent (#198,
// gemela de CRM#212, mismo patron que sales.service.js: no esta en los dos CRM).
const SIN_TILDES = (expr) =>
  `translate(${expr}, 'áàäâãéèëêíìïîóòöôõúùüûñÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑçÇ',
                      'aaaaaeeeeiiiiooooouuuunAAAAAEEEEIIIIOOOOOUUUUNcC')`;

/**
 * El campus cuyo nombre aparece dentro del nombre de la cuenta de Meta
 * («Psiko Aprende 3» → «Psiko Aprende»). El más largo que encaje, por si
 * varios nombres de campus son substrings unos de otros.
 */
async function sugerirCampus(nombreCuenta) {
  if (!nombreCuenta) return null;
  const { rows } = await query(
    `SELECT id FROM projects
     WHERE active = true AND ${SIN_TILDES('$1')} ILIKE '%' || ${SIN_TILDES('nombre')} || '%'
     ORDER BY length(nombre) DESC
     LIMIT 1`,
    [nombreCuenta]
  );
  return rows[0]?.id || null;
}

/**
 * Conecta un portfolio (Business Manager) entero. Valida el token contra Meta
 * antes de guardarlo (que de verdad vea el portfolio). Reconectar el mismo
 * business_id actualiza el token y el nombre.
 */
export async function connectPortfolio({ businessId, nombre, accessToken, userId }) {
  await metaClient.listOwnedAdAccounts({ businessId, accessToken, limit: 1 });
  const tokenEnc = packToken(accessToken);
  const { rows } = await query(
    `INSERT INTO meta_business_portfolios (business_id, nombre, access_token_enc, created_by_user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (business_id) DO UPDATE SET
       nombre = EXCLUDED.nombre, access_token_enc = EXCLUDED.access_token_enc, updated_at = NOW()
     RETURNING id, business_id, nombre, created_at`,
    [businessId, nombre || null, tokenEnc, userId]
  );
  return rows[0];
}

/** Lista los portfolios conectados. NUNCA devuelve el token. */
export async function listPortfolios() {
  const { rows } = await query(
    `SELECT id, business_id, nombre, last_synced_at, last_sync_status, last_sync_error, created_at
     FROM meta_business_portfolios ORDER BY created_at ASC`
  );
  return rows;
}

/** Desconecta un portfolio. Las cuentas ya asignadas (en meta_ad_accounts) no se tocan. */
export async function disconnectPortfolio(portfolioId) {
  await query(`DELETE FROM meta_business_portfolios WHERE id = $1`, [portfolioId]);
}

/**
 * Pide a Meta las cuentas propias del portfolio y las compara con lo que ya
 * se conoce (#198). Una cuenta ya conectada (a mano o por otro ciclo) entra
 * como 'asignada' y no se duplica. Una realmente nueva entra como 'nueva',
 * con el campus sugerido por el nombre, y avisa a los admins una sola vez
 * (las siguientes vueltas, al seguir en 'nueva', no vuelven a avisar).
 */
export async function syncPortfolio(portfolioId) {
  const { rows } = await query(`SELECT * FROM meta_business_portfolios WHERE id = $1`, [portfolioId]);
  const portfolio = rows[0];
  if (!portfolio) throw new AppError('Portfolio no encontrado', 404, 'PORTFOLIO_NOT_FOUND');

  await query(`UPDATE meta_business_portfolios SET last_sync_status = 'in_progress', updated_at = NOW() WHERE id = $1`, [portfolioId]);

  const accessToken = unpackToken(portfolio.access_token_enc);
  try {
    const cuentas = await metaClient.listOwnedAdAccounts({ businessId: portfolio.business_id, accessToken });

    let nuevas = 0;
    for (const cuenta of cuentas) {
      const adAccountId = `act_${cuenta.account_id}`;
      const conectada = await query(`SELECT id FROM meta_ad_accounts WHERE ad_account_id = $1`, [adAccountId]);
      const metaAdAccountId = conectada.rows[0]?.id || null;
      const campus = metaAdAccountId ? null : await sugerirCampus(cuenta.name);

      const { rows: upsert } = await query(
        `INSERT INTO meta_portfolio_discovered_accounts
           (portfolio_id, ad_account_id, nombre, estado, campus_sugerido_id, meta_ad_account_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (portfolio_id, ad_account_id) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           meta_ad_account_id = COALESCE(meta_portfolio_discovered_accounts.meta_ad_account_id, EXCLUDED.meta_ad_account_id),
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS es_nueva`,
        [portfolioId, adAccountId, cuenta.name || null, metaAdAccountId ? 'asignada' : 'nueva', campus, metaAdAccountId]
      );
      if (upsert[0]?.es_nueva && !metaAdAccountId) nuevas++;
    }

    await query(`UPDATE meta_business_portfolios SET last_sync_status = 'ok', last_sync_error = NULL, last_synced_at = NOW(), updated_at = NOW() WHERE id = $1`, [portfolioId]);

    if (nuevas > 0) {
      await notifyAdmins({
        type: 'meta_portfolio_cuenta_nueva',
        title: nuevas === 1 ? 'Una cuenta nueva en el portfolio de Meta' : `${nuevas} cuentas nuevas en el portfolio de Meta`,
        message: `En «${portfolio.nombre || portfolio.business_id}». Revisa la bandeja en Meta Ads › Portfolios.`,
        link_path: '/meta-ads?tab=portfolio',
      });
    }

    return { cuentasVistas: cuentas.length, nuevas };
  } catch (err) {
    await query(`UPDATE meta_business_portfolios SET last_sync_status = 'error', last_sync_error = $2, updated_at = NOW() WHERE id = $1`, [portfolioId, err.message]);
    throw err;
  }
}

/** Las cuentas descubiertas de un portfolio, con el nombre del campus sugerido. */
export async function listDiscoveredAccounts(portfolioId) {
  const { rows } = await query(
    `SELECT d.id, d.ad_account_id, d.nombre, d.estado, d.campus_sugerido_id,
            p.nombre AS campus_sugerido_nombre, d.meta_ad_account_id, d.created_at, d.updated_at
     FROM meta_portfolio_discovered_accounts d
     LEFT JOIN projects p ON p.id = d.campus_sugerido_id
     WHERE d.portfolio_id = $1
     ORDER BY (d.estado = 'nueva') DESC, d.created_at DESC`,
    [portfolioId]
  );
  return rows;
}

/**
 * Asigna una cuenta descubierta a un campus: la conecta de verdad en
 * meta_ad_accounts (backfill_done queda en FALSE, así que el scheduler de
 * siempre le trae todo el histórico, igual que un alta a mano). Si el token
 * del portfolio no tiene acceso directo, intenta dárselo (solo ver,
 * ANALYZE) y reintenta una vez antes de rendirse con 'sin_acceso'.
 */
export async function assignDiscoveredAccount(discoveredId, { projectId, userId }) {
  const { rows } = await query(
    `SELECT d.*, b.access_token_enc
     FROM meta_portfolio_discovered_accounts d
     JOIN meta_business_portfolios b ON b.id = d.portfolio_id
     WHERE d.id = $1`,
    [discoveredId]
  );
  const descubierta = rows[0];
  if (!descubierta) throw new AppError('Cuenta no encontrada', 404, 'DISCOVERED_NOT_FOUND');
  if (descubierta.estado === 'asignada') throw new AppError('Ya está asignada', 400, 'YA_ASIGNADA');

  const accessToken = unpackToken(descubierta.access_token_enc);
  let info;
  try {
    info = await metaClient.validateConnection({ adAccountId: descubierta.ad_account_id, accessToken });
  } catch {
    try {
      const owner = await metaClient.getTokenOwnerId({ accessToken });
      await metaClient.grantAnalystAccess({ adAccountId: descubierta.ad_account_id, userId: owner.id, accessToken });
      info = await metaClient.validateConnection({ adAccountId: descubierta.ad_account_id, accessToken });
    } catch {
      await query(`UPDATE meta_portfolio_discovered_accounts SET estado = 'sin_acceso', updated_at = NOW() WHERE id = $1`, [discoveredId]);
      throw new AppError(
        'Sin acceso a esta cuenta: dásela a mano en Meta (Configuración del negocio › Usuarios › Usuarios del sistema) e inténtalo de nuevo.',
        403, 'SIN_ACCESO'
      );
    }
  }

  const { rows: cuentaRows } = await query(
    `INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc, ad_account_nombre, currency, timezone_name, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id, ad_account_id) DO UPDATE SET
       access_token_enc = EXCLUDED.access_token_enc, ad_account_nombre = EXCLUDED.ad_account_nombre,
       currency = EXCLUDED.currency, timezone_name = EXCLUDED.timezone_name, updated_at = NOW()
     RETURNING id`,
    [projectId, descubierta.ad_account_id, packToken(accessToken), info.nombre, info.currency, info.timezone_name, userId]
  );
  const metaAdAccountId = cuentaRows[0].id;

  await query(
    `UPDATE meta_portfolio_discovered_accounts SET estado = 'asignada', meta_ad_account_id = $2, updated_at = NOW() WHERE id = $1`,
    [discoveredId, metaAdAccountId]
  );

  return { metaAdAccountId };
}

/** Ignorar es definitivo: no vuelve a salir en la bandeja. */
export async function ignoreDiscoveredAccount(discoveredId) {
  const { rows } = await query(
    `UPDATE meta_portfolio_discovered_accounts SET estado = 'ignorada', updated_at = NOW()
     WHERE id = $1 AND estado != 'asignada'
     RETURNING id`,
    [discoveredId]
  );
  if (!rows[0]) throw new AppError('No se puede ignorar (no existe o ya está asignada)', 400, 'NO_SE_PUEDE_IGNORAR');
}