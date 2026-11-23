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
 * local_crm: la mensajería del campus, unida al CRM (CRM #679, #681).
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
 * Corregir una entrega desde el CRM, a nombre de la tutora (#681).
 *
 * La nota y el comentario quedan en Moodle como si la tutora hubiera corregido en el
 * campus: ella figura como quien califica, el alumno recibe su aviso de siempre y el
 * libro de calificaciones se actualiza. Solo si la tutora PUEDE calificar esa tarea
 * (`mod/assign:grade` en ella): el CRM no puede corregir por quien no corrige.
 */
class calificar extends external_api {
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'desde'      => new external_value(PARAM_INT, 'Id de Moodle de la tutora que corrige'),
            'tarea'      => new external_value(PARAM_INT, 'Id de la tarea (assign)'),
            'alumno'     => new external_value(PARAM_INT, 'Id de Moodle del alumno'),
            'nota'       => new external_value(PARAM_FLOAT, 'La nota'),
            'comentario' => new external_value(PARAM_RAW, 'El comentario para el alumno, en HTML', VALUE_DEFAULT, ''),
        ]);
    }

    public static function execute(int $desde, int $tarea, int $alumno, float $nota, string $comentario = ''): array {
        global $CFG, $DB, $USER;
        require_once($CFG->dirroot . '/mod/assign/locallib.php');

        $p = self::validate_parameters(self::execute_parameters(),
            ['desde' => $desde, 'tarea' => $tarea, 'alumno' => $alumno, 'nota' => $nota, 'comentario' => $comentario]);
        $sistema = \context_system::instance();
        self::validate_context($sistema);
        require_capability('local/crm:enviarcomo', $sistema);

        $cm = get_coursemodule_from_instance('assign', $p['tarea'], 0, false, MUST_EXIST);
        $contexto = \context_module::instance($cm->id);
        $curso = $DB->get_record('course', ['id' => $cm->course], '*', MUST_EXIST);
        $tutora = \core_user::get_user($p['desde'], '*', MUST_EXIST);
        // Nunca como el administrador del sitio (1.10.1, revisión de la #689): tiene todos los
        // permisos, así que `mod/assign:grade` no lo pararía.
        if (is_siteadmin($tutora)) {
            throw new \moodle_exception('calificarcomoadmin', 'local_crm');
        }
        if (!has_capability('mod/assign:grade', $contexto, $tutora)) {
            throw new \moodle_exception('calificarsinpermiso', 'local_crm');
        }
        if (!is_enrolled($contexto, $p['alumno'], 'mod/assign:submit')) {
            throw new \moodle_exception('alumnonoentarea', 'local_crm');
        }
        if (groups_get_activity_groupmode($cm) == SEPARATEGROUPS
                && !has_capability('moodle/site:accessallgroups', $contexto, $tutora)) {
            $suyos = groups_get_user_groups($cm->course, $tutora->id)[$cm->groupingid] ?? [];
            $delalumno = groups_get_user_groups($cm->course, $p['alumno'])[$cm->groupingid] ?? [];
            if (!array_intersect($suyos, $delalumno)) {
                throw new \moodle_exception('alumnootrogrupo', 'local_crm');
            }
        }

        $assign = new \assign($contexto, $cm, $curso);
        $maxima = (float) $assign->get_instance()->grade;
        // Con escala (grade < 0) o sin nota (0), una cifra no tiene sentido: se corrige en Moodle.
        if ($maxima <= 0) {
            throw new \moodle_exception('calificarconescala', 'local_crm');
        }
        if ($p['nota'] < 0 || $p['nota'] > $maxima) {
            throw new \moodle_exception('notafueraderango', 'local_crm', '', format_float($maxima, 2));
        }

        // Se guarda COMO la tutora: así figura ella como quien califica, como en el campus.
        $antes = $USER;
        \core\session\manager::set_user($tutora);
        try {
            // Con flujo de calificación, la nota se publica (released): si no, el alumno no la ve.
            $flujo = !empty($assign->get_instance()->markingworkflow);
            $datos = (object) [
                'grade' => $p['nota'], 'attemptnumber' => -1, 'addattempt' => 0,
                'workflowstate' => !$flujo ? '' : (has_capability('mod/assign:releasegrades', $contexto, $tutora)
                    ? ASSIGN_MARKING_WORKFLOW_STATE_RELEASED : ASSIGN_MARKING_WORKFLOW_STATE_READYFORRELEASE),
                'applytoall' => 0,
            ];
            // El comentario solo se guarda si la tarea tiene activados los comentarios de
            // retroalimentación: si no, Moodle lo descarta sin avisar. Se dice en la respuesta.
            $comentarios = $assign->get_feedback_plugin_by_type('comments');
            $admitecomentario = $comentarios && $comentarios->is_enabled() && $comentarios->is_visible();
            if ($admitecomentario && trim(strip_tags($p['comentario'])) !== '') {
                $datos->assignfeedbackcomments_editor = ['text' => $p['comentario'], 'format' => FORMAT_HTML];
            } else if ($admitecomentario) {
                // Sin comentario nuevo se deja el que había: si no se manda, Moodle lo da por
                // cambiado y guarda uno vacío encima.
                $nota = $assign->get_user_grade($p['alumno'], false);
                $previo = $nota ? $comentarios->get_feedback_comments($nota->id) : null;
                $datos->assignfeedbackcomments_editor = [
                    'text' => $previo ? (string) $previo->commenttext : '',
                    'format' => $previo ? (int) $previo->commentformat : FORMAT_HTML,
                ];
            }
            $ok = $assign->save_grade($p['alumno'], $datos);
        } finally {
            \core\session\manager::set_user($antes);
        }
        if (!$ok) {
            throw new \moodle_exception('errorcalificar', 'local_crm');
        }
        return ['ok' => true, 'nota' => $p['nota'], 'maxima' => $maxima,
            'comentario' => $admitecomentario && trim(strip_tags($p['comentario'])) !== ''];
    }

    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'ok'     => new external_value(PARAM_BOOL, 'Guardada'),
            'nota'   => new external_value(PARAM_FLOAT, 'La nota guardada'),
            'maxima' => new external_value(PARAM_FLOAT, 'La nota máxima de la tarea'),
            'comentario' => new external_value(PARAM_BOOL, 'Si se ha guardado el comentario'),
        ]);
    }
}
