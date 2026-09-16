/*
  De qué va un informe: un campus, una sociedad entera, o todo.

  Los informes se piden desde ocho sitios distintos, y cada uno se montaba sus
  parámetros a mano con un `if (activeProject?.id) p.set('projectId', …)`. Con
  la sociedad de por medio (#120) eso son ocho sitios donde olvidarse de
  `issuerId`, y el fallo no se ve: el informe sale, con las cifras de otro
  ámbito.

  Aquí se decide una vez.

  LA REGLA
  --------
    una sociedad  →  issuerId=3      (sus campus sumados)
    un campus     →  projectId=7
    todos         →  no se manda nada

  «Todos los proyectos» es el id -1, que es un valor interno del CRM y no
  significa nada para el servidor: mandarlo pediría el proyecto número menos
  uno. Por eso se omite.
*/

export const TODOS_LOS_PROYECTOS = -1;

/**
 * Pone en `params` lo que corresponda. Devuelve los mismos `params` para poder
 * encadenar.
 *
 * @param {URLSearchParams} params
 * @param {{ activeIssuerId?: number|null, activeProject?: { id?: number|null }|null }} ambito
 */
export function ponerAmbito(params, { activeIssuerId = null, activeProject = null } = {}) {
  if (activeIssuerId) {
    params.set('issuerId', String(activeIssuerId));
    return params;
  }
  const id = activeProject?.id;
  if (id && id !== TODOS_LOS_PROYECTOS) params.set('projectId', String(id));
  return params;
}

/**
 * Lo mismo, para quien arma un objeto en vez de una cadena de consulta.
 * Devuelve `{}`, `{ projectId }` o `{ issuerId }`.
 */
export function ambitoComoObjeto({ activeIssuerId = null, activeProject = null } = {}) {
  if (activeIssuerId) return { issuerId: activeIssuerId };
  const id = activeProject?.id;
  return id && id !== TODOS_LOS_PROYECTOS ? { projectId: id } : {};
}

/**
 * Si la sociedad elegida no tiene ni un campus, el informe sale vacío a
 * propósito. Quien pinta la pantalla necesita saberlo para decirlo en vez de
 * enseñar una tabla vacía, que parece una avería.
 */
export function sociedadSinCampus(activeIssuer) {
  return !!activeIssuer && (activeIssuer.campus?.length ?? 0) === 0;
}
