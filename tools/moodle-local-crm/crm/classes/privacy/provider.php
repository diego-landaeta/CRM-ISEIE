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
namespace local_crm\privacy;

defined('MOODLE_INTERNAL') || die();

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\userlist;
use core_privacy\local\request\writer;

/**
 * Lo que el plugin guarda en Moodle:
 *   · de qué curso es cada conversación del chat directo (hasta la 1.8.0), con el alumno
 *     y la tutora: `local_crm_chat`, en el contexto del sitio;
 *   · el chat de grupo de cada alumno y curso con sus tutoras (1.9.0): la fila de
 *     `local_crm_conversaciones` y la conversación de la mensajería de Moodle (componente
 *     `local_crm`, tipo `consulta`), en el contexto del curso. Sus mensajes los exporta y
 *     borra la API de la mensajería, a petición de este plugin.
 * Y lo que manda al CRM del centro: los mensajes privados y los de esos chats.
 */
class provider implements
        \core_privacy\local\metadata\provider,
        \core_privacy\local\request\plugin\provider,
        \core_privacy\local\request\core_userlist_provider {

    /** El área de los chats de grupo en la mensajería (= chat_grupo::COMPONENTE y ::TIPO). */
    const COMPONENTE = 'local_crm';
    const TIPO = 'consulta';

    public static function get_metadata(collection $coleccion): collection {
        $coleccion->add_database_table('local_crm_chat', [
            'conversationid' => 'privacy:metadata:chat:conversationid',
            'courseid'       => 'privacy:metadata:chat:courseid',
            'alumnoid'       => 'privacy:metadata:chat:alumnoid',
            'tutoraid'       => 'privacy:metadata:chat:tutoraid',
        ], 'privacy:metadata:chat');
        $coleccion->add_database_table('local_crm_conversaciones', [
            'courseid'       => 'privacy:metadata:conversaciones:courseid',
            'userid'         => 'privacy:metadata:conversaciones:userid',
            'conversationid' => 'privacy:metadata:conversaciones:conversationid',
            'timecreated'    => 'privacy:metadata:conversaciones:timecreated',
        ], 'privacy:metadata:conversaciones');
        $coleccion->add_subsystem_link('core_message', [], 'privacy:metadata:conversaciones');
        $coleccion->add_external_location_link('crm', [
            'userid'   => 'privacy:metadata:crm:userid',
            'fullname' => 'privacy:metadata:crm:fullname',
            'email'    => 'privacy:metadata:crm:email',
            'message'  => 'privacy:metadata:crm:message',
        ], 'privacy:metadata:crm');
        return $coleccion;
    }

    /** El sitio (chat directo) y los cursos donde está en un chat de grupo (como alumno o como tutora). */
    public static function get_contexts_for_userid(int $userid): contextlist {
        $lista = new contextlist();
        $lista->add_from_sql('SELECT ctx.id FROM {context} ctx WHERE ctx.contextlevel = :nivel AND EXISTS (
            SELECT 1 FROM {local_crm_chat} c WHERE c.alumnoid = :a OR c.tutoraid = :t)',
            ['nivel' => CONTEXT_SYSTEM, 'a' => $userid, 't' => $userid]);
        $lista->add_from_sql('SELECT ctx.id FROM {local_crm_conversaciones} c
            JOIN {context} ctx ON ctx.instanceid = c.courseid AND ctx.contextlevel = :nivel
           WHERE c.userid = :u', ['nivel' => CONTEXT_COURSE, 'u' => $userid]);
        \core_message\privacy\provider::add_contexts_for_conversations($lista, $userid, self::COMPONENTE, self::TIPO);
        return $lista;
    }

    public static function get_users_in_context(userlist $userlist) {
        $contexto = $userlist->get_context();
        if ($contexto instanceof \context_system) {
            $userlist->add_from_sql('alumnoid', 'SELECT alumnoid FROM {local_crm_chat}', []);
            $userlist->add_from_sql('tutoraid', 'SELECT tutoraid FROM {local_crm_chat}', []);
        } else if ($contexto instanceof \context_course) {
            $userlist->add_from_sql('userid', 'SELECT userid FROM {local_crm_conversaciones} WHERE courseid = :c',
                ['c' => $contexto->instanceid]);
            \core_message\privacy\provider::add_conversations_in_context($userlist, self::COMPONENTE, self::TIPO);
        }
    }

    public static function export_user_data(approved_contextlist $contextlist) {
        global $DB;
        $userid = (int) $contextlist->get_user()->id;
        $nombre = get_string('pluginname', 'local_crm');
        foreach ($contextlist->get_contexts() as $contexto) {
            if ($contexto instanceof \context_system) {
                $filas = $DB->get_records_select('local_crm_chat', 'alumnoid = ? OR tutoraid = ?', [$userid, $userid],
                    '', 'id, conversationid, courseid, alumnoid, tutoraid, timemodified');
                if ($filas) {
                    writer::with_context($contexto)->export_data([$nombre],
                        (object) ['chat_directo' => array_values($filas)]);
                }
            } else if ($contexto instanceof \context_course) {
                $filas = $DB->get_records('local_crm_conversaciones', ['courseid' => $contexto->instanceid, 'userid' => $userid],
                    '', 'id, courseid, userid, conversationid, timecreated');
                if ($filas) {
                    writer::with_context($contexto)->export_data([$nombre],
                        (object) ['chat_grupo' => array_values($filas)]);
                }
                \core_message\privacy\provider::export_conversations($userid, self::COMPONENTE, self::TIPO, $contexto, [$nombre]);
            }
        }
    }

    public static function delete_data_for_all_users_in_context(\context $contexto) {
        global $DB;
        if ($contexto instanceof \context_system) {
            $DB->delete_records('local_crm_chat');
        } else if ($contexto instanceof \context_course) {
            \core_message\privacy\provider::delete_conversations_for_all_users($contexto, self::COMPONENTE, self::TIPO);
            $DB->delete_records('local_crm_conversaciones', ['courseid' => $contexto->instanceid]);
        }
    }

    public static function delete_data_for_user(approved_contextlist $contextlist) {
        global $DB;
        $userid = (int) $contextlist->get_user()->id;
        $hayCursos = false;
        foreach ($contextlist->get_contexts() as $contexto) {
            if ($contexto instanceof \context_system) {
                $DB->delete_records_select('local_crm_chat', 'alumnoid = ? OR tutoraid = ?', [$userid, $userid]);
            } else if ($contexto instanceof \context_course) {
                $hayCursos = true;
                $DB->delete_records('local_crm_conversaciones', ['courseid' => $contexto->instanceid, 'userid' => $userid]);
            }
        }
        if ($hayCursos) {
            \core_message\privacy\provider::delete_conversations_for_user($contextlist, self::COMPONENTE, self::TIPO);
        }
    }

    public static function delete_data_for_users(approved_userlist $userlist) {
        global $DB;
        $contexto = $userlist->get_context();
        if (!$userlist->get_userids()) {
            return;
        }
        if ($contexto instanceof \context_system) {
            [$sql1, $p1] = $DB->get_in_or_equal($userlist->get_userids(), SQL_PARAMS_NAMED, 'a');
            [$sql2, $p2] = $DB->get_in_or_equal($userlist->get_userids(), SQL_PARAMS_NAMED, 't');
            $DB->delete_records_select('local_crm_chat', "alumnoid $sql1 OR tutoraid $sql2", $p1 + $p2);
        } else if ($contexto instanceof \context_course) {
            [$sql, $p] = $DB->get_in_or_equal($userlist->get_userids(), SQL_PARAMS_NAMED);
            $p['c'] = $contexto->instanceid;
            $DB->delete_records_select('local_crm_conversaciones', "courseid = :c AND userid $sql", $p);
            \core_message\privacy\provider::delete_conversations_for_users($userlist, self::COMPONENTE, self::TIPO);
        }
    }
}
