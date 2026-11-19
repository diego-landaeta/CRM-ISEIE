/*
  Confirmación de datos del diploma (#768) · el interruptor.

  APAGADO DE SERIE. Sin DIPLOMA_CONFIRMACION_ACTIVA=1 nada de este módulo hace
  nada: no se crea ninguna fila, no sale ningún correo, los enlaces no abren y
  la emisión de diplomas sigue exactamente como hoy.

    DIPLOMA_CONFIRMACION_ACTIVA          1/true para encenderlo.
    DIPLOMA_CONFIRMACION_CENTROS         campus de Certifex en los que va
                                         («ISEIH,PSIKO»), separados por comas.
                                         Vacío = en todos. Así se prueba en uno.
    DIPLOMA_CONFIRMACION_DIAS            días que tiene el alumno (7, decidido).
    DIPLOMA_CONFIRMACION_INTENTOS        envíos con errores que admite el enlace (5).
    DIPLOMA_CONFIRMACION_ENVIAR_CORREO   1 para que el correo salga DE VERDAD.
                                         Por defecto NO: se arma, se apunta como
                                         simulado y a quien lo pidió se le da el
                                         enlace para probarlo. Encender solo cuando
                                         Manuel/Diego den el OK a que salga solo.

  Encendido en un campus, ese campus ya no emite sin la confirmación del alumno
  (o sin que hayan pasado los 7 días): lo mira `prepararEmision` de Certifex.

  Se leen en cada llamada, no al cargar el módulo: las pruebas los cambian y un
  `pm2 restart --update-env` no tiene que adivinar nada.
*/

const si = (v) => ['1', 'true', 'si', 'sí', 'yes'].includes(String(v || '').trim().toLowerCase());

export const activa = () => si(process.env.DIPLOMA_CONFIRMACION_ACTIVA);

const compacto = (s) => String(s || '').trim().toUpperCase();

function centrosDeLaLista() {
  return String(process.env.DIPLOMA_CONFIRMACION_CENTROS || '')
    .split(',').map(compacto).filter(Boolean);
}

/** ¿Va la confirmación en este campus de Certifex? Con el interruptor apagado, nunca. */
export function activaEn(centro) {
  if (!activa()) return false;
  const lista = centrosDeLaLista();
  if (!lista.length) return true;
  return lista.includes(compacto(centro));
}

const entero = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
};

export const diasDePlazo = () => entero(process.env.DIPLOMA_CONFIRMACION_DIAS, 7, 1, 60);
export const intentosMaximos = () => entero(process.env.DIPLOMA_CONFIRMACION_INTENTOS, 5, 1, 50);
export const enviarCorreo = () => si(process.env.DIPLOMA_CONFIRMACION_ENVIAR_CORREO);
