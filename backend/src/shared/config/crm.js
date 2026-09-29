/**
 * Lo que distingue a ESTE CRM de su gemelo, para los correos al equipo.
 *
 * Todo lo demás de los correos es igual en los dos (paridad): aquí solo el
 * nombre, el color y dónde está cada pantalla —en MultiCRM los prospectos
 * viven en /prospectos, en ISEIE en /leads—.
 */
export const CRM_CORREOS = {
  nombre: 'CRM ISEIE',
  color: '#002776',
  rutas: {
    prospectos: '/leads',
    cola: '/leads/cola',
    seguimiento: '/leads/seguimiento',
    informes: '/informes',
    ventas: '/ventas',
  },
};
