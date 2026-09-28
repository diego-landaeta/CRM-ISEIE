/**
 * Lo del proceso de ventas que todavia NO esta aprobado para produccion.
 *
 * Diego, 28/09/2026: «sobre el proceso de ventas algunas cosas se fueron ya a
 * produccion; hasta que no tengamos esa lista completa no va».
 *
 * En ISEIE produccion y pruebas se construyen desde la MISMA rama, asi que lo
 * que se hace para /staging acaba en produccion en el siguiente despliegue. El
 * 25/09 paso exactamente eso: un despliegue para poner un boton de informes
 * arrastro el repaso de fin de mes, el descarte, las plantillas propias y el
 * podio, sin que nadie los hubiera aprobado.
 *
 * Esta bandera los separa. `.env.staging` la enciende; `.env.production` no la
 * define, asi que en produccion vale `false` y no se pintan. Para aprobar algo
 * no hay que tocar codigo: se anade `VITE_PROCESO_EN_PRUEBAS=true` al
 * `.env.production` y se vuelve a construir.
 *
 * El codigo sigue ahi y sigue probandose en /staging. No se borra nada.
 */
export const PROCESO_EN_PRUEBAS = import.meta.env.VITE_PROCESO_EN_PRUEBAS === 'true';
