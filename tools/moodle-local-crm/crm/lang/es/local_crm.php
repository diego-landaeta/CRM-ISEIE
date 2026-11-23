<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * local_crm: la mensajería del campus, unida al CRM (CRM #679).
 *
 * @package    local_crm
 * @copyright  2026 ISEIE Innovation School
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'CRM';
$string['errorenvio'] = 'El CRM no ha aceptado el aviso: {$a}';
$string['crm:enviarcomo'] = 'Enviar mensajes y calificar en nombre del personal del campus (CRM)';
$string['privacy:metadata:crm'] = 'Los mensajes privados y los de los chats de grupo con las tutoras se reenvían al CRM del centro para que las tutoras puedan contestarlos desde allí.';
$string['privacy:metadata:crm:userid'] = 'El id de Moodle de quien escribe y de los destinatarios.';
$string['privacy:metadata:crm:fullname'] = 'El nombre completo de quien escribe y de los destinatarios.';
$string['privacy:metadata:crm:email'] = 'El correo de quien escribe y de los destinatarios.';
$string['privacy:metadata:crm:message'] = 'El texto del mensaje.';
$string['conectar_titulo'] = 'Conectar con el CRM';
$string['conectar_falta'] = 'Este campus todavía no está conectado con el CRM.';
$string['conectar_como'] = 'Pide en el CRM el código del campus (Integraciones › Campus › Conectar campus) y pégalo en «Conectar con el CRM». Es lo único que hay que hacer.';
$string['conectar_abrir'] = 'Conectar con el CRM';
$string['conectar_rehacer'] = 'Volver a conectar';
$string['conectar_intro'] = 'Pega el código que da el CRM para este campus (Integraciones › Campus › Conectar campus). El plugin hace el resto: activa los servicios web, crea su token y se presenta al CRM.';
$string['conectar_otra_vez'] = 'Si se ha perdido la conexión, pega un código nuevo y pulsa «Conectar». Si el código es de otro CRM, antes de cambiar se te dirá a cuál y se te pedirá que lo confirmes.';
$string['cambio_titulo'] = 'Este código es de otro CRM';
$string['cambio_ahora'] = 'Conectado ahora a';
$string['cambio_pasa_a'] = 'El código es de';
$string['cambio_que_pasa'] = 'El campus solo puede estar conectado a un CRM. Si cambias, <strong>{$a->actual}</strong> dejará de recibir los mensajes de este campus desde ese momento, y solo los recibirá {$a->nuevo}. Para volver, habrá que generar un código nuevo en {$a->actual} y pegarlo aquí.';
$string['cambio_entiendo'] = 'Entiendo que {$a} dejará de recibir los mensajes de este campus.';
$string['cambio_boton'] = 'Cambiar a {$a}';
$string['cambio_cancelar'] = 'Cancelar, seguir como está';
$string['cambio_sin_confirmar'] = 'El código es de otro CRM: hay que confirmar el cambio.';
$string['crm_tipo_produccion'] = '{$a} (producción)';
$string['crm_tipo_pruebas'] = '{$a} (pruebas)';
$string['crm_tipo_local'] = '{$a} (local, en esta máquina)';
$string['crm_desconocido'] = 'un CRM que no se puede identificar';
$string['conectar_codigo'] = 'Código de conexión';
$string['conectar_boton'] = 'Conectar';
$string['conectar_ok'] = 'Conectado con el CRM: {$a}. A partir de ahora, cada mensaje privado del campus llega al CRM.';
$string['conectar_error'] = 'No se ha podido conectar: {$a}';
$string['conectar_codigo_malo'] = 'Eso no es un código del CRM. Cópialo entero desde el CRM (empieza por «crm1.»).';
$string['conectar_inseguro'] = 'El código apunta a una dirección sin https: el token del campus no se manda por ahí.';
$string['conectar_sin_respuesta'] = 'el CRM no contesta ({$a}).';
$string['conectar_sesskey'] = 'La sesión de esta página ha caducado. Vuelve a pegar el código y pulsa «Conectar».';
$string['conectado_con'] = 'Conectado con el CRM: {$a}';
$string['conectado_que'] = 'Los mensajes privados del campus llegan al CRM y las tutoras pueden contestar desde allí.';
$string['desconectar_boton'] = 'Desconectar este campus del CRM';
$string['desconectar_ok'] = 'Campus desconectado. El CRM ya no recibe sus mensajes.';
$string['errorcalificar'] = 'No se ha podido guardar la nota.';
// Los motivos por los que el plugin no envía o no califica (1.10.2). Van en el mensaje del
// error, que llega al CRM aunque el campus tenga el modo de depuración apagado.
$string['usuarionovalido'] = 'Usuario no válido: {$a}';
$string['enviaramismo'] = 'No se puede enviar un mensaje a uno mismo.';
$string['enviarcomoadmin'] = 'No se puede enviar como el administrador del sitio.';
$string['enviarnopersonal'] = 'Solo se puede enviar como personal del campus.';
$string['mensajevacio'] = 'El mensaje está vacío.';
$string['chatnoesdeellos'] = 'Esa conversación no es un chat de grupo de ese alumno con esa tutora.';
$string['chatnoesdelalumno'] = 'Esa conversación no es el chat de grupo de ese alumno.';
$string['chatsoloprofesora'] = 'Solo responde en el chat de grupo una profesora de ese curso.';
$string['calificarcomoadmin'] = 'No se puede calificar como el administrador del sitio.';
$string['calificarsinpermiso'] = 'Esa persona no puede calificar esta tarea.';
$string['alumnonoentarea'] = 'El alumno no está en esta tarea.';
$string['alumnootrogrupo'] = 'El alumno es de otro grupo: no lo puede calificar.';
$string['calificarconescala'] = 'Esta tarea se califica con escala o sin nota: corrígela en el campus.';
$string['notafueraderango'] = 'La nota tiene que estar entre 0 y {$a}.';
$string['paso_1'] = 'En el CRM: Finanzas › Integraciones › el proyecto › Campus (Moodle) › «Conectar campus».';
$string['paso_2'] = 'Copia el código que aparece (empieza por «crm1.»).';
$string['paso_3'] = 'Pégalo aquí y pulsa «Conectar». El plugin hace el resto.';
$string['conectado_titulo'] = 'Conexión con el CRM';
$string['estado_conectado'] = 'Conectado';
$string['dato_campus'] = 'Campus en el CRM';
$string['dato_desde'] = 'Conectado desde';
$string['dato_crm'] = 'CRM';
$string['desconectar_que'] = 'Al desconectar, el CRM deja de recibir los mensajes de este campus. Se puede volver a conectar con un código nuevo.';
$string['crms'] = 'CRM permitidos';
$string['crms_desc'] = 'Los únicos CRM a los que este campus puede conectarse (uno por línea, solo el dominio). Un código que apunte a otro sitio se rechaza: así nadie puede llevarse el token del campus con un código falso.';
$string['conectar_no_permitido'] = 'El código apunta a {$a}, que no está en la lista de CRM permitidos del plugin. Si es de confianza, añádelo en los ajustes del plugin.';
$string['chat_grupo'] = 'Chat de grupo con las tutoras del curso';
$string['chat_grupo_desc'] = '«Entrar al chat» de la actividad Chat de cada curso abre la conversación de grupo del alumno con las tutoras de ese curso (no la sala): una por alumno y curso, todas ven lo mismo y cualquiera responde, desde Moodle o desde el CRM. Las que el CRM tiene «No disponible» salen de la conversación y vuelven a entrar, con todo el historial, al estar disponibles. Apagado, «Entrar al chat» abre la sala de siempre. De serie, apagado.';
$string['chat_grupo_nombre'] = 'Consultas · {$a->curso} · {$a->alumno}';
$string['excluir_nombre'] = 'No contar como tutoras a quienes se llamen';
$string['excluir_nombre_desc'] = 'Las cuentas cuyo nombre empiece por esto no entran en el chat aunque tengan rol de profesor (p. ej. las de inspección de FUNDAE).';
$string['chat_sin_tutora'] = 'Ahora mismo no hay ninguna tutora disponible en este curso. Lo que escribas llega igual al equipo, pero puede tardar: escríbenos más tarde o desde la mensajería.';
$string['task_sincronizar_miembros'] = 'Poner al día quién está en los chats de grupo del CRM';
$string['privacy:metadata:conversaciones'] = 'La conversación de grupo de cada alumno con las tutoras de su curso, abierta desde el chat del curso. Los mensajes son de la mensajería de Moodle.';
$string['privacy:metadata:conversaciones:courseid'] = 'El curso.';
$string['privacy:metadata:conversaciones:userid'] = 'El alumno.';
$string['privacy:metadata:conversaciones:conversationid'] = 'La conversación de la mensajería.';
$string['privacy:metadata:conversaciones:timecreated'] = 'Cuándo se abrió.';
$string['privacy:metadata:chat'] = 'De qué curso es cada conversación directa alumno-tutora abierta desde el chat de un curso (hasta la 1.8.0).';
$string['privacy:metadata:chat:conversationid'] = 'La conversación de la mensajería.';
$string['privacy:metadata:chat:courseid'] = 'El curso desde el que se abrió.';
$string['privacy:metadata:chat:alumnoid'] = 'El alumno.';
$string['privacy:metadata:chat:tutoraid'] = 'La tutora.';
$string['autoactualizar'] = 'Actualizar el plugin solo';
$string['autoactualizar_desc'] = 'Cada noche pregunta al CRM si hay versión nueva y, si está firmada por el CRM, la instala sola (con copia para volver atrás). Una versión sin la firma del CRM no se instala nunca. De serie, encendido. Apagado, solo avisa de que hay versión nueva y se instala a mano.';
$string['task_actualizar'] = 'Buscar e instalar la versión nueva del plugin del CRM';
$string['act_titulo'] = 'Actualizaciones';
$string['act_version'] = 'Versión instalada: {$a}';
$string['act_sola'] = 'se actualiza sola cada noche';
$string['act_apagada'] = 'la actualización automática está apagada';
$string['act_boton'] = 'Buscar actualización ahora';
$string['act_en_cola'] = 'Se buscará en el próximo minuto. Vuelve a esta página para ver el resultado.';
$string['act_sin_conexion'] = 'El campus no está conectado con el CRM.';
$string['act_nada_publicado'] = 'El CRM todavía no tiene ninguna versión publicada.';
$string['act_sin_respuesta'] = 'No se ha podido preguntar al CRM ({$a}).';
$string['act_manifiesto_malo'] = 'El CRM ha contestado algo que no es una versión del plugin: no se instala nada.';
$string['act_al_dia'] = 'Al día (versión {$a}).';
$string['act_firma_mala'] = 'La versión {$a} no trae una firma válida del CRM: no se instala.';
$string['act_moodle_viejo'] = 'Hay versión nueva ({$a}), pero necesita un Moodle más reciente.';
$string['act_disponible'] = 'Hay versión nueva ({$a}). Instálala a mano o enciende la actualización automática.';
$string['act_bloqueada_sitio'] = 'Hay versión nueva ({$a}), pero este Moodle no deja instalar extensiones solas: instálala a mano.';
$string['act_sin_permisos'] = 'Hay versión nueva ({$a}), pero Moodle no puede escribir en la carpeta del plugin: instálala a mano.';
$string['act_descarga_mala'] = 'La descarga de la versión {$a} no coincide con la publicada: no se instala.';
$string['act_zip_malo'] = 'El paquete descargado no es el plugin del CRM: no se instala.';
$string['act_fallo_instalar'] = 'No se ha podido instalar y se ha vuelto a la versión anterior: {$a}';
$string['act_hecho'] = 'Actualizado de la {$a->de} a la {$a->a}.';
