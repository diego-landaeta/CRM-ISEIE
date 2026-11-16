/**
 * Marcas de un diploma de Certifex que usan varias partes del módulo. Aquí y no en
 * certifex.diplomas.js para que certifex.revertir.js (#351) no tenga que importar de
 * diplomas, que a su vez importa de revertir: sin ciclos.
 */

/**
 * ¿Lo emitió ESTE CRM? Desde la 13.ª auditoría de la #351, Certifex lo dice en cada diploma
 * (`deEsteCrm`), con la misma regla con la que deja revertir (solo el CRM que lo emitió; con dos CRM
 * en un campus, cada uno lo suyo). Un Certifex anterior no lo manda: entonces, la regla de antes,
 * «emitida por un CRM» («persona (CRM …)» en `emitidaPor`), la misma expresión que su
 * `emitidaDesdeUnCrm`. Lo emitido fuera (desde el panel de Certifex, o los antiguos de 2023 y 2024)
 * no esta «pendiente de aviso»: nadie del CRM lo aprobo ni tiene que mandarlo.
 */
export const emitidoPorElCrm = (d) => (typeof d?.deEsteCrm === 'boolean'
  ? d.deEsteCrm
  : /\(CRM\b[^()]*\)\s*$/i.test(String(d?.emitidaPor ?? '')));
