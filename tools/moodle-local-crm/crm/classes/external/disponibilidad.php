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
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * Las tutoras que el CRM tiene «No disponible» (vacaciones, baja): salen de los chats de
 * grupo (y vuelven al estar disponibles). Lo manda el CRM cada vez que cambia; es la lista entera.
 */
class disponibilidad extends external_api {
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'nodisponibles' => new external_multiple_structure(
                new external_value(PARAM_INT, 'Id de Moodle de una tutora no disponible'), 'Las no disponibles', VALUE_DEFAULT, []),
        ]);
    }

    public static function execute(array $nodisponibles = []): array {
        $p = self::validate_parameters(self::execute_parameters(), ['nodisponibles' => $nodisponibles]);
        $sistema = \context_system::instance();
        self::validate_context($sistema);
        require_capability('local/crm:enviarcomo', $sistema);
        $ids = array_values(array_unique(array_filter(array_map('intval', $p['nodisponibles']))));
        set_config('no_disponibles', implode(',', $ids), 'local_crm');
        // 1.9.0: quien está en cada chat de grupo, al día. Lo manda el CRM al cambiar y en el
        // repaso de cada 15 minutos, así que también recoge a las profesoras que entran o
        // salen de un curso. En segundo plano (puede haber muchas conversaciones) y una sola
        // tarea pendiente cada vez.
        \core\task\manager::queue_adhoc_task(new \local_crm\task\sincronizar_miembros(), true);
        return ['ok' => true, 'total' => count($ids)];
    }

    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'ok'    => new external_value(PARAM_BOOL, 'Guardado'),
            'total' => new external_value(PARAM_INT, 'Cuántas quedan fuera del reparto'),
        ]);
    }
}
