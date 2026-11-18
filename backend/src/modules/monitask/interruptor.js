/**
 * El interruptor de Monitask (#236). APAGADO DE SERIE en todas partes, también en
 * local y en /testeo: hasta que alguien pone `MONITASK_ACTIVO=1` en el .env, todas
 * las rutas de /api/monitask contestan 404 (también la vuelta del OAuth), la
 * sincronización nocturna no arranca y la tarjeta de Integraciones no sale.
 *
 * Es función y no constante para que las pruebas pasen el entorno que quieran.
 */
export function monitaskActivo(env = process.env) {
  return env.MONITASK_ACTIVO === '1' || env.MONITASK_ACTIVO === 'true';
}
