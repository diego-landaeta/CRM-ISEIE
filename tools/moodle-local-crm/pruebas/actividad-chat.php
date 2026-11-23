<?php
// Solo local: la actividad Chat del curso CRM679, la de «Entrar al chat» que el plugin
// convierte en el chat directo con la tutora. En Moodle 5.x el Chat ya no viene con Moodle:
// antes hay que instalar el adicional mod_chat (moodlehq/moodle-mod_chat), como en los campus.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
global $DB;
\core\session\manager::set_user(get_admin());
if (!$DB->get_record('modules', ['name' => 'chat'])) {
    fwrite(STDERR, "Falta el adicional mod_chat en este Moodle.\n");
    exit(1);
}
// Moodle instala el Chat DESACTIVADO (Administración › Extensiones › Actividades): sin
// activarlo, la actividad da «Invalid course module ID». En los campus ya está activado.
\core\plugininfo\mod::enable_plugin('chat', 1);
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
if (!$chat = $DB->get_record('chat', ['course' => $curso->id, 'name' => 'Chat con tu tutora'])) {
    $gen = new testing_data_generator();
    $chat = $gen->create_module('chat', ['course' => $curso->id, 'name' => 'Chat con tu tutora']);
}
$cm = get_coursemodule_from_instance('chat', $chat->id, $curso->id, false, MUST_EXIST);
echo json_encode(['chat' => (int) $chat->id, 'cm' => (int) $cm->id, 'curso' => (int) $curso->id]), "\n";
