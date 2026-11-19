<?php
// Conecta el campus local con el CRM como lo haría la página «Conectar con el CRM».
// Uso: php conectar-cli.php <codigo> [--cambiar]
// Con un código de OTRO CRM no conecta (1.10.4, #689) salvo con --cambiar, que confirma el cambio.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
$admin = get_admin();
\core\session\manager::set_user($admin);
$confirmado = in_array('--cambiar', $argv, true) ? (string) \local_crm\actualizar::base_api() : null;
$r = \local_crm\conexion::conectar($argv[1], context_system::instance(), (int) $admin->id, $confirmado);
echo json_encode($r, JSON_UNESCAPED_UNICODE), "\n";
$t = $DB->get_records_sql("SELECT t.userid, u.username FROM {external_tokens} t JOIN {external_services} s ON s.id = t.externalserviceid
    JOIN {user} u ON u.id = t.userid WHERE s.shortname = 'local_crm'");
echo 'tokens: ', json_encode(array_values($t)), "\n";
