<?php
// Solo local: Carmen (coord679) pasa a ser profesora del curso CRM679, y Sofía es una
// tutora del campus que NO está en ese curso.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->dirroot . '/user/lib.php');
global $DB;
\core\session\manager::set_user(get_admin());
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$gen = new testing_data_generator();
$carmen = $DB->get_record('user', ['username' => 'coord679'], '*', MUST_EXIST);
$DB->set_field('user', 'firstname', 'Carmen', ['id' => $carmen->id]);
$DB->set_field('user', 'lastname', 'Coordinadora', ['id' => $carmen->id]);
$profe = $DB->get_field('role', 'id', ['shortname' => 'editingteacher']);
$gen->enrol_user($carmen->id, $curso->id, $profe);
if (!$sofia = $DB->get_record('user', ['username' => 'tutora679c'])) {
    $id = user_create_user((object) ['username' => 'tutora679c', 'auth' => 'manual', 'password' => 'Local-679-pass!',
        'firstname' => 'Sofía', 'lastname' => 'Otro Curso', 'email' => 'tutora679c@example.com',
        'confirmed' => 1, 'mnethostid' => $CFG->mnet_localhost_id], true, false);
    $sofia = $DB->get_record('user', ['id' => $id]);
}
echo json_encode(['carmen' => (int) $carmen->id, 'email_carmen' => $carmen->email, 'sofia' => (int) $sofia->id]), "\n";
