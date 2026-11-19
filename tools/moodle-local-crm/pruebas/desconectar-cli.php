<?php
// Desconecta el campus del CRM, como el botón «Desconectar» de la página del plugin.
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
\local_crm\conexion::desconectar();
echo 'conectado: ', \local_crm\conexion::conectado() ? 'sí' : 'no', "\n";
