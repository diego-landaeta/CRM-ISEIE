/**
 * El freno de mano de los correos a tutores.
 *
 * Diego, 15/09/2026: «quita esa opcion, que nadie reciba nada aun. NO SE
 * PUEDEN ENVIAR LOS CORREOS A TUTORES NI NADA DE ESO».
 *
 * Vivia como constante dentro de users/user.service.js. Se saca aqui, como en
 * MultiCRM, porque desde el 01/10 tambien lo lee el alta de tutores: con el
 * freno puesto no se deja dar de alta a un tutor sin contraseña, porque no le
 * llega ningun correo para ponerla (Diego: «esa opción para tutores no debe de
 * mandarse ni hacerse»).
 *
 * Para levantarlo: poner `false` AQUI, en los dos CRM.
 */
export const NO_ESCRIBIR_A_TUTORES = true;
