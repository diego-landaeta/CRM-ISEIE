import {
  ETIQUETA_POR_DEFINIR, COLOR_POR_DEFINIR, MARCA_GITHUB, RAMA_REVISION,
  issuesDeLaPr, esCopiaDeOtra, copiaDeLaCabecera, tituloDeLaTarea, descripcionDeLaTarea,
  asignadosDe, urlDeLaIssue,
} from './tasks.github.js';

/*
  Lo que escribe en el tablero lo que pasa en GitHub (CRM-ISEIE#435). Cada función
  recibe la conexión (`db`) y NO abre transacción: la abre quien llama (el
  webhook, una por aviso; la importación, una para todo, que en simulación se
  deshace). Así lo que se cuenta al simular es exactamente lo que se escribiría.

  Las reglas (Diego, 11/11/2026):
    · issue abierta → «Por hacer»;
    · PR enlazada (Closes/Refs #N o la rama) abierta o fusionada en `staging`
      → «En revisión»;
    · issue cerrada (al fusionar en `main`) → «Hecha», con `completed_at` =
      `closed_at`; la pone el sistema (evento con `action: 'github'`) aunque la
      tarea tenga supervisor: en el historial, «La cerró: GitHub»;
    · issue reabierta → «En curso».
  Se mueve cuando CAMBIA algo en GitHub, no en cada aviso: si alguien mueve la
  tarjeta en el CRM, un aviso que no cambia el estado de la issue no la devuelve.

  Responsable: el primer asignado de GitHub con usuario en el CRM
  (`github_usuarios`). Sin ninguno, la tarea es del supervisor (Diego) y lleva
  la etiqueta «Por definir quién lo hará». Supervisor y quien la crea: el de la
  configuración. Equipo: el de la configuración.

  Sin correos ni avisos: los de las tareas los manda el servicio, y aquí se
  escribe directamente en la base (una importación de cientos de issues no
  puede mandar cientos de correos).
*/

/* --- Configuración --- */

export async function leerConfig(db) {
  const { rows } = await db.query(
    `SELECT c.repo, c.team_id, c.supervisor_id, c.copia_repo, c.updated_at,
            t.name AS team_name, u.nombre AS supervisor_name
       FROM github_tablero_config c
       LEFT JOIN task_teams t ON t.id = c.team_id
       LEFT JOIN users u ON u.id = c.supervisor_id
      WHERE c.id = 1`);
  return rows[0] || null;
}

/** Lo que falta para poder escribir en el tablero (vacío = lista). */
export function faltaEnConfig(cfg) {
  const falta = [];
  if (!cfg) return ['la configuración (migración 278)'];
  if (!cfg.repo) falta.push('el repositorio');
  if (!cfg.supervisor_id) falta.push('quién supervisa');
  return falta;
}

/* --- Piezas --- */

const bloquear = (db, repo, number) =>
  db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`github:${String(repo).toLowerCase()}#${number}`]);

async function evento(db, taskId, eventType, details, cuando = null) {
  await db.query(
    `INSERT INTO task_events (task_id, user_id, event_type, details, created_at)
     VALUES ($1, NULL, $2, $3, COALESCE($4::timestamptz, NOW()))`,
    [taskId, eventType, JSON.stringify({ ...details, action: MARCA_GITHUB }), cuando]
  );
}

/** Al final de la columna de esa persona, como cuando se crea o se mueve una tarjeta. */
const SQL_FINAL_DE_COLUMNA = `(SELECT COALESCE(MAX(t2.position), 0) + 1000 FROM tasks t2
   WHERE t2.status = $STATUS AND t2.archived_at IS NULL AND t2.assigned_to IS NOT DISTINCT FROM $QUIEN)`;
const finalDeColumna = (status, quien) => SQL_FINAL_DE_COLUMNA.replace('$STATUS', status).replace('$QUIEN', quien);

/**
 * El responsable según los asignados de GitHub: el primero con usuario activo en el CRM.
 * Sin ninguno, el supervisor, «por definir».
 */
export async function resolverResponsable(db, cfg, logins) {
  if (logins.length) {
    const { rows } = await db.query(
      `SELECT gu.login, gu.user_id FROM github_usuarios gu
         JOIN users u ON u.id = gu.user_id AND u.active
        WHERE gu.login = ANY($1::text[])`,
      [logins]
    );
    const porLogin = new Map(rows.map((r) => [r.login, Number(r.user_id)]));
    for (const l of logins) if (porLogin.has(l)) return { userId: porLogin.get(l), porDefinir: false };
  }
  return { userId: Number(cfg.supervisor_id), porDefinir: true };
}

async function ponerEtiquetaPorDefinir(db, taskId, poner) {
  if (poner) {
    await db.query(
      `INSERT INTO task_tags (task_id, name, color) VALUES ($1, $2, $3)
       ON CONFLICT (task_id, LOWER(name)) DO NOTHING`,
      [taskId, ETIQUETA_POR_DEFINIR, COLOR_POR_DEFINIR]
    );
  } else {
    await db.query('DELETE FROM task_tags WHERE task_id = $1 AND LOWER(name) = LOWER($2)', [taskId, ETIQUETA_POR_DEFINIR]);
  }
}

/** Los dos enlaces de la tarjeta: la issue y, si se sabe, la de la copia de la empresa. Sin repetir. */
async function ponerEnlaces(db, taskId, { repo, number, copiaRepo, copiaNumber }) {
  const enlaces = [{ url: urlDeLaIssue(repo, number), title: `Issue #${number} en GitHub` }];
  if (copiaRepo && copiaNumber) {
    enlaces.push({ url: urlDeLaIssue(copiaRepo, copiaNumber), title: `La misma en la copia de la empresa (#${copiaNumber})` });
  }
  for (const e of enlaces) {
    await db.query(
      `INSERT INTO task_links (task_id, url, title, created_by)
       SELECT $1::int, $2::varchar, $3::varchar, NULL
        WHERE NOT EXISTS (SELECT 1 FROM task_links WHERE task_id = $1::int AND url = $2::varchar)`,
      [taskId, e.url, e.title]
    );
  }
}

async function moverA(db, task, nuevo, { completedAt = null, cuando = null, detalles = {} } = {}) {
  await db.query(
    `UPDATE tasks
        SET status = $2::varchar, completed_at = $3,
            position = ${finalDeColumna('$2::varchar', '$4::int')},
            updated_at = NOW()
      WHERE id = $1`,
    [task.id, nuevo, completedAt, task.assigned_to]
  );
  await evento(db, task.id, 'status_changed', { old_status: task.status, new_status: nuevo, ...detalles }, cuando);
}

/* --- Una issue --- */

/**
 * Lleva una issue al tablero: la crea si no está, o la pone al día.
 *
 * @param {object} issue  la issue tal como la da GitHub (webhook o API)
 * @param {object} op
 *   · accion: la del aviso (`opened`, `edited`, `closed`…) o 'importar'
 *   · enRevision: (al crearla) tiene una PR enlazada abierta o fusionada en staging
 *   · copia: { repo, number } de la copia de la empresa, si se sabe por fuera (importación)
 * @returns {{ resultado: string, task_id?: number }}
 */
export async function sincronizarIssue(db, cfg, issue, { accion = 'importar', enRevision = false, copia = null } = {}) {
  if (issue.pull_request) return { resultado: 'omitida: es una PR' };
  if (esCopiaDeOtra(issue.body)) return { resultado: 'omitida: copia de otra tarea' };
  const repo = cfg.repo;
  const number = Number(issue.number);
  await bloquear(db, repo, number);

  const logins = asignadosDe(issue);
  const cerrada = issue.state === 'closed';
  const deLaCabecera = copiaDeLaCabecera(issue.body);
  const copiaRepo = copia?.repo || deLaCabecera?.repo || null;
  const copiaNumber = copia?.number || deLaCabecera?.number || null;

  const { rows: [vinculo] } = await db.query(
    'SELECT * FROM github_issue_tareas WHERE lower(repo) = lower($1) AND number = $2 FOR UPDATE',
    [repo, number]
  );

  if (!vinculo) {
    const { userId, porDefinir } = await resolverResponsable(db, cfg, logins);
    const status = cerrada ? 'hecha' : (enRevision ? 'en_revision' : 'por_hacer');
    const creada = issue.created_at || null;
    const { rows: [t] } = await db.query(
      `INSERT INTO tasks (title, description, status, position, priority, assigned_to, created_by,
                          completed_at, supervisor_id, team_id, created_at, updated_at)
       VALUES ($1, $2, $3::varchar, ${finalDeColumna('$3::varchar', '$4::int')}, 'media', $4::int, $5::int,
               $6::timestamptz, $5::int, $7::int, COALESCE($8::timestamptz, NOW()), NOW())
       RETURNING id`,
      [tituloDeLaTarea(issue), descripcionDeLaTarea(issue), status, userId, cfg.supervisor_id,
        cerrada ? (issue.closed_at || new Date().toISOString()) : null, cfg.team_id || null, creada]
    );
    await evento(db, t.id, 'created', { issue: `${repo}#${number}` }, creada);
    if (status !== 'por_hacer') {
      await evento(db, t.id, 'status_changed', {
        old_status: 'por_hacer', new_status: status, issue: `${repo}#${number}`,
        ...(cerrada ? { motivo: 'La issue está cerrada en GitHub' } : { motivo: 'Tiene una PR a staging' }),
      }, cerrada ? issue.closed_at : null);
    }
    // La etiqueta, solo mientras está abierta: en lo hecho no hay nada por definir.
    await ponerEtiquetaPorDefinir(db, t.id, porDefinir && !cerrada);
    await ponerEnlaces(db, t.id, { repo, number, copiaRepo, copiaNumber });
    await db.query(
      `INSERT INTO github_issue_tareas (repo, number, node_id, task_id, estado, asignados, por_definir,
                                        copia_repo, copia_number, github_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)`,
      [repo, number, issue.node_id || null, t.id, cerrada ? 'closed' : 'open', logins, porDefinir,
        copiaRepo, copiaNumber, issue.updated_at || null]
    );
    return { resultado: cerrada ? 'creada hecha' : (enRevision ? 'creada en revisión' : 'creada'), task_id: t.id };
  }

  const { rows: [task] } = await db.query(
    'SELECT id, status, assigned_to, title, description, archived_at FROM tasks WHERE id = $1 FOR UPDATE',
    [vinculo.task_id]
  );
  const cambios = [];

  // Archivada en el CRM: se deja como está (solo se pone al día el vínculo).
  if (task && !task.archived_at) {
    // El texto, cuando GitHub lo cambia (o al importar).
    if (['edited', 'importar', 'opened'].includes(accion)) {
      const titulo = tituloDeLaTarea(issue);
      const desc = descripcionDeLaTarea(issue);
      const campos = [];
      if (titulo !== task.title) campos.push('title');
      if ((desc ?? null) !== (task.description ?? null)) campos.push('description');
      if (campos.length) {
        await db.query('UPDATE tasks SET title = $2, description = $3, updated_at = NOW() WHERE id = $1', [task.id, titulo, desc]);
        await evento(db, task.id, 'updated', { campos });
        cambios.push('texto');
      }
    }

    // El responsable, cuando cambian los asignados de GitHub.
    const antes = [...(vinculo.asignados || [])].sort().join(',');
    if (antes !== [...logins].sort().join(',')) {
      const { userId, porDefinir } = await resolverResponsable(db, cfg, logins);
      if (userId !== Number(task.assigned_to)) {
        await db.query(
          `UPDATE tasks SET assigned_to = $2, position = ${finalDeColumna('tasks.status', '$2::int')}, updated_at = NOW() WHERE id = $1`,
          [task.id, userId]
        );
        await evento(db, task.id, 'assigned', { old_assigned_to: task.assigned_to, new_assigned_to: userId, asignados_github: logins });
        task.assigned_to = userId;
        cambios.push('responsable');
      }
      vinculo.por_definir = porDefinir;
    }

    // El estado, cuando cambia el de la issue.
    const estadoAntes = vinculo.estado;
    if (cerrada && (estadoAntes !== 'closed' || accion === 'closed') && task.status !== 'hecha') {
      await moverA(db, task, 'hecha', {
        completedAt: issue.closed_at || new Date().toISOString(), cuando: issue.closed_at || null,
        detalles: { issue: `${repo}#${number}`, motivo: 'GitHub cerró la issue' },
      });
      cambios.push('hecha');
    } else if (!cerrada && (estadoAntes === 'closed' || accion === 'reopened') && task.status === 'hecha') {
      await moverA(db, task, 'en_curso', { detalles: { issue: `${repo}#${number}`, motivo: 'Reabierta en GitHub' } });
      cambios.push('en curso');
    }
    await ponerEtiquetaPorDefinir(db, task.id, vinculo.por_definir && !cerrada);
  }

  await ponerEnlaces(db, vinculo.task_id, {
    repo, number, copiaRepo: copiaRepo || vinculo.copia_repo, copiaNumber: copiaNumber || vinculo.copia_number,
  });
  await db.query(
    `UPDATE github_issue_tareas
        SET estado = $2, asignados = $3::text[], por_definir = $4, node_id = COALESCE($5, node_id),
            copia_repo = COALESCE($6, copia_repo), copia_number = COALESCE($7, copia_number),
            github_updated_at = COALESCE($8, github_updated_at), ultima_sincronizacion = NOW()
      WHERE id = $1`,
    [vinculo.id, cerrada ? 'closed' : 'open', logins, vinculo.por_definir, issue.node_id || null,
      copiaRepo, copiaNumber, issue.updated_at || null]
  );
  return { resultado: cambios.length ? `al día: ${cambios.join(', ')}` : 'sin cambios', task_id: vinculo.task_id };
}

/** Borrada en GitHub: la tarea se archiva (no se borra) y el vínculo queda como «borrada». */
export async function issueBorrada(db, cfg, issue) {
  await bloquear(db, cfg.repo, issue.number);
  const { rows: [v] } = await db.query(
    `UPDATE github_issue_tareas SET estado = 'borrada', ultima_sincronizacion = NOW()
      WHERE lower(repo) = lower($1) AND number = $2 RETURNING task_id`,
    [cfg.repo, Number(issue.number)]
  );
  if (!v) return { resultado: 'sin tarea' };
  const { rowCount } = await db.query(
    'UPDATE tasks SET archived_at = NOW(), updated_at = NOW() WHERE id = $1 AND archived_at IS NULL', [v.task_id]);
  if (rowCount) await evento(db, v.task_id, 'archived', { motivo: 'Borrada en GitHub' });
  return { resultado: 'archivada', task_id: v.task_id };
}

/* --- Una PR --- */

/** ¿Esta PR lleva sus issues a «En revisión»? Abierta (y no borrador) o fusionada, contra staging. */
export function prEnRevision(pr) {
  if (String(pr?.base?.ref || '') !== RAMA_REVISION) return false;
  if (pr.merged === true || pr.merged_at) return true;
  return pr.state === 'open' && !pr.draft;
}

/**
 * Una PR: sus issues enlazadas que sigan abiertas, a «En revisión» (si no están
 * ya o hechas). Apunta la PR en el vínculo.
 */
export async function sincronizarPr(db, cfg, pr) {
  const numeros = issuesDeLaPr({ body: pr.body, rama: pr.head?.ref, repo: cfg.repo });
  if (!numeros.length) return { resultado: 'sin issues enlazadas' };
  const mueve = prEnRevision(pr);
  const movidas = [];
  for (const n of numeros) {
    await bloquear(db, cfg.repo, n);
    const { rows: [v] } = await db.query(
      `UPDATE github_issue_tareas
          SET prs = CASE WHEN $3 = ANY(prs) THEN prs ELSE array_append(prs, $3) END, ultima_sincronizacion = NOW()
        WHERE lower(repo) = lower($1) AND number = $2
        RETURNING task_id, estado`,
      [cfg.repo, n, Number(pr.number)]
    );
    if (!v || !mueve || v.estado !== 'open') continue;
    const { rows: [task] } = await db.query(
      'SELECT id, status, assigned_to FROM tasks WHERE id = $1 AND archived_at IS NULL FOR UPDATE', [v.task_id]);
    if (!task || ['en_revision', 'hecha'].includes(task.status)) continue;
    await moverA(db, task, 'en_revision', {
      detalles: { issue: `${cfg.repo}#${n}`, pr: Number(pr.number), motivo: pr.merged ? 'PR fusionada en staging' : 'PR abierta a staging' },
    });
    movidas.push(n);
  }
  return { resultado: movidas.length ? `en revisión: #${movidas.join(', #')}` : 'sin cambios', issues: numeros };
}

/* --- Comentarios --- */

/** Solo se cuentan: el texto no se trae (puede llevar datos de quien escribe). */
export async function contarComentario(db, cfg, issue, accion) {
  if (issue.pull_request) return { resultado: 'omitido: es de una PR' };
  const delta = accion === 'created' ? 1 : accion === 'deleted' ? -1 : 0;
  if (!delta) return { resultado: 'sin cambios' };
  const { rowCount } = await db.query(
    `UPDATE github_issue_tareas SET comentarios = GREATEST(0, comentarios + $3), ultima_sincronizacion = NOW()
      WHERE lower(repo) = lower($1) AND number = $2`,
    [cfg.repo, Number(issue.number), delta]
  );
  return { resultado: rowCount ? 'contado' : 'sin tarea' };
}

/* --- La correspondencia cambió --- */

/**
 * Al poner o quitar un login en la correspondencia, las tareas vivas de las
 * issues asignadas a ese login vuelven a calcular su responsable: las que
 * estaban «Por definir» pasan a esa persona; al quitarlo, vuelven al supervisor.
 */
export async function recalcularResponsables(db, cfg, login) {
  const { rows } = await db.query(
    `SELECT v.id, v.task_id, v.asignados, v.estado, t.status, t.assigned_to
       FROM github_issue_tareas v JOIN tasks t ON t.id = v.task_id
      WHERE $1 = ANY(v.asignados) AND t.archived_at IS NULL
      ORDER BY v.number
      FOR UPDATE OF t`,
    [String(login).toLowerCase()]
  );
  let cambiadas = 0;
  for (const r of rows) {
    const { userId, porDefinir } = await resolverResponsable(db, cfg, r.asignados);
    if (userId !== Number(r.assigned_to)) {
      await db.query(
        `UPDATE tasks SET assigned_to = $2, position = ${finalDeColumna('tasks.status', '$2::int')}, updated_at = NOW() WHERE id = $1`,
        [r.task_id, userId]
      );
      await evento(db, r.task_id, 'assigned', { old_assigned_to: r.assigned_to, new_assigned_to: userId, asignados_github: r.asignados });
      cambiadas += 1;
    }
    await ponerEtiquetaPorDefinir(db, r.task_id, porDefinir && r.estado === 'open');
    await db.query('UPDATE github_issue_tareas SET por_definir = $2 WHERE id = $1', [r.id, porDefinir]);
  }
  return cambiadas;
}

/* --- La importación --- */

/**
 * Todas las issues de una vez (el guion `scripts/github-tablero-importar.mjs`).
 * Idempotente: la segunda vez no crea nada y solo pone al día lo que cambió.
 * En una transacción: `aplicar: false` lo cuenta todo y lo deshace.
 *
 * @param {import('pg').PoolClient} db  conexión propia
 * @param {{ issues: object[], prs?: object[], copias?: Map<number, number>|null, copiaRepo?: string|null, aplicar?: boolean }} datos
 */
export async function importar(db, { issues, prs = [], copias = null, copiaRepo = null, aplicar = false }) {
  await db.query('BEGIN');
  try {
    const cfg = await leerConfig(db);
    const falta = faltaEnConfig(cfg);
    if (falta.length) throw new Error(`Falta en la configuración del tablero ↔ GitHub: ${falta.join(', ')}`);
    const repoCopia = copiaRepo || cfg.copia_repo || null;

    // Qué issues tienen una PR que las lleva a «En revisión».
    const enRevision = new Set();
    for (const pr of prs) {
      if (!prEnRevision(pr)) continue;
      for (const n of issuesDeLaPr({ body: pr.body, rama: pr.head?.ref, repo: cfg.repo })) enRevision.add(n);
    }

    const cuenta = {
      issues: 0, creadas: 0, abiertas: 0, en_revision: 0, cerradas: 0, actualizadas: 0, sin_cambios: 0,
      omitidas_copia: 0, por_definir: 0, con_copia: 0,
    };
    for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
      if (issue.pull_request) continue;
      cuenta.issues += 1;
      const nCopia = copias?.get(Number(issue.number));
      const r = await sincronizarIssue(db, cfg, issue, {
        accion: 'importar',
        enRevision: issue.state === 'open' && enRevision.has(Number(issue.number)),
        copia: nCopia && repoCopia ? { repo: repoCopia, number: nCopia } : null,
      });
      if (r.resultado.startsWith('omitida')) { cuenta.omitidas_copia += 1; continue; }
      if (r.resultado.startsWith('creada')) {
        cuenta.creadas += 1;
        if (r.resultado === 'creada hecha') cuenta.cerradas += 1;
        else if (r.resultado === 'creada en revisión') cuenta.en_revision += 1;
        else cuenta.abiertas += 1;
      } else if (r.resultado === 'sin cambios') cuenta.sin_cambios += 1;
      else cuenta.actualizadas += 1;
    }
    // Las PR, después: apuntan su número en el vínculo (y mueven lo que ya estaba).
    for (const pr of prs) await sincronizarPr(db, cfg, pr);

    const { rows: [tot] } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE por_definir AND estado = 'open')::int AS por_definir,
              COUNT(*) FILTER (WHERE copia_number IS NOT NULL)::int AS con_copia
         FROM github_issue_tareas WHERE lower(repo) = lower($1)`,
      [cfg.repo]
    );
    cuenta.por_definir = tot.por_definir;
    cuenta.con_copia = tot.con_copia;

    await db.query(aplicar ? 'COMMIT' : 'ROLLBACK');
    return { aplicado: aplicar, repo: cfg.repo, ...cuenta };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}
