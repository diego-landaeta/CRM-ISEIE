<?php
// Datos de prueba del Moodle local para el plugin local_crm (#679). Solo local.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->libdir . '/externallib.php');
global $DB;
\core\session\manager::set_user(get_admin());

set_config('enablewebservices', 1);
set_config('webserviceprotocols', 'rest');
set_config('curlsecurityblockedhosts', '');
set_config('curlsecurityallowedport', '');

function usuario($username, $nombre, $apellido, $email) {
    global $DB, $CFG;
    if ($u = $DB->get_record('user', ['username' => $username])) return $u;
    $id = user_create_user(['username' => $username, 'password' => 'Local-679-pass!', 'firstname' => $nombre,
        'lastname' => $apellido, 'email' => $email, 'auth' => 'manual', 'confirmed' => 1, 'mnethostid' => $CFG->mnet_localhost_id]);
    return $DB->get_record('user', ['id' => $id]);
}
$tutora = usuario('tutora679', 'Laura', 'Tutora', 'tutora679@example.com');
$alumno = usuario('alumno679', 'Pedro', 'Alumno', 'alumno679@example.com');
$coord  = usuario('coord679', 'Carmen', 'Coordinacion', 'coord679@example.com');

$curso = $DB->get_record('course', ['shortname' => 'CRM679']);
if (!$curso) $curso = create_course((object) ['fullname' => 'Curso de prueba CRM', 'shortname' => 'CRM679', 'category' => 1]);
$manual = enrol_get_plugin('manual');
$instancia = $DB->get_record('enrol', ['courseid' => $curso->id, 'enrol' => 'manual'], '*', MUST_EXIST);
$roles = $DB->get_records_menu('role', null, '', 'shortname, id');
$manual->enrol_user($instancia, $tutora->id, $roles['editingteacher']);
$manual->enrol_user($instancia, $alumno->id, $roles['student']);
role_assign($roles['manager'], $coord->id, context_system::instance()->id);

$servicio = $DB->get_record('external_services', ['shortname' => 'local_crm'], '*', MUST_EXIST);
if (!$DB->record_exists('external_services_users', ['externalserviceid' => $servicio->id, 'userid' => get_admin()->id])) {
    $DB->insert_record('external_services_users', ['externalserviceid' => $servicio->id, 'userid' => get_admin()->id, 'timecreated' => time()]);
}
$token = $DB->get_record('external_tokens', ['externalserviceid' => $servicio->id, 'userid' => get_admin()->id]);
$token = $token ? $token->token : \core_external\util::generate_token(EXTERNAL_TOKEN_PERMANENT, $servicio, get_admin()->id, context_system::instance(), 0, '');
echo json_encode(['tutora' => (int) $tutora->id, 'alumno' => (int) $alumno->id, 'coord' => (int) $coord->id, 'curso' => (int) $curso->id, 'token' => $token]), "\n";
