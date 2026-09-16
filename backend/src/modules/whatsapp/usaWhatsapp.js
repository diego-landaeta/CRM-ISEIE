import { query } from '../../shared/config/db.js';

/**
 * Si esta persona tiene encendido el WhatsApp del CRM (#128, punto 1).
 *
 * POR QUE ESTO NO VA EN EL TESTIGO DE SESION. El rol si viaja en el token, y por
 * eso `usuarioObjetivo` puede negar el paso a un tutor sin preguntar a la base.
 * Pero el token dura OCHO HORAS (`auth.service.js`), y una casilla que se apaga
 * para que alguien deje de aparecer no puede tardar una jornada en hacer efecto:
 * se apaga porque se quiere apagar ya.
 *
 * POR QUE TAMPOCO SE PREGUNTA CADA VEZ. El chat pregunta cada tres segundos —los
 * mensajes sin leer, las llamadas sonando— y esto se mira en cada una de esas
 * vueltas. Una consulta por vuelta y por persona es trafico constante para un
 * dato que cambia dos veces al ano.
 *
 * Asi que se guarda medio minuto y se olvida a proposito cuando alguien edita la
 * ficha: el cambio se nota al momento para quien lo hace, y el resto del tiempo
 * no cuesta nada. Media vida de la cache = lo que tarda alguien en decir «ya
 * esta» y recargar.
 */
const VIVE_MS = 30_000;

/** userId -> { usa: boolean, hasta: number } */
const recordado = new Map();

/**
 * Se pide con `to_jsonb` a proposito: mientras la migracion 156 no este
 * aplicada la columna no existe, y preguntar por ella de frente daria
 * «column "usa_whatsapp" does not exist» en CADA vuelta del chat. Asi devuelve
 * null, que aqui se lee como «que siga todo como hoy».
 *
 * Es la misma leccion del panel de claves (#113): guardar —ni entrar— puede
 * depender de una migracion que aprueba otro.
 */
export async function usaSuWhatsapp(userId) {
  // La clave, SIEMPRE numero. Aqui llega del testigo de sesion y en `olvidar`
  // del parametro de una ruta, que es texto: con `7` y `'7'` como claves
  // distintas, apagar a alguien no se notaria hasta pasado el medio minuto y
  // desde fuera pareceria que la casilla no guarda.
  const clave = Number(userId);
  const ahora = Date.now();
  const guardado = recordado.get(clave);
  if (guardado && guardado.hasta > ahora) return guardado.usa;

  const { rows } = await query(
    `SELECT COALESCE((to_jsonb(u) ->> 'usa_whatsapp')::boolean, true) AS usa
       FROM users u WHERE u.id = $1`,
    [clave]
  );
  // Sin fila no se inventa un permiso: si el usuario no existe, no usa nada.
  const usa = rows.length ? rows[0].usa !== false : false;
  recordado.set(clave, { usa, hasta: ahora + VIVE_MS });
  return usa;
}

/** Se acaba de tocar su ficha: la proxima pregunta va a la base. */
export function olvidar(userId) {
  recordado.delete(Number(userId));
}

/** Para las pruebas, y para no dejar estado entre una y otra. */
export function olvidarTodo() {
  recordado.clear();
}
