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
$string['errorenvio'] = 'The CRM did not accept the notice: {$a}';
$string['crm:enviarcomo'] = 'Send messages and grade on behalf of campus staff (CRM)';
$string['privacy:metadata:crm'] = 'Private messages and the messages of the group chats with the tutors are forwarded to the institution\'s CRM so tutors can answer them from there.';
$string['privacy:metadata:crm:userid'] = 'The Moodle id of the sender and the recipients.';
$string['privacy:metadata:crm:fullname'] = 'The full name of the sender and the recipients.';
$string['privacy:metadata:crm:email'] = 'The email of the sender and the recipients.';
$string['privacy:metadata:crm:message'] = 'The text of the message.';
$string['conectar_titulo'] = 'Connect to the CRM';
$string['conectar_falta'] = 'This campus is not connected to the CRM yet.';
$string['conectar_como'] = 'Get this campus code in the CRM (Integrations › Campus › Connect campus) and paste it in «Connect to the CRM». That is all it takes.';
$string['conectar_abrir'] = 'Connect to the CRM';
$string['conectar_rehacer'] = 'Connect again';
$string['conectar_intro'] = 'Paste the code the CRM gives for this campus (Integrations › Campus › Connect campus). The plugin does the rest: it enables web services, creates its token and introduces itself to the CRM.';
$string['conectar_otra_vez'] = 'If the connection was lost, paste a new code and press «Connect». If the code belongs to another CRM, you will be told which one and asked to confirm before switching.';
$string['cambio_titulo'] = 'This code belongs to another CRM';
$string['cambio_ahora'] = 'Connected now to';
$string['cambio_pasa_a'] = 'The code belongs to';
$string['cambio_que_pasa'] = 'The campus can only be connected to one CRM. If you switch, <strong>{$a->actual}</strong> will stop receiving this campus messages from that moment on, and only {$a->nuevo} will get them. To go back, generate a new code in {$a->actual} and paste it here.';
$string['cambio_entiendo'] = 'I understand that {$a} will stop receiving this campus messages.';
$string['cambio_boton'] = 'Switch to {$a}';
$string['cambio_cancelar'] = 'Cancel, keep it as it is';
$string['cambio_sin_confirmar'] = 'The code belongs to another CRM: the switch has to be confirmed.';
$string['crm_tipo_produccion'] = '{$a} (production)';
$string['crm_tipo_pruebas'] = '{$a} (testing)';
$string['crm_tipo_local'] = '{$a} (local, on this machine)';
$string['crm_desconocido'] = 'a CRM that cannot be identified';
$string['conectar_codigo'] = 'Connection code';
$string['conectar_boton'] = 'Connect';
$string['conectar_ok'] = 'Connected to the CRM: {$a}. From now on every private message on the campus reaches the CRM.';
$string['conectar_error'] = 'Could not connect: {$a}';
$string['conectar_codigo_malo'] = 'That is not a CRM code. Copy it whole from the CRM (it starts with «crm1.»).';
$string['conectar_inseguro'] = 'The code points to an address without https: the campus token is not sent there.';
$string['conectar_sin_respuesta'] = 'the CRM does not answer ({$a}).';
$string['conectar_sesskey'] = 'This page session has expired. Paste the code again and press «Connect».';
$string['conectado_con'] = 'Connected to the CRM: {$a}';
$string['conectado_que'] = 'Private messages on the campus reach the CRM and tutors can answer from there.';
$string['desconectar_boton'] = 'Disconnect this campus from the CRM';
$string['desconectar_ok'] = 'Campus disconnected. The CRM no longer receives its messages.';
$string['errorcalificar'] = 'The grade could not be saved.';
$string['usuarionovalido'] = 'Invalid user: {$a}';
$string['enviaramismo'] = 'A message cannot be sent to oneself.';
$string['enviarcomoadmin'] = 'Messages cannot be sent as the site administrator.';
$string['enviarnopersonal'] = 'Messages can only be sent as campus staff.';
$string['mensajevacio'] = 'The message is empty.';
$string['chatnoesdeellos'] = 'That conversation is not a group chat of that student with that tutor.';
$string['chatnoesdelalumno'] = 'That conversation is not the group chat of that student.';
$string['chatsoloprofesora'] = 'Only a teacher of that course can answer in the group chat.';
$string['calificarcomoadmin'] = 'Grading as the site administrator is not allowed.';
$string['calificarsinpermiso'] = 'That person cannot grade this assignment.';
$string['alumnonoentarea'] = 'The student is not in this assignment.';
$string['alumnootrogrupo'] = 'The student is in another group: they cannot grade them.';
$string['calificarconescala'] = 'This assignment is graded with a scale or has no grade: grade it on the campus.';
$string['notafueraderango'] = 'The grade must be between 0 and {$a}.';
$string['paso_1'] = 'In the CRM: Finance › Integrations › the project › Campus (Moodle) › «Connect campus».';
$string['paso_2'] = 'Copy the code shown (it starts with «crm1.»).';
$string['paso_3'] = 'Paste it here and press «Connect». The plugin does the rest.';
$string['conectado_titulo'] = 'Connection to the CRM';
$string['estado_conectado'] = 'Connected';
$string['dato_campus'] = 'Campus in the CRM';
$string['dato_desde'] = 'Connected since';
$string['dato_crm'] = 'CRM';
$string['desconectar_que'] = 'When disconnected, the CRM stops receiving this campus messages. You can connect again with a new code.';
$string['crms'] = 'Allowed CRMs';
$string['crms_desc'] = 'The only CRMs this site may connect to (one per line, domain only). A code pointing anywhere else is rejected, so nobody can take the site token with a fake code.';
$string['conectar_no_permitido'] = 'The code points to {$a}, which is not in the plugin list of allowed CRMs. If you trust it, add it in the plugin settings.';
$string['chat_grupo'] = 'Group chat with the course tutors';
$string['chat_grupo_desc'] = '«Enter the chat» on each course Chat activity opens the student group conversation with the tutors of that course (not the room): one per student and course, every tutor sees the same and any of them answers, from Moodle or from the CRM. Tutors marked «Not available» in the CRM leave the conversation and come back, with the whole history, when available again. When off, «Enter the chat» opens the usual room. Off by default.';
$string['chat_grupo_nombre'] = 'Questions · {$a->curso} · {$a->alumno}';
$string['excluir_nombre'] = 'Do not count as tutors accounts named';
$string['excluir_nombre_desc'] = 'Accounts whose name starts with this never join the chat even with a teacher role (e.g. inspection accounts).';
$string['chat_sin_tutora'] = 'There is no tutor available in this course right now. What you write still reaches the team, but it may take longer: please try later or use messaging.';
$string['task_sincronizar_miembros'] = 'Update who is in the CRM group chats';
$string['privacy:metadata:conversaciones'] = 'The group conversation of each student with the tutors of their course, opened from the course chat. Messages belong to Moodle messaging.';
$string['privacy:metadata:conversaciones:courseid'] = 'The course.';
$string['privacy:metadata:conversaciones:userid'] = 'The student.';
$string['privacy:metadata:conversaciones:conversationid'] = 'The messaging conversation.';
$string['privacy:metadata:conversaciones:timecreated'] = 'When it was opened.';
$string['privacy:metadata:chat'] = 'Which course each direct student-tutor conversation opened from a course chat belongs to (up to 1.8.0).';
$string['privacy:metadata:chat:conversationid'] = 'The messaging conversation.';
$string['privacy:metadata:chat:courseid'] = 'The course it was opened from.';
$string['privacy:metadata:chat:alumnoid'] = 'The student.';
$string['privacy:metadata:chat:tutoraid'] = 'The tutor.';
$string['autoactualizar'] = 'Update the plugin automatically';
$string['autoactualizar_desc'] = 'Every night it asks the CRM for a new version and, if it is signed by the CRM, installs it (keeping a copy to roll back). A version without the CRM signature is never installed. On by default. When off, it only tells you there is a new version, to install by hand.';
$string['task_actualizar'] = 'Check for and install the new CRM plugin version';
$string['act_titulo'] = 'Updates';
$string['act_version'] = 'Installed version: {$a}';
$string['act_sola'] = 'updates itself every night';
$string['act_apagada'] = 'automatic updates are off';
$string['act_boton'] = 'Check for updates now';
$string['act_en_cola'] = 'It will check within the next minute. Come back to this page to see the result.';
$string['act_sin_conexion'] = 'This site is not connected to the CRM.';
$string['act_nada_publicado'] = 'The CRM has not published any version yet.';
$string['act_sin_respuesta'] = 'Could not ask the CRM ({$a}).';
$string['act_manifiesto_malo'] = 'The CRM answered something that is not a plugin version: nothing is installed.';
$string['act_al_dia'] = 'Up to date (version {$a}).';
$string['act_firma_mala'] = 'Version {$a} has no valid CRM signature: not installed.';
$string['act_moodle_viejo'] = 'There is a new version ({$a}), but it needs a newer Moodle.';
$string['act_disponible'] = 'There is a new version ({$a}). Install it by hand or turn on automatic updates.';
$string['act_bloqueada_sitio'] = 'There is a new version ({$a}), but this Moodle does not allow installing add-ons automatically: install it by hand.';
$string['act_sin_permisos'] = 'There is a new version ({$a}), but Moodle cannot write to the plugin folder: install it by hand.';
$string['act_descarga_mala'] = 'The download of version {$a} does not match the published one: not installed.';
$string['act_zip_malo'] = 'The downloaded package is not the CRM plugin: not installed.';
$string['act_fallo_instalar'] = 'Could not install; the previous version was restored: {$a}';
$string['act_hecho'] = 'Updated from {$a->de} to {$a->a}.';
