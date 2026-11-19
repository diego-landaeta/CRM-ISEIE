<?php
// Manda un mensaje privado de un usuario a otro, como si lo escribiera en el campus.
// Uso: php mensaje-cli.php <de> <para> <texto>
// <de> y <para>: el id del usuario o su nombre de usuario (alumno679, tutora679…).
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
[$_, $de, $para, $texto] = $argv;

/** El id del usuario, tanto si viene el número como el nombre de usuario. */
function id_de(string $x): int {
    global $DB;
    return ctype_digit($x) ? (int) $x : (int) $DB->get_field('user', 'id', ['username' => $x], MUST_EXIST);
}

$de = id_de($de);
$para = id_de($para);
\core\session\manager::set_user(core_user::get_user($de, '*', MUST_EXIST));
// get_conversation_between_users devuelve el id (o false); create_conversation, el objeto.
// Antes se hacía (int) del objeto, que da 1: el primer mensaje entre dos usuarios iba a la
// conversación 1 («cannot send a message to conversation 1»).
$conv = \core_message\api::get_conversation_between_users([$de, $para]);
if (!$conv) {
    $conv = \core_message\api::create_conversation(\core_message\api::MESSAGE_CONVERSATION_TYPE_INDIVIDUAL, [$de, $para])->id;
}
$m = \core_message\api::send_message_to_conversation($de, (int) $conv, $texto, FORMAT_PLAIN);
echo "mensaje {$m->id} en conversación {$conv}\n";
