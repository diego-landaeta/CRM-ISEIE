<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * local_crm: la mensajería del campus, unida al CRM (CRM #679).
 *
 * @package    local_crm
 * @copyright  2026 ISEIE Innovation School
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

// Ajustes del plugin: nada que teclear. Solo dice si el campus está conectado y lleva
// a «Conectar con el CRM», donde se pega el código que da el CRM.

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_crm', get_string('pluginname', 'local_crm'));
    $ADMIN->add('localplugins', $settings);
    $settings->add(new \local_crm\ajuste_conectar());
    // De serie, encendido (1.10.6): solo instala versiones firmadas por el CRM, y nada si el
    // sitio tiene $CFG->disableupdateautodeploy. Se apaga aquí, campus a campus.
    $settings->add(new admin_setting_configcheckbox('local_crm/autoactualizar', get_string('autoactualizar', 'local_crm'),
        get_string('autoactualizar_desc', 'local_crm'), 1));
    // De serie, apagado (revisión de la #689): cambia lo que ven los alumnos en el campus.
    $settings->add(new admin_setting_configcheckbox('local_crm/chat_grupo', get_string('chat_grupo', 'local_crm'),
        get_string('chat_grupo_desc', 'local_crm'), 0));
    $settings->add(new admin_setting_configtext('local_crm/excluir_nombre', get_string('excluir_nombre', 'local_crm'),
        get_string('excluir_nombre_desc', 'local_crm'), 'Inspector', PARAM_TEXT));
    $settings->add(new admin_setting_configtextarea('local_crm/crms', get_string('crms', 'local_crm'),
        get_string('crms_desc', 'local_crm'), \local_crm\conexion::CRMS_POR_DEFECTO, PARAM_RAW_TRIMMED, 40, 3));
    $ADMIN->add('localplugins', new admin_externalpage('local_crm_conectar',
        get_string('conectar_titulo', 'local_crm'), new moodle_url('/local/crm/conectar.php'), 'moodle/site:config'));
}
