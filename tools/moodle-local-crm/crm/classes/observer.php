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

defined('MOODLE_INTERNAL') || die();

/**
 * El mensaje no se manda al CRM aquí: se encola. Así el alumno no espera a que el
 * CRM conteste al enviar su mensaje, y si el CRM está caído la tarea se reintenta
 * sola (las tareas ad hoc de Moodle se reintentan con espera creciente).
 */
class observer {
    /** Un mensaje privado: todos van al CRM (él decide cuáles son consultas). */
    public static function mensaje_enviado(\core\event\message_sent $evento): void {
        if (!aviso::configurado()) {
            return;
        }
        self::encolar((int) $evento->objectid);
    }

    /**
     * Un mensaje en una conversación de grupo (1.9.0). Va al CRM si es uno de los chats de
     * grupo del plugin o, además, cualquier conversación de grupo de un curso (p. ej. la de un
     * grupo del curso) en la que haya una tutora de ese curso: todos los chats de la tutora.
     */
    public static function mensaje_de_grupo(\core\event\group_message_sent $evento): void {
        if (!aviso::configurado()) {
            return;
        }
        $conversacion = (int) ($evento->other['conversationid'] ?? 0);
        if (!$conversacion) {
            return;
        }
        if (!chat_grupo::de_conversacion($conversacion)) {
            $curso = chat_grupo::curso_de_conversacion($conversacion);
            if (!$curso || !chat_grupo::tutoras_dentro($conversacion, $curso)) {
                return;
            }
        }
        self::encolar((int) $evento->objectid);
    }

    private static function encolar(int $mensajeid): void {
        $tarea = new task\avisar_crm();
        $tarea->set_custom_data(['mensajeid' => $mensajeid]);
        \core\task\manager::queue_adhoc_task($tarea);
    }
}
