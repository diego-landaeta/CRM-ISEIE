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

namespace local_crm\external;

defined('MOODLE_INTERNAL') || die();

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * Contestar desde el CRM como la tutora, sin el token personal de cada una.
 *
 * Lo llama el CRM con el token de su servicio («CRM»), cuyo usuario tiene
 * `local/crm:enviarcomo`. Solo puede enviar como alguien que es personal del
 * campus (tutor, profesor o gestor): nunca como un alumno ni como el administrador del sitio.
 *
 *  - Sin `conversacionid`: por la conversación privada de los dos (se abre si no
 *    existía), así que el alumno lo ve en el mismo hilo que el resto.
 *  - Con `conversacionid` (1.9.0): en el chat de grupo del alumno con las tutoras de su
 *    curso. Tiene que ser un chat del plugin y de ESE alumno (`para`). Si la tutora no
 *    está dentro (estaba «No disponible», o acaba de entrar en el curso) y es profesora
 *    del curso, se la añade antes; si no es profesora del curso, no se envía.
 *    También vale otra conversación de grupo de un curso (la de un grupo del curso) en la
 *    que ya están la tutora, como profesora de ese curso, y el alumno.
 */
class enviar_mensaje extends external_api {
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'desde' => new external_value(PARAM_INT, 'Id de Moodle de la tutora que firma el mensaje'),
            'para'  => new external_value(PARAM_INT, 'Id de Moodle del destinatario (en un chat de grupo, el alumno)'),
            'texto' => new external_value(PARAM_RAW, 'El mensaje, en HTML'),
            'conversacionid' => new external_value(PARAM_INT, 'El chat de grupo del alumno (0 = conversación privada)',
                VALUE_DEFAULT, 0),
        ]);
    }

    public static function execute(int $desde, int $para, string $texto, int $conversacionid = 0): array {
        $p = self::validate_parameters(self::execute_parameters(),
            ['desde' => $desde, 'para' => $para, 'texto' => $texto, 'conversacionid' => $conversacionid]);
        $contexto = \context_system::instance();
        self::validate_context($contexto);
        require_capability('local/crm:enviarcomo', $contexto);

        foreach ([$p['desde'], $p['para']] as $id) {
            $u = \core_user::get_user($id, 'id, deleted, suspended');
            if (!$u || $u->deleted || $u->suspended) {
                throw new \moodle_exception('usuarionovalido', 'local_crm', '', $id);
            }
        }
        if ($p['desde'] === $p['para']) {
            throw new \moodle_exception('enviaramismo', 'local_crm');
        }
        // Nunca como el administrador del sitio (1.10.1): no es una tutora. `es_personal`
        // ya no lo acepta; se dice aparte para que el error explique qué pasa.
        if (is_siteadmin($p['desde'])) {
            throw new \moodle_exception('enviarcomoadmin', 'local_crm');
        }
        if (!\local_crm\aviso::es_personal($p['desde'])) {
            throw new \moodle_exception('enviarnopersonal', 'local_crm');
        }
        if (trim(strip_tags($p['texto'])) === '') {
            throw new \moodle_exception('mensajevacio', 'local_crm');
        }

        if ((int) $p['conversacionid'] > 0) {
            $conversacion = self::chat_de_grupo((int) $p['conversacionid'], $p['desde'], $p['para']);
        } else {
            $conversacion = \core_message\api::get_conversation_between_users([$p['desde'], $p['para']]);
            if (!$conversacion) {
                $conversacion = \core_message\api::create_conversation(
                    \core_message\api::MESSAGE_CONVERSATION_TYPE_INDIVIDUAL, [$p['desde'], $p['para']])->id;
            }
        }
        $mensaje = \core_message\api::send_message_to_conversation($p['desde'], $conversacion, $p['texto'], FORMAT_HTML);
        return ['id' => (int) $mensaje->id, 'conversacion_id' => (int) $conversacion];
    }

    /**
     * El chat de grupo donde va la respuesta, con la tutora dentro. Solo un chat del plugin,
     * solo el de ese alumno y solo como profesora de ese curso (o alguien que ya está dentro).
     */
    private static function chat_de_grupo(int $conversacionid, int $desde, int $alumno): int {
        $fila = \local_crm\chat_grupo::de_conversacion($conversacionid);
        if (!$fila) {
            // Otra conversación de grupo de un curso (la de un grupo del curso): solo si la
            // tutora ya está dentro y es profesora de ese curso, y el alumno también está. Aquí
            // no se añade a nadie: quién está en un grupo del curso lo decide el curso.
            $curso = \local_crm\chat_grupo::curso_de_conversacion($conversacionid);
            if (!$curso || !in_array($desde, \local_crm\chat_grupo::tutoras_dentro($conversacionid, $curso), true)
                    || !\core_message\api::is_user_in_conversation($alumno, $conversacionid)) {
                throw new \moodle_exception('chatnoesdeellos', 'local_crm');
            }
            return $conversacionid;
        }
        if ((int) $fila->userid !== $alumno) {
            throw new \moodle_exception('chatnoesdelalumno', 'local_crm');
        }
        if (!\core_message\api::is_user_in_conversation($desde, $conversacionid)) {
            $curso = \context_course::instance((int) $fila->courseid);
            if (!\local_crm\chat_directo::es_tutora($curso, $desde)) {
                throw new \moodle_exception('chatsoloprofesora', 'local_crm');
            }
            \core_message\api::add_members_to_conversation([$desde], $conversacionid);
        }
        // El alumno, siempre dentro (si alguien lo hubiera sacado a mano, vuelve).
        if (!\core_message\api::is_user_in_conversation($alumno, $conversacionid)) {
            \core_message\api::add_members_to_conversation([$alumno], $conversacionid);
        }
        return $conversacionid;
    }

    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'id'              => new external_value(PARAM_INT, 'Id del mensaje en Moodle'),
            'conversacion_id' => new external_value(PARAM_INT, 'Id de la conversación'),
        ]);
    }
}
