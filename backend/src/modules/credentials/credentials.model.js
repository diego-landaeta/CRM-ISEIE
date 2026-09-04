import { query } from '../../shared/config/db.js';
import { encrypt, decrypt, maskSecret } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/utils/logger.js';

export async function list({ projectId, service }) {
  const conditions = ['ac.active = true'];
  const params = [];
  let idx = 1;
  if (projectId !== undefined) {
    conditions.push(projectId === null ? `ac.project_id IS NULL` : `ac.project_id = $${idx++}`);
    if (projectId !== null) params.push(projectId);
  }
  if (service) { conditions.push(`ac.service = $${idx++}`); params.push(service); }

  // NO se traen `encrypted_value`, `iv` ni `auth_tag`. Antes si, para descifrar
  // cada una y enmascararla: un listado de veinte credenciales descifraba
  // veinte secretos en memoria para enseñar cuatro caracteres de cada uno.
  //
  // La cola se guarda al escribir, en `metadata.cola`. Descifrar deja de ser
  // parte de listar, que es lo que pide la #80: «el valor no se devuelve nunca
  // en un listado».
  const { rows } = await query(
    `SELECT ac.id, ac.project_id, ac.service, ac.metadata, ac.active,
            ac.last_tested_at, ac.last_test_result, ac.created_at, ac.updated_at,
            p.nombre as project_nombre,
            quien.nombre AS puesta_por
     FROM api_credentials ac
     LEFT JOIN projects p ON p.id = ac.project_id
     LEFT JOIN users quien ON quien.id = (ac.metadata->>'updated_by')::int
     WHERE ${conditions.join(' AND ')}
     ORDER BY ac.service, ac.project_id`,
    params
  );

  return rows.map(r => ({
    id: r.id,
    project_id: r.project_id,
    project_nombre: r.project_nombre,
    service: r.service,
    // El entorno y el rastro viven en `metadata`: son campos nuevos de la #80 y
    // caben ahi sin tocar el esquema.
    entorno: r.metadata?.entorno || 'produccion',
    puesta_por: r.puesta_por || null,
    last_used_at: r.metadata?.last_used_at || null,
    metadata: r.metadata,
    active: r.active,
    last_tested_at: r.last_tested_at,
    last_test_result: r.last_test_result,
    // Los cuatro ultimos y nada mas. Guardados, no descifrados.
    cola: r.metadata?.cola || null,
    // `masked_value` se mantiene porque lo pintan dos pantallas de Configuracion
    // (`settings/ApisTab` y `projectSettings/ApisTab`). Quitarlo las habria
    // dejado enseñando «undefined» sin que fallara nada.
    //
    // Ahora se arma desde la cola en vez de descifrando: para las credenciales
    // guardadas antes de la #80 no hay cola, y entonces se dice que no se sabe
    // en vez de inventar una mascara.
    masked_value: r.metadata?.cola ? `••••••••${r.metadata.cola}` : '••••••••',
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

/**
 * El valor entero de UNA credencial. Llamada aparte y con nombre feo a
 * proposito: quien la escriba tiene que saber que esto saca un secreto.
 *
 * Quien la llama es responsable de anotarla en el registro. El modelo no lo
 * hace porque no conoce al usuario ni su IP.
 */
export async function revelar(id) {
  const { rows } = await query(
    `SELECT ac.id, ac.service, ac.project_id, ac.metadata,
            ac.encrypted_value, ac.iv, ac.auth_tag
       FROM api_credentials ac
      WHERE ac.id = $1 AND ac.active = true`,
    [id]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    service: r.service,
    project_id: r.project_id,
    entorno: r.metadata?.entorno || 'produccion',
    value: decrypt(r.encrypted_value, r.iv, r.auth_tag),
  };
}

/**
 * Que tiene un entorno que al otro le falta. Es lo que pide la #80 para que el
 * panel «sirva de verdad»:
 *
 *   «Que avise cuando un entorno no tiene una clave que si tiene otro. Ese es
 *    el caso de hoy: produccion con Brevo y pruebas sin ella.»
 *
 * Se compara por (proyecto, servicio): si existe en uno y no en el otro, sale.
 * Sin esto hay que mirar dos listas y acordarse, que es como se perdio la
 * mañana que motivo el ticket.
 */
export async function paridad() {
  const { rows } = await query(
    `WITH activas AS (
       SELECT ac.project_id, ac.service,
              COALESCE(ac.metadata->>'entorno', 'produccion') AS entorno
         FROM api_credentials ac
        WHERE ac.active = true
     ),
     pares AS (
       SELECT DISTINCT project_id, service FROM activas
     )
     SELECT p.project_id, p.service, pr.nombre AS project_nombre,
            bool_or(a.entorno = 'produccion') AS en_produccion,
            bool_or(a.entorno = 'pruebas')    AS en_pruebas
       FROM pares p
       LEFT JOIN activas a ON a.project_id IS NOT DISTINCT FROM p.project_id
                          AND a.service = p.service
       LEFT JOIN projects pr ON pr.id = p.project_id
      GROUP BY p.project_id, p.service, pr.nombre
     HAVING NOT (bool_or(a.entorno = 'produccion') AND bool_or(a.entorno = 'pruebas'))
      ORDER BY p.service, pr.nombre`
  );
  return rows.map(r => ({
    project_id: r.project_id,
    project_nombre: r.project_nombre,
    service: r.service,
    // Cual falta, dicho como se lee: «esta en produccion y falta en pruebas».
    falta_en: r.en_produccion ? 'pruebas' : 'produccion',
    esta_en: r.en_produccion ? 'produccion' : 'pruebas',
  }));
}

/**
 * Sella que esta credencial se ha usado.
 *
 * Es lo que delata la clave que lleva cinco meses guardada y que ya no usa
 * nadie. No se hace en cada lectura de forma sincrona: se dispara y se olvida,
 * porque un fallo aqui no puede impedir que una integracion funcione.
 */
export function marcarUso(service, projectId = null) {
  query(
    `UPDATE api_credentials
        SET metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('last_used_at', NOW()::text)
      WHERE service = $1
        AND (project_id = $2 OR ($2::int IS NULL AND project_id IS NULL))
        AND active = true`,
    [service, projectId]
  ).catch(() => { /* el sello no vale una excepcion */ });
}

export async function getDecryptedValue(service, projectId = null) {
  const { rows } = await query(
    `SELECT encrypted_value, iv, auth_tag FROM api_credentials
     WHERE service = $1 AND (project_id = $2 OR ($2::int IS NULL AND project_id IS NULL))
     AND active = true LIMIT 1`,
    [service, projectId]
  );
  if (!rows[0]) return null;
  // Se sella el uso al vuelo. Es la unica puerta por la que la aplicacion lee
  // una credencial de verdad, asi que es donde el «ultimo uso» significa algo.
  marcarUso(service, projectId);
  return decrypt(rows[0].encrypted_value, rows[0].iv, rows[0].auth_tag);
}

/**
 * ¿Esta el indice unico que separa produccion de pruebas?
 *
 * El `ON CONFLICT` de abajo nombra las MISMAS expresiones del indice de la
 * migracion (137 en MultiCRM, 105 en ISEIE). Si el indice no esta, Postgres no
 * contesta «no pasa nada»: contesta 42P10, «there is no unique or exclusion
 * constraint matching the ON CONFLICT specification», y guardar CUALQUIER
 * credencial deja de funcionar. Comprobado, no supuesto.
 *
 * Y eso importa porque las migraciones se preparan aqui pero se aplican en el
 * servidor: entre que este codigo sale y alguien corre la migracion hay una
 * ventana en la que la pantalla de Configuracion que ya existia —y que hoy
 * funciona— se caeria al guardar. Un puerto que rompe lo que habia no es un
 * puerto.
 *
 * Se pregunta una vez y se recuerda; `olvidarIndice()` existe para no tener que
 * reiniciar el proceso despues de aplicar la migracion.
 */
let hayIndicePorEntorno = null;

async function separaPorEntorno() {
  if (hayIndicePorEntorno !== null) return hayIndicePorEntorno;
  try {
    const { rows } = await query(
      `SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'uq_ac_proyecto_servicio_entorno'`
    );
    hayIndicePorEntorno = rows.length > 0;
    if (!hayIndicePorEntorno) {
      logger.warn('Credenciales: falta la migracion de claves por entorno; solo se puede guardar produccion');
    }
  } catch {
    // Si no se puede ni preguntar, se supone lo viejo: es lo que no rompe.
    hayIndicePorEntorno = false;
  }
  return hayIndicePorEntorno;
}

/** Para las pruebas, y para despues de aplicar la migracion sin reiniciar. */
export const olvidarIndice = () => { hayIndicePorEntorno = null; };

export async function upsert({ project_id, service, value, metadata, userId = null, entorno = null }) {
  const porEntorno = await separaPorEntorno();

  // Sin el indice solo cabe UNA fila por proyecto y servicio. Guardar ahi la de
  // pruebas pisaria la de produccion sin decir nada — perder una clave de
  // produccion en silencio es lo peor que puede hacer esta pantalla. Se dice
  // que no se puede todavia, y por que.
  if (!porEntorno && entorno && entorno !== 'produccion') {
    const err = new Error(
      'Todavia no se pueden guardar claves de pruebas: falta aplicar la migracion de claves por entorno. '
      + 'La de produccion si se puede.'
    );
    err.statusCode = 409;
    err.code = 'FALTA_MIGRACION_ENTORNO';
    throw err;
  }

  const { encrypted, iv, authTag } = encrypt(value);
  const pId = project_id || null;
  // El rastro va en `metadata` porque es jsonb y estaba sin usar: quien la puso,
  // en que entorno, y la cola para no tener que descifrar al listar.
  const meta = {
    ...(metadata || {}),
    ...(entorno ? { entorno } : {}),
    cola: String(value).slice(-4),
    updated_by: userId,
  };
  const { rows } = await query(
    // El conflicto se declara con las MISMAS expresiones del indice unico.
    // Postgres no lo deduce de otra forma con un indice de expresiones.
    //
    // Y si ese indice todavia no esta, se usa el par de siempre. No es un
    // apano: es el unico que existe hasta que se aplique la migracion, y con el
    // arriba impidiendo guardar «pruebas» no se puede pisar nada.
    `INSERT INTO api_credentials (project_id, service, encrypted_value, iv, auth_tag, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ${porEntorno
       ? `(COALESCE(project_id, -1), service, COALESCE(metadata->>'entorno', 'produccion'))`
       : `(project_id, service)`}
     DO UPDATE
       SET encrypted_value = EXCLUDED.encrypted_value,
           iv = EXCLUDED.iv,
           auth_tag = EXCLUDED.auth_tag,
           -- Se FUSIONA en vez de reemplazar: si no, cambiar una clave borraba
           -- quien la puso la primera vez y el ultimo uso.
           metadata = COALESCE(api_credentials.metadata, '{}'::jsonb) || EXCLUDED.metadata,
           active = true,
           updated_at = NOW()
     RETURNING id, project_id, service, metadata, active, created_at, updated_at`,
    [pId, service, encrypted, iv, authTag, JSON.stringify(meta)]
  );
  const r = rows[0];
  return { ...r, masked_value: maskSecret(value) };
}

export async function remove(id) {
  await query(`UPDATE api_credentials SET active = false WHERE id = $1`, [id]);
}

export async function recordTestResult(id, result) {
  await query(
    `UPDATE api_credentials SET last_tested_at = NOW(), last_test_result = $1 WHERE id = $2`,
    [result, id]
  );
}
