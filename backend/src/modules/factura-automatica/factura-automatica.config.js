/*
  Factura automática con formulario de datos fiscales (#452) · el interruptor.

  APAGADO DE SERIE. Sin FACTURA_AUTOMATICA_ACTIVA=1 nada de este módulo hace
  nada: no se crea ninguna fila, no sale ningún correo y el cobro sigue el
  camino de hoy (en el 360, a la cola; en ISEIE, lo que ya hacía).

    FACTURA_AUTOMATICA_ACTIVA     1/true para encenderlo.
    FACTURA_AUTOMATICA_CAMPUS     ids o slugs de los campus en los que va,
                                  separados por comas («3,iseih»). Vacío = en
                                  todos. Así se puede probar en uno solo.
    FACTURA_AUTOMATICA_DIAS       días que tiene el alumno para contestar (7).
    FACTURA_AUTOMATICA_INTENTOS   envíos con errores que admite el enlace (5).
    FACTURA_AUTOMATICA_ENVIAR_PDF 0 para que la factura se emita pero NO se le
                                  mande en PDF al alumno (por defecto sí).

  Se leen en cada llamada, no al cargar el módulo: las pruebas los cambian y
  un `pm2 restart --update-env` no tiene que adivinar nada.
*/

const si = (v) => ['1', 'true', 'si', 'sí', 'yes'].includes(String(v || '').trim().toLowerCase());

export const activa = () => si(process.env.FACTURA_AUTOMATICA_ACTIVA);

function campusDeLaLista() {
  return String(process.env.FACTURA_AUTOMATICA_CAMPUS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/**
 * ¿Va la factura automática en este campus? `proyecto` es `{ id, slug }` (o
 * solo el id). Con el interruptor apagado, nunca.
 */
export function activaEn(proyecto) {
  if (!activa()) return false;
  const lista = campusDeLaLista();
  if (!lista.length) return true;
  const id = typeof proyecto === 'object' ? proyecto?.id : proyecto;
  const slug = typeof proyecto === 'object' ? String(proyecto?.slug || '').toLowerCase() : '';
  return lista.includes(String(id)) || (slug && lista.includes(slug));
}

const entero = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

export const diasDePlazo = () => entero(process.env.FACTURA_AUTOMATICA_DIAS, 7, 1, 60);
export const intentosMaximos = () => entero(process.env.FACTURA_AUTOMATICA_INTENTOS, 5, 1, 50);
export const enviarPdf = () => String(process.env.FACTURA_AUTOMATICA_ENVIAR_PDF ?? '1').trim() !== '0';
