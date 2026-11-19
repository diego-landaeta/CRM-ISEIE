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
 * local_crm: la mensajería del campus, unida al CRM (CRM #679, #689).
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
 * Lo que el CRM necesita saber de una cuenta antes de vincularla a una tutora (1.10.2,
 * revisión de la #689): si existe y si es administradora del sitio. La API de Moodle
 * solo dice si es administradora la cuenta del token, no una cualquiera, y el CRM no
 * vincula nunca al administrador del sitio aunque dé clase.
 *
 * Solo lectura: no cambia nada.
 */
class cuenta extends external_api {
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'userid' => new external_value(PARAM_INT, 'Id de Moodle de la cuenta'),
        ]);
    }

    public static function execute(int $userid): array {
        $p = self::validate_parameters(self::execute_parameters(), ['userid' => $userid]);
        $sistema = \context_system::instance();
        self::validate_context($sistema);
        require_capability('local/crm:enviarcomo', $sistema);

        $u = \core_user::get_user((int) $p['userid'], 'id, deleted');
        $existe = $u && !$u->deleted;
        return [
            'existe'    => (bool) $existe,
            'siteadmin' => $existe && is_siteadmin((int) $u->id),
        ];
    }

    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'existe'    => new external_value(PARAM_BOOL, 'Si la cuenta existe (y no está borrada)'),
            'siteadmin' => new external_value(PARAM_BOOL, 'Si es administradora del sitio'),
        ]);
    }
}
