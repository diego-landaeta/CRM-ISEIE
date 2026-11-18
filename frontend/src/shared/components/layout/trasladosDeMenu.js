/*
  ENTRADAS DEL MENÚ QUE CAMBIAN DE SITIO SIN CAMBIAR EL ACCESO.

  La foto del menú (#423, `__smoke__/menuPorPerfil423.test.jsx`) solo deja pasar lo
  que está en `CAMBIOS_DE_MENU` (backend, `cambios-aprobados.js`), y esa lista
  exige que lo que sale del menú ya diera 403 (`menuSinCambioDeAcceso423`). Un
  TRASLADO no es eso: quien veía la entrada vieja la sigue abriendo, en otro
  sitio. Por eso va aparte y en el frontal, sin tocar lo que Diego ya aprobó.

  Cada traslado:
    id          corto, para nombrarlo en la issue
    que         una frase, para Diego
    de          las entradas de antes, con su dirección (que redirige) y su permiso
    a           la entrada nueva, como sale en el menú («Sección › Entrada»)
    aprobadoPor null hasta que Diego lo apruebe en la issue

  Quien veía alguna de `de`, ve `a` en su lugar. Que el acceso es el mismo lo
  comprueba `webhooksJuntos755.test.jsx`: la entrada nueva pide cualquiera de
  los permisos de las viejas, y cada vieja tiene su pestaña con su permiso.
*/

export const TRASLADOS_DE_MENU = [
  {
    id: 'webhooks-juntos-755',
    que: 'Make, Webhooks (de Captación) y el webhook de transferencias (de Conexión) pasan a una sola entrada: «Conexión › Webhooks», con una pestaña para cada uno.',
    de: [
      { entrada: 'Captación › Make', ruta: '/make-webhooks', a: '/conexion/webhooks/make', permiso: 'make.view' },
      // Pedía además `forms.view`: su pantalla lee y escribe en `/api/forms`.
      { entrada: 'Captación › Webhooks', ruta: '/webhooks', a: '/conexion/webhooks/prospectos', permiso: 'webhooks.view', tambienPermiso: 'forms.view' },
      { entrada: 'Conexión › Webhook de transferencias', ruta: '/conexion/webhook-transferencias', a: '/conexion/webhooks/transferencias', permiso: 'webhooks_salientes.view' },
    ],
    a: 'Conexión › Webhooks',
    // Lo pide Diego en la #690 del 360 (05/11), punto 4, y en su gemela de ISEIE
    // (#409): estas tres entradas «se quitan del menú y quedan dentro del
    // apartado; sus rutas siguen funcionando».
    aprobadoPor: 'Diego, 05/11',
  },
];

/** El menú de antes con los traslados hechos: sin las entradas viejas y, si tenía alguna, con la nueva. */
export function aplicarTraslados(entradas, traslados = TRASLADOS_DE_MENU) {
  let out = [...entradas];
  for (const t of traslados) {
    const viejas = new Set(t.de.map((d) => d.entrada));
    const tenia = out.some((e) => viejas.has(e));
    out = out.filter((e) => !viejas.has(e));
    if (tenia && !out.includes(t.a)) out.push(t.a);
  }
  return out;
}
