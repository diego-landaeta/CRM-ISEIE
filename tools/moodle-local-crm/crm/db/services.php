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

// La función que usa el CRM para contestar desde el CRM como la tutora, y el
// servicio que la agrupa (junto a las de lectura que ya usaba el CRM).

defined('MOODLE_INTERNAL') || die();

$functions = [
    'local_crm_enviar_mensaje' => [
        'classname'    => '\local_crm\external\enviar_mensaje',
        'description'  => 'Envía un mensaje en nombre de un miembro del personal del campus (tutora): privado a un usuario o en el chat de grupo del alumno con las tutoras.',
        'type'         => 'write',
        'capabilities' => 'local/crm:enviarcomo',
    ],
];

$functions['local_crm_disponibilidad'] = [
    'classname'    => '\local_crm\external\disponibilidad',
    'description'  => 'Guarda qué tutoras tiene el CRM como «No disponible»: salen de los chats de grupo hasta que vuelvan.',
    'type'         => 'write',
    'capabilities' => 'local/crm:enviarcomo',
];

$functions['local_crm_mensajes_desde'] = [
    'classname'    => '\local_crm\external\mensajes_desde',
    'description'  => 'Los mensajes privados y de los chats de grupo del plugin desde uno dado, para que el CRM se ponga al día aunque se haya perdido un aviso.',
    'type'         => 'read',
    'capabilities' => 'local/crm:enviarcomo',
];

$functions['local_crm_calificar'] = [
    'classname'    => '\local_crm\external\calificar',
    'description'  => 'Califica una entrega (nota y comentario) a nombre de la tutora que corrige.',
    'type'         => 'write',
    'capabilities' => 'local/crm:enviarcomo',
];

// 1.10.2 (revisión de la #689): para que el CRM no vincule nunca al administrador del
// sitio a una tutora. Moodle registra la función y la añade al servicio al actualizar.
$functions['local_crm_cuenta'] = [
    'classname'    => '\local_crm\external\cuenta',
    'description'  => 'Si una cuenta existe y si es administradora del sitio: el CRM no la vincula a una tutora si lo es.',
    'type'         => 'read',
    'capabilities' => 'local/crm:enviarcomo',
];

$services = [
    'CRM' => [
        'functions' => [
            'local_crm_enviar_mensaje',
            'core_webservice_get_site_info',
            'core_user_get_users_by_field',
            'core_message_get_conversations',
            'core_message_get_conversation_messages',
            'core_enrol_get_users_courses',
            'core_enrol_get_enrolled_users',
            'core_course_get_contents',
            // 1.10.8 (#769): la lista de cursos del campus, para avisar a administración de
            // las entregas sin corregir de los cursos sin tutora vinculada en el CRM. Solo lee.
            // Moodle la añade al servicio al actualizar el plugin (no hace falta paso en upgrade.php).
            'core_course_get_courses_by_field',
            'mod_assign_get_assignments',
            'mod_assign_get_submissions',
            'mod_assign_get_grades',
            // 1.10.9 (#532): las notas de un alumno (las de cada actividad y la final) para
            // su ficha en el CRM. Solo lee. Moodle la añade al servicio al actualizar.
            'gradereport_user_get_grade_items',
            'local_crm_calificar',
            'local_crm_disponibilidad',
            'local_crm_mensajes_desde',
            'local_crm_cuenta',
        ],
        'shortname'       => 'local_crm',
        // Sin lista de usuarios autorizados: el token lo crea el propio plugin al
        // conectar, para el administrador que conecta (como local_certifex).
        'restrictedusers' => 0,
        'enabled'         => 1,
        // Para abrir desde el CRM los archivos que entregan los alumnos (corregir, #681).
        'downloadfiles'   => 1,
    ],
];
