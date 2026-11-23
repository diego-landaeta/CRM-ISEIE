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
 * Pone al día quién está en cada chat de grupo del plugin (1.9.0): el alumno siempre, las
 * tutoras disponibles del curso dentro y las demás fuera. La encola la disponibilidad que
 * manda el CRM (al cambiar y en el repaso de cada 15 minutos).
 */
class sincronizar_miembros extends \core\task\adhoc_task {
    public function get_name(): string {
        return get_string('task_sincronizar_miembros', 'local_crm');
    }

    public function execute() {
        // Con el chat de grupo apagado no se toca ninguna conversación: ni entra ni sale nadie.
        if (!\local_crm\chat_grupo::activo()) {
            if (function_exists('mtrace')) {
                mtrace('local_crm: chat de grupo apagado; no se tocan los miembros.');
            }
            return;
        }
        $r = \local_crm\chat_grupo::sincronizar_todas();
        if (function_exists('mtrace')) {
            mtrace("local_crm: chats de grupo al día ({$r['conversaciones']}): entran {$r['entran']}, salen {$r['salen']}.");
        }
    }
}
