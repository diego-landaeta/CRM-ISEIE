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
 * «Entrar al chat»: lleva al alumno a su conversación de grupo con las tutoras de ese curso
 * (1.9.0), y a la tutora, a su mensajería (donde están las de todos sus alumnos).
 *
 * @package    local_crm
 * @copyright  2026 ISEIE Innovation School
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

$cmid = required_param('id', PARAM_INT);
$cm = get_coursemodule_from_id('chat', $cmid, 0, false, MUST_EXIST);
$curso = get_course($cm->course);
require_login($curso, false, $cm);
$contexto = context_course::instance($curso->id);
$sala = new moodle_url('/mod/chat/view.php', ['id' => $cm->id]);

if (!\local_crm\chat_grupo::activo()) {
    redirect($sala);
}
if (\local_crm\chat_directo::es_tutora($contexto, (int) $USER->id) || has_capability('moodle/course:update', $contexto)) {
    redirect(new moodle_url('/message/index.php'));
}
// Un invitado o alguien sin matrícula en el curso (p. ej. con acceso de invitado al curso) no
// abre un chat con las tutoras: va a la sala, como siempre.
if (isguestuser() || !is_enrolled($contexto)) {
    redirect($sala);
}
// La crea si no existe y deja dentro a las tutoras disponibles de ahora.
$conv = \local_crm\chat_grupo::conversacion((int) $curso->id, (int) $USER->id);
if (!$conv) {
    // Ninguna tutora disponible en el curso: se dice, en vez de abrir un chat que no lee nadie.
    redirect($sala, get_string('chat_sin_tutora', 'local_crm'), null, \core\output\notification::NOTIFY_WARNING);
}
$destino = new moodle_url('/message/index.php', ['convid' => $conv]);
if (\core_message\api::count_conversation_members($conv) < 2) {
    // Ya tenía su chat, pero ahora no hay ninguna tutora disponible: ve su historial y el aviso.
    redirect($destino, get_string('chat_sin_tutora', 'local_crm'), null, \core\output\notification::NOTIFY_WARNING);
}
redirect($destino);
