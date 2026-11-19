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

namespace local_crm;

/**
 * Hooks de Moodle 4.4 y posteriores (en los anteriores lo hace lib.php).
 */
class hook_callbacks {

    /**
     * El script del botón del chat, al pie de la página de la actividad Chat.
     *
     * @param \core\hook\output\before_footer_html_generation $hook
     */
    public static function before_footer(\core\hook\output\before_footer_html_generation $hook): void {
        // Con el chat de grupo apagado (de serie), ni se prepara: la página del Chat, como siempre.
        if (!chat_grupo::activo()) {
            return;
        }
        try {
            $hook->add_html(chat_directo::script_del_boton());
        } catch (\Throwable $e) {
            debugging('local_crm: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    }
}
