/**
 * Marcas de un diploma de Certifex que usan varias partes del módulo. Aquí y no en
 * certifex.diplomas.js para que certifex.revertir.js (#351) no tenga que importar de
 * diplomas, que a su vez importa de revertir: sin ciclos.
 */

/**
 * ¿Lo emitió un CRM? Certifex guarda en `emitidaPor` «persona (CRM …)» cuando la emisión es
 * del CRM. Lo emitido fuera (desde el panel de Certifex, o los antiguos de 2023 y 2024)
 * no esta «pendiente de aviso»: nadie del CRM lo aprobo ni tiene que mandarlo.
 *
 * Es lo que decide «Enviar al alumno», el filtro «Pendiente de aviso», el contador «Por
 * enviar» y a quién se manda. La misma expresión que `emitidaDesdeUnCrm` de Certifex
 * (src/api/revertir.ts).
 */
export const emitidoPorElCrm = (d) => /\(CRM\b[^()]*\)\s*$/i.test(String(d?.emitidaPor ?? ''));

/**
 * ¿Lo puede revertir ESTE CRM? (#351) Certifex solo deja revertir al CRM que lo emitió (con dos
 * CRM en un campus, cada uno lo suyo) y lo dice en cada diploma (`deEsteCrm`). Solo decide
 * «Revertir» (el botón y la comprobación de antes de llamar a Certifex): «Enviar» sigue con
 * `emitidoPorElCrm` (14.ª auditoría). Un Certifex anterior no manda `deEsteCrm`: entonces, lo
 * emitido por un CRM.
 */
export const revertiblePorEsteCrm = (d) => (typeof d?.deEsteCrm === 'boolean' ? d.deEsteCrm : emitidoPorElCrm(d));
