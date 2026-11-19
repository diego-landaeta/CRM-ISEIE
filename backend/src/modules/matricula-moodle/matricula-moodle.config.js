/*
  Matrícula automática en Moodle (#767) · el interruptor.

  APAGADO DE SERIE. Sin MATRICULA_MOODLE_ACTIVA=1 nada de este módulo hace
  nada: un cobro no programa ninguna matrícula, borrar una venta no toca
  ninguna tabla nueva y el trabajo de cada hora no arranca. Por eso se puede
  desplegar el código antes que la migración 311 (289 en el 360); encenderlo, NO.

    MATRICULA_MOODLE_ACTIVA     1/true para encenderlo.
    MATRICULA_MOODLE_CAMPUS     ids o slugs de los campus en los que va,
                                separados por comas («3,iseih»). Vacío = en
                                todos. Así se puede probar en uno solo.
    MATRICULA_MOODLE_INTENTOS   vueltas con fallo antes de darla por fallida
                                y avisar a administración (5).
    MATRICULA_MOODLE_HORA       hora de Madrid a la que se programa el día
                                anterior al inicio (8 → 08:00).

  Se leen en cada llamada, no al cargar el módulo: las pruebas los cambian y
  un `pm2 restart --update-env` no tiene que adivinar nada.

  FASE 1: el trabajo NO llama a Moodle. Comprueba que la matrícula se puede
  hacer (alumno con correo, curso de Moodle en el producto), la deja «lista» y
  avisa por la campana para que administración la haga a mano. Crear el
  usuario y matricular con el plugin `local_crm` es la fase 2
  (`matricula-moodle.service.js`, `hacerEnMoodle`).
*/

const si = (v) => ['1', 'true', 'si', 'sí', 'yes'].includes(String(v || '').trim().toLowerCase());

export const activa = () => si(process.env.MATRICULA_MOODLE_ACTIVA);

/** La lista de campus del interruptor, en minúsculas. Vacía = todos. */
export function campusDeLaLista() {
  return String(process.env.MATRICULA_MOODLE_CAMPUS || '')
    .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

const entero = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

export const intentosMaximos = () => entero(process.env.MATRICULA_MOODLE_INTENTOS, 5, 1, 50);
export const horaDelDiaAnterior = () => entero(process.env.MATRICULA_MOODLE_HORA, 8, 0, 23);

/** Zona de la oficina, como en Ventas (#693). Validada: va dentro del SQL. */
export const ZONA = /^[A-Za-z_+\-/]+$/.test(process.env.APP_TIMEZONE || '')
  ? process.env.APP_TIMEZONE : 'Europe/Madrid';
