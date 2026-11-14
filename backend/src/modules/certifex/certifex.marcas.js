/**
 * Marcas de un diploma de Certifex que usan varias partes del módulo. Aquí y no en
 * certifex.diplomas.js para que certifex.revertir.js (#351) no tenga que importar de
 * diplomas, que a su vez importa de revertir: sin ciclos.
 */

/**
 * ¿Lo emitió un CRM? Certifex guarda en `emitidaPor` «persona (CRM …)» cuando la emisión es
 * del CRM. Lo emitido fuera (desde el panel de Certifex, o los antiguos de 2023 y 2024)
 * no esta «pendiente de aviso»: nadie del CRM lo aprobo ni tiene que mandarlo.
 */
export const emitidoPorElCrm = (d) => /\(CRM\b[^)]*\)\s*$/i.test(String(d?.emitidaPor ?? ''));
