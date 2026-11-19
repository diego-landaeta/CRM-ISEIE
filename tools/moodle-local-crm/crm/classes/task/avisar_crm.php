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

namespace local_crm\task;

defined('MOODLE_INTERNAL') || die();

/**
 * Manda al CRM un mensaje privado. Si el CRM no contesta con un 2xx, lanza una
 * excepción y Moodle la vuelve a intentar más tarde.
 */
class avisar_crm extends \core\task\adhoc_task {
    public function execute() {
        $datos = $this->get_custom_data();
        $aviso = \local_crm\aviso::del_mensaje((int) $datos->mensajeid);
        if ($aviso === null) {
            return; // Borrado, de grupo o del propio usuario: no va al CRM.
        }
        \local_crm\aviso::enviar($aviso);
    }
}
