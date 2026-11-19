<?php
// Solo local: el «Grupo A (mensajería)» del curso CRM679, con la mensajería de grupo encendida
// (Moodle crea su conversación de grupo, componente core_group) y dentro Laura, Pedro y María.
// Sirve para probar que el CRM recibe también las conversaciones de grupo del curso en las
// que está una tutora (1.9.0, #285).
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->dirroot . '/group/lib.php');
global $DB;
\core\session\manager::set_user(get_admin());
set_config('messaging', 1);
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$nombre = 'Grupo A (mensajería)';
if (!$grupo = $DB->get_record('groups', ['courseid' => $curso->id, 'name' => $nombre])) {
    $id = groups_create_group((object) ['courseid' => $curso->id, 'name' => $nombre, 'enablemessaging' => 1]);
    $grupo = $DB->get_record('groups', ['id' => $id]);
}
foreach (['tutora679', 'alumno679', 'alumna679b'] as $u) {
    groups_add_member($grupo->id, $DB->get_field('user', 'id', ['username' => $u], MUST_EXIST));
}
$conv = \core_message\api::get_conversation_by_area('core_group', 'groups', $grupo->id,
    \context_course::instance($curso->id)->id);
echo json_encode(['grupo' => (int) $grupo->id, 'conversacion' => $conv ? (int) $conv->id : null]), "\n";
