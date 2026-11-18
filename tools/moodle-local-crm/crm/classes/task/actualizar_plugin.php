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

/**
 * Una vez al día: ¿hay versión nueva del plugin en el CRM? Si la hay y está firmada, se instala.
 */
class actualizar_plugin extends \core\task\scheduled_task {
    public function get_name() {
        return get_string('task_actualizar', 'local_crm');
    }

    public function execute() {
        if (!\local_crm\conexion::conectado()) {
            return;
        }
        \local_crm\actualizar::comprobar(true);
    }
}
