/**
 * Los filtros rápidos que filtra el SERVIDOR (`?qf=` en `/api/leads`).
 *
 * Son las dos alertas del Dashboard (gemela de CRM#884): «Sin gestora» y «Sin
 * actividad». La cifra del Dashboard cuenta todo el campus, así que la lista a
 * la que lleva no puede filtrarse sobre la página cargada (20 de `total`): la
 * filtra el servidor con la MISMA condición que la cifra (`FILTROS_RAPIDOS` en
 * `lead.model.js`). Los demás filtros rápidos de ISEIE siguen en la página.
 */
export const FILTROS_RAPIDOS_DEL_SERVIDOR: readonly string[] = ['sin-gestora', 'sin-actividad'];

/** El `qf` que hay que mandar al servidor, o '' si ese filtro va en la página. */
export function qfDelServidor(qf: string | null | undefined): string {
  return qf && FILTROS_RAPIDOS_DEL_SERVIDOR.includes(qf) ? qf : '';
}
