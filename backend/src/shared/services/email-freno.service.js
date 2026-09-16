import { logger } from '../utils/logger.js';

/**
 * El freno: fuera de produccion no sale ni un correo a un cliente real.
 *
 * Es la tercera subfase de la tarea #27, y la que mas urge de las cuatro. Hoy
 * cualquier prueba en `/testeo` manda correo de verdad a quien sea — y con los
 * reintentos recien puestos, lo intenta tres veces en vez de una. Un correo
 * repetido molesta; un correo de pruebas a un cliente real es otra cosa.
 *
 * Como funciona:
 *
 *   · En produccion (`NODE_ENV=production`) no hay freno. Sale todo.
 *   · Fuera de produccion solo salen los correos cuyos destinatarios estan TODOS
 *     en la lista blanca. Basta con que uno no lo este para no mandarlo: si un
 *     aviso va a tres administradores y uno es de verdad, no se manda a ninguno.
 *   · La lista se pone en `EMAIL_LISTA_BLANCA`, separada por comas. Admite
 *     dominios enteros con `@`: `@empresa.com` deja pasar a cualquiera de la casa.
 *
 * Sin lista blanca configurada fuera de produccion **no sale nada**, y es a
 * proposito: quien monte un entorno nuevo y se olvide de configurarla se
 * encuentra con que no le llegan los correos, que es un problema visible y sin
 * consecuencias. Al reves —dejar pasar todo por defecto— el problema es
 * invisible y se lo come un cliente.
 */

const esProduccion = () => process.env.NODE_ENV === 'production';

/** La lista blanca, ya troceada. Se lee en cada llamada: cambiarla no exige reiniciar. */
function listaBlanca() {
  return String(process.env.EMAIL_LISTA_BLANCA || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** ¿Esta direccion esta autorizada en este entorno? */
function autorizada(direccion, lista) {
  const d = String(direccion || '').trim().toLowerCase();
  if (!d) return false;
  return lista.some((permitido) => (
    permitido.startsWith('@')
      // Un dominio entero: `@empresa.com` deja pasar a cualquiera de la casa.
      ? d.endsWith(permitido)
      : d === permitido
  ));
}

/**
 * ¿Se puede mandar este correo desde este entorno?
 *
 * Devuelve `{ pasa, motivo, bloqueados }`. Nunca lanza: un fallo aqui no puede
 * ser lo que impida mandar un correo en produccion.
 */
export function dejaPasar(destinatarios) {
  try {
    if (esProduccion()) return { pasa: true, motivo: null, bloqueados: [] };

    // `destinatarios` llega como la cadena que ya arma Brevo, con comas cuando
    // son varios.
    const lista = listaBlanca();
    const direcciones = String(destinatarios || '')
      .split(',').map((s) => s.trim()).filter(Boolean);

    if (!direcciones.length) {
      return { pasa: false, motivo: 'SIN_DESTINATARIO', bloqueados: [] };
    }

    if (!lista.length) {
      return {
        pasa: false,
        motivo: 'SIN_LISTA_BLANCA',
        bloqueados: direcciones,
      };
    }

    const bloqueados = direcciones.filter((d) => !autorizada(d, lista));
    if (bloqueados.length) {
      return { pasa: false, motivo: 'FUERA_DE_LA_LISTA', bloqueados };
    }
    return { pasa: true, motivo: null, bloqueados: [] };
  } catch (err) {
    // Si el freno se rompe, en produccion se deja pasar —es donde tiene que
    // salir— y fuera se para, que es el lado seguro del fallo.
    logger.error({ err: err.message }, 'Freno de correo: fallo comprobando, se aplica el lado seguro');
    return esProduccion()
      ? { pasa: true, motivo: null, bloqueados: [] }
      : { pasa: false, motivo: 'ERROR_DEL_FRENO', bloqueados: [] };
  }
}

/** Para decirlo en el registro y en el aviso, sin repetir el texto en dos sitios. */
export function porQueSeParo(motivo, bloqueados) {
  switch (motivo) {
    case 'SIN_LISTA_BLANCA':
      return 'Fuera de produccion y sin EMAIL_LISTA_BLANCA configurada: no sale ningun correo.';
    case 'FUERA_DE_LA_LISTA':
      return `Fuera de produccion y estos destinatarios no estan en la lista blanca: ${bloqueados.join(', ')}`;
    case 'SIN_DESTINATARIO':
      return 'No habia ningun destinatario.';
    default:
      return 'El freno de correo lo paro.';
  }
}
