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
 * El repaso del CRM: los mensajes privados a partir de uno dado, con el mismo formato que
 * el aviso de cada mensaje. Con esto el CRM se pone al día aunque se haya perdido algún
 * aviso (CRM caído más de la cuenta, campus desconectado un rato…): lo repetido lo descarta
 * él por el id de Moodle.
 *
 * Se recorre por el id del mensaje (la clave de la tabla: rápido aunque haya millones). La
 * primera vez, sin id, desde una fecha.
 */
class mensajes_desde extends external_api {
    /** Como mucho, por llamada. */
    const TOPE = 200;

    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'desdeid'     => new external_value(PARAM_INT, 'Los mensajes con id mayor que este (0 = usar la fecha)', VALUE_DEFAULT, 0),
            'desdefecha'  => new external_value(PARAM_INT, 'Si no hay id: los escritos desde esta fecha (unix)', VALUE_DEFAULT, 0),
            'limite'      => new external_value(PARAM_INT, 'Cuántos como mucho', VALUE_DEFAULT, 100),
        ]);
    }

    public static function execute(int $desdeid = 0, int $desdefecha = 0, int $limite = 100): array {
        global $DB;
        $p = self::validate_parameters(self::execute_parameters(),
            ['desdeid' => $desdeid, 'desdefecha' => $desdefecha, 'limite' => $limite]);
        $sistema = \context_system::instance();
        self::validate_context($sistema);
        require_capability('local/crm:enviarcomo', $sistema);

        $limite = max(1, min(self::TOPE, (int) $p['limite']));
        // Los privados y, desde la 1.9.0, los de grupo: los chats de grupo del plugin y las
        // conversaciones de grupo de un curso con alguna tutora dentro. Las de grupo sin curso
        // o sin tutora las descarta aviso::del_mensaje (lo mismo que hace el aviso al momento).
        $params = [
            'tipo' => \core_message\api::MESSAGE_CONVERSATION_TYPE_INDIVIDUAL,
            'grupo' => \core_message\api::MESSAGE_CONVERSATION_TYPE_GROUP,
        ];
        if ((int) $p['desdeid'] > 0) {
            $donde = 'm.id > :desde';
            $params['desde'] = (int) $p['desdeid'];
        } else {
            $donde = 'm.timecreated >= :desde';
            $params['desde'] = max(0, (int) $p['desdefecha']);
        }
        $filas = $DB->get_records_sql(
            "SELECT m.id FROM {messages} m JOIN {message_conversations} c ON c.id = m.conversationid
              WHERE $donde AND (c.type = :tipo OR c.type = :grupo)
           ORDER BY m.id", $params, 0, $limite + 1);
        $ids = array_keys($filas);
        $mas = count($ids) > $limite;
        $ids = array_slice($ids, 0, $limite);
        $avisos = [];
        foreach ($ids as $id) {
            if ($aviso = \local_crm\aviso::del_mensaje((int) $id)) {
                $avisos[] = $aviso;
            }
        }
        $info = \core_plugin_manager::instance()->get_plugin_info('local_crm');
        return [
            'avisos'  => json_encode($avisos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'hastaid' => $ids ? (int) end($ids) : (int) $p['desdeid'],
            'mas'     => $mas,
            'version' => (string) ($info->release ?? ''),
        ];
    }

    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'avisos'  => new external_value(PARAM_RAW, 'Los avisos, en JSON (el mismo formato que el aviso de cada mensaje)'),
            'hastaid' => new external_value(PARAM_INT, 'El id del último mensaje visto: el próximo repaso sigue desde aquí'),
            'mas'     => new external_value(PARAM_BOOL, 'Si quedan más'),
            'version' => new external_value(PARAM_TEXT, 'La versión del plugin instalada'),
        ]);
    }
}
