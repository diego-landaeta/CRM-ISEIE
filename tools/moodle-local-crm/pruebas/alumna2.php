<?php
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->dirroot . '/user/lib.php');
global $DB;
\core\session\manager::set_user(get_admin());
$u = $DB->get_record('user', ['username' => 'alumna679b']);
if (!$u) {
    $id = user_create_user(['username' => 'alumna679b', 'password' => 'Local-679-pass!', 'firstname' => 'María', 'lastname' => 'Gómez Ruiz',
        'email' => 'alumna679b@example.com', 'auth' => 'manual', 'confirmed' => 1, 'mnethostid' => $CFG->mnet_localhost_id]);
    $u = $DB->get_record('user', ['id' => $id]);
}
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$roles = $DB->get_records_menu('role', null, '', 'shortname, id');
$instancia = $DB->get_record('enrol', ['courseid' => $curso->id, 'enrol' => 'manual'], '*', MUST_EXIST);
enrol_get_plugin('manual')->enrol_user($instancia, $u->id, $roles['student']);
$tutora = $DB->get_record('user', ['username' => 'tutora679'], '*', MUST_EXIST);
\core\session\manager::set_user($u);
$conv = \core_message\api::get_conversation_between_users([$u->id, $tutora->id]);
if (!$conv) $conv = \core_message\api::create_conversation(\core_message\api::MESSAGE_CONVERSATION_TYPE_INDIVIDUAL, [$u->id, $tutora->id])->id;
\core_message\api::send_message_to_conversation($u->id, $conv, '<p>Buenas tardes, ¿la fecha de entrega del caso práctico se puede ampliar una semana? Estoy con exámenes.</p>', FORMAT_HTML);
echo "ok {$u->id}\n";
