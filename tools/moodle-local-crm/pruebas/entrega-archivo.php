<?php
// María entrega el caso práctico con texto y un PDF. Solo local.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->dirroot . '/mod/assign/locallib.php');
global $DB;
\core\session\manager::set_user(get_admin());
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$a = $DB->get_record('assign', ['course' => $curso->id, 'name' => 'Caso práctico del módulo 2'], '*', MUST_EXIST);
$cm = get_coursemodule_from_instance('assign', $a->id, $curso->id);
$ctx = context_module::instance($cm->id);
foreach (['enabled' => 1, 'maxfilesubmissions' => 5, 'maxsubmissionsizebytes' => 0] as $n => $v) {
    $DB->delete_records('assign_plugin_config', ['assignment' => $a->id, 'plugin' => 'file', 'subtype' => 'assignsubmission', 'name' => $n]);
    $DB->insert_record('assign_plugin_config', (object) ['assignment' => $a->id, 'plugin' => 'file', 'subtype' => 'assignsubmission', 'name' => $n, 'value' => $v]);
}
$maria = $DB->get_record('user', ['username' => 'alumna679b'], '*', MUST_EXIST);
$assign = new assign($ctx, $cm, $curso);
\core\session\manager::set_user($maria);
$sub = $assign->get_user_submission($maria->id, true);
$fs = get_file_storage();
$fs->delete_area_files($ctx->id, 'assignsubmission_file', 'submission_files', $sub->id);
$pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
$fs->create_file_from_string(['contextid' => $ctx->id, 'component' => 'assignsubmission_file', 'filearea' => 'submission_files',
    'itemid' => $sub->id, 'filepath' => '/', 'filename' => 'caso-practico-maria.pdf', 'userid' => $maria->id], $pdf);
$DB->delete_records('assignsubmission_file', ['submission' => $sub->id]);
$DB->insert_record('assignsubmission_file', (object) ['assignment' => $a->id, 'submission' => $sub->id, 'numfiles' => 1]);
$DB->delete_records('assignsubmission_onlinetext', ['submission' => $sub->id]);
$DB->insert_record('assignsubmission_onlinetext', (object) ['assignment' => $a->id, 'submission' => $sub->id,
    'onlinetext' => '<p>Adjunto el caso práctico en PDF. He seguido la plantilla del módulo.</p>', 'onlineformat' => FORMAT_HTML]);
$DB->set_field('assign_submission', 'status', 'submitted', ['id' => $sub->id]);
$DB->set_field('assign_submission', 'timemodified', time(), ['id' => $sub->id]);
echo "ok assign={$a->id} curso={$curso->id}\n";
