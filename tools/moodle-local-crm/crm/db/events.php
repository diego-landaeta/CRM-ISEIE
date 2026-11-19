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

// Cada mensaje privado que se envía en el campus avisa al CRM.

defined('MOODLE_INTERNAL') || die();

$observers = [
    [
        'eventname' => '\core\event\message_sent',
        'callback'  => '\local_crm\observer::mensaje_enviado',
    ],
    // 1.9.0: el chat de grupo del alumno con las tutoras de su curso.
    [
        'eventname' => '\core\event\group_message_sent',
        'callback'  => '\local_crm\observer::mensaje_de_grupo',
    ],
];
