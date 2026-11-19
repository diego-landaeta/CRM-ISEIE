<?php
// Tras desinstalar local_crm: borra también su usuario y su rol, para probar una instalación desde cero.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
global $DB;
if ($u = $DB->get_record('user', ['username' => 'crm_servicio', 'deleted' => 0])) {
    delete_user($u);
}
if ($r = $DB->get_record('role', ['shortname' => 'local_crm_servicio'])) {
    delete_role($r->id);
}
echo 'usuario: ', $DB->count_records('user', ['username' => 'crm_servicio', 'deleted' => 0]),
    ' · rol: ', $DB->count_records('role', ['shortname' => 'local_crm_servicio']), "\n";
