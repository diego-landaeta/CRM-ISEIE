<?php
// Dos tareas en el curso de prueba: una entregada sin corregir y otra corregida. Solo local.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->dirroot . '/mod/assign/locallib.php');
global $DB;
\core\session\manager::set_user(get_admin());
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$alumno = $DB->get_record('user', ['username' => 'alumno679'], '*', MUST_EXIST);
$tutora = $DB->get_record('user', ['username' => 'tutora679'], '*', MUST_EXIST);
$gen = new testing_data_generator();

function tarea($gen, $curso, $nombre) {
    global $DB;
    if ($a = $DB->get_record('assign', ['course' => $curso->id, 'name' => $nombre])) {
        return get_coursemodule_from_instance('assign', $a->id, $curso->id);
    }
    $i = $gen->create_module('assign', ['course' => $curso->id, 'name' => $nombre, 'submissiondrafts' => 0,
        'assignsubmission_onlinetext_enabled' => 1, 'duedate' => time() + 7 * 86400, 'grade' => 100]);
    return get_coursemodule_from_instance('assign', $i->id, $curso->id);
}
function entregar($cm, $curso, $alumno, $texto) {
    $assign = new assign(context_module::instance($cm->id), $cm, $curso);
    \core\session\manager::set_user($alumno);
    $datos = (object) ['onlinetext_editor' => ['text' => $texto, 'format' => FORMAT_HTML, 'itemid' => file_get_unused_draft_itemid()]];
    $avisos = [];
    $assign->save_submission($datos, $avisos);
    \core\session\manager::set_user(get_admin());
    return $assign;
}
$cm1 = tarea($gen, $curso, 'Caso práctico del módulo 2');
entregar($cm1, $curso, $alumno, '<p>Mi caso práctico del módulo 2.</p>');
$cm2 = tarea($gen, $curso, 'Test inicial');
$a2 = entregar($cm2, $curso, $alumno, '<p>Respuestas del test.</p>');
\core\session\manager::set_user($tutora);
$a2->save_grade($alumno->id, (object) ['grade' => 85, 'attemptnumber' => -1, 'addattempt' => 0, 'workflowstate' => '', 'applytoall' => 0]);
\core\session\manager::set_user(get_admin());
echo json_encode(['sin_corregir' => (int) $cm1->id, 'corregida' => (int) $cm2->id]), "\n";
