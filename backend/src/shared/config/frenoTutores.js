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
 * Para levantarlo: `CORREOS_A_TUTORES=1` en el `.env` y reiniciar (Diego,
 * 06/11, en CRM#688: «que quitar el freno no exija tocar codigo»; portado con
 * el #197, como en MultiCRM). Sin la variable, o con cualquier otro valor, el
 * freno SIGUE PUESTO: olvidarla nunca suelta correos.
 */
//
// El código para cambiar el propio correo (#197, gemela de CRM#211) TAMBIÉN
// pasa por el freno (Diego, 06/11): mientras siga puesto, a un tutor no se le
// manda; su correo lo cambia el superadmin. Ver `pedirCodigo`
// (users/cambio-de-correo.js).
export const NO_ESCRIBIR_A_TUTORES = process.env.CORREOS_A_TUTORES !== '1';
