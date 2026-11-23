<?php
// Casos límite de corrección (#681), solo en el Moodle local:
//   · tarea con ESCALA, tarea con FLUJO de calificación y tarea EN GRUPO, entregadas por Pedro;
//   · grupos A (María) y B (Pedro) en el curso;
//   · Pedro añade a su entrega del caso práctico un .html y un .svg con script.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->dirroot . '/mod/assign/locallib.php');
require_once($CFG->dirroot . '/group/lib.php');
global $DB;
\core\session\manager::set_user(get_admin());
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$pedro = $DB->get_record('user', ['username' => 'alumno679'], '*', MUST_EXIST);
$maria = $DB->get_record('user', ['username' => 'alumna679b'], '*', MUST_EXIST);
$gen = new testing_data_generator();

// Grupos.
$grupos = [];
foreach (['Grupo A' => $maria, 'Grupo B' => $pedro] as $nombre => $quien) {
    $g = $DB->get_record('groups', ['courseid' => $curso->id, 'name' => $nombre]);
    $gid = $g ? $g->id : groups_create_group((object) ['courseid' => $curso->id, 'name' => $nombre]);
    groups_add_member($gid, $quien->id);
    $grupos[$nombre] = (int) $gid;
}

$escala = $DB->get_record('scale', ['courseid' => 0], 'id', IGNORE_MULTIPLE);
function tarea($gen, $curso, $nombre, $extra) {
    global $DB;
    if ($a = $DB->get_record('assign', ['course' => $curso->id, 'name' => $nombre])) {
        return get_coursemodule_from_instance('assign', $a->id, $curso->id);
    }
    $i = $gen->create_module('assign', array_merge(['course' => $curso->id, 'name' => $nombre, 'submissiondrafts' => 0,
        'assignsubmission_onlinetext_enabled' => 1, 'assignfeedback_comments_enabled' => 1, 'duedate' => time() + 7 * 86400], $extra));
    return get_coursemodule_from_instance('assign', $i->id, $curso->id);
}
function entregar($cm, $curso, $alumno, $texto) {
    $assign = new assign(context_module::instance($cm->id), $cm, $curso);
    \core\session\manager::set_user($alumno);
    $datos = (object) ['onlinetext_editor' => ['text' => $texto, 'format' => FORMAT_HTML, 'itemid' => file_get_unused_draft_itemid()]];
    $avisos = [];
    $assign->save_submission($datos, $avisos);
    if (method_exists($assign, 'submit_for_grading')) {
        $assign->submit_for_grading((object) ['userid' => $alumno->id], $avisos);
    }
    \core\session\manager::set_user(get_admin());
    return $assign;
}
$ids = [];
$cm = tarea($gen, $curso, 'Reflexión (con escala)', ['grade' => -((int) $escala->id)]);
entregar($cm, $curso, $pedro, '<p>Mi reflexión.</p>'); $ids['escala'] = (int) $cm->instance;
$cm = tarea($gen, $curso, 'Proyecto con revisión', ['grade' => 10, 'markingworkflow' => 1]);
entregar($cm, $curso, $pedro, '<p>Mi proyecto.</p>'); $ids['flujo'] = (int) $cm->instance;
$cm = tarea($gen, $curso, 'Trabajo en grupo', ['grade' => 10, 'teamsubmission' => 1, 'requireallteammemberssubmit' => 0]);
entregar($cm, $curso, $pedro, '<p>Nuestro trabajo en grupo.</p>'); $ids['grupo'] = (int) $cm->instance;

// Ficheros peligrosos en la entrega de Pedro del caso práctico.
$a = $DB->get_record('assign', ['course' => $curso->id, 'name' => 'Caso práctico del módulo 2'], '*', MUST_EXIST);
$cm1 = get_coursemodule_from_instance('assign', $a->id, $curso->id);
$ctx = context_module::instance($cm1->id);
$sub = (new assign($ctx, $cm1, $curso))->get_user_submission($pedro->id, true);
$fs = get_file_storage();
$fs->delete_area_files($ctx->id, 'assignsubmission_file', 'submission_files', $sub->id);
$fs->create_file_from_string(['contextid' => $ctx->id, 'component' => 'assignsubmission_file', 'filearea' => 'submission_files',
    'itemid' => $sub->id, 'filepath' => '/', 'filename' => 'trampa.html', 'userid' => $pedro->id],
    '<html><body><script>alert(document.cookie)</script>Hola</body></html>');
$fs->create_file_from_string(['contextid' => $ctx->id, 'component' => 'assignsubmission_file', 'filearea' => 'submission_files',
    'itemid' => $sub->id, 'filepath' => '/', 'filename' => 'dibujo.svg', 'userid' => $pedro->id],
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
$DB->delete_records('assignsubmission_file', ['submission' => $sub->id]);
$DB->insert_record('assignsubmission_file', (object) ['assignment' => $a->id, 'submission' => $sub->id, 'numfiles' => 2]);
$DB->set_field('assign_submission', 'status', 'submitted', ['id' => $sub->id]);
echo json_encode(['tareas' => $ids, 'grupos' => $grupos, 'escala' => (int) $escala->id]), "\n";
