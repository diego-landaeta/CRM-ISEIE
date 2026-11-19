<?php
// Uso: php grupos-separados.php poner|quitar
// poner: la tutora pasa a profesora SIN edición, solo en el Grupo A, y el curso a grupos separados.
// quitar: vuelve a profesora con edición, sin grupo, y el curso sin grupos.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->dirroot . '/group/lib.php');
global $DB;
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$tutora = $DB->get_record('user', ['username' => 'tutora679'], '*', MUST_EXIST);
$ctx = context_course::instance($curso->id);
$editora = $DB->get_field('role', 'id', ['shortname' => 'editingteacher']);
$profe = $DB->get_field('role', 'id', ['shortname' => 'teacher']);
$grupoA = $DB->get_field('groups', 'id', ['courseid' => $curso->id, 'name' => 'Grupo A']);
if ($argv[1] === 'poner') {
    role_unassign($editora, $tutora->id, $ctx->id);
    role_assign($profe, $tutora->id, $ctx->id);
    groups_add_member($grupoA, $tutora->id);
    $DB->update_record('course', (object) ['id' => $curso->id, 'groupmode' => SEPARATEGROUPS, 'groupmodeforce' => 1]);
} else {
    role_unassign($profe, $tutora->id, $ctx->id);
    role_assign($editora, $tutora->id, $ctx->id);
    groups_remove_member($grupoA, $tutora->id);
    $DB->update_record('course', (object) ['id' => $curso->id, 'groupmode' => NOGROUPS, 'groupmodeforce' => 0]);
}
rebuild_course_cache($curso->id, true);
echo "hecho: {$argv[1]}\n";
