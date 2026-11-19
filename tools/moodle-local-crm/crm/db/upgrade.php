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
 * Al actualizar el plugin en un campus ya conectado, el usuario del servicio recibe los
 * permisos nuevos (p. ej. ver el curso completo en la 1.5.0) sin tener que reconectar.
 *
 * @package    local_crm
 * @copyright  2026 ISEIE Innovation School
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Pasos de actualización de local_crm.
 *
 * @param int $oldversion La versión instalada antes.
 * @return bool
 */
function xmldb_local_crm_upgrade($oldversion) {
    global $DB;
    if ($oldversion < 2026110511) {
        // Solo si ya existe el usuario del servicio (el campus se conectó con la 1.4.0 o después).
        if ($DB->record_exists('user', ['username' => \local_crm\conexion::USUARIO_SERVICIO, 'deleted' => 0])) {
            \local_crm\conexion::usuario_servicio();
        }
        upgrade_plugin_savepoint(true, 2026110511, 'local', 'crm');
    }
    if ($oldversion < 2026110512) {
        $dbman = $DB->get_manager();
        $tabla = new xmldb_table('local_crm_chat');
        if (!$dbman->table_exists($tabla)) {
            $tabla->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $tabla->add_field('conversationid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $tabla->add_field('courseid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $tabla->add_field('alumnoid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $tabla->add_field('tutoraid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $tabla->add_field('timemodified', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $tabla->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $tabla->add_index('conversationid', XMLDB_INDEX_UNIQUE, ['conversationid']);
            $tabla->add_index('courseid', XMLDB_INDEX_NOTUNIQUE, ['courseid']);
            $dbman->create_table($tabla);
        }
        upgrade_plugin_savepoint(true, 2026110512, 'local', 'crm');
    }
    if ($oldversion < 2026110600) {
        // 1.9.0: el chat de grupo del alumno con las tutoras de su curso (opción B de la #285).
        $dbman = $DB->get_manager();
        $tabla = new xmldb_table('local_crm_conversaciones');
        if (!$dbman->table_exists($tabla)) {
            $tabla->add_field('id', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, XMLDB_SEQUENCE, null);
            $tabla->add_field('courseid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $tabla->add_field('userid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $tabla->add_field('conversationid', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, null);
            $tabla->add_field('timecreated', XMLDB_TYPE_INTEGER, '10', null, XMLDB_NOTNULL, null, '0');
            $tabla->add_key('primary', XMLDB_KEY_PRIMARY, ['id']);
            $tabla->add_index('courseid-userid', XMLDB_INDEX_UNIQUE, ['courseid', 'userid']);
            $tabla->add_index('conversationid', XMLDB_INDEX_UNIQUE, ['conversationid']);
            $tabla->add_index('userid', XMLDB_INDEX_NOTUNIQUE, ['userid']);
            $dbman->create_table($tabla);
        }
        // El ajuste «Chat de grupo con las tutoras del curso» sustituye al del chat directo: si
        // alguien lo había apagado, sigue apagado. Las conversaciones privadas de antes siguen
        // (y siguen llegando al CRM); solo cambia a dónde lleva «Entrar al chat».
        $antes = get_config('local_crm', 'chat_directo');
        if (get_config('local_crm', 'chat_grupo') === false) {
            set_config('chat_grupo', $antes === false ? 1 : (int) (bool) $antes, 'local_crm');
        }
        unset_config('chat_directo', 'local_crm');
        upgrade_plugin_savepoint(true, 2026110600, 'local', 'crm');
    }
    if ($oldversion < 2026111000) {
        // 1.10.0 (revisión de la #689): lo que cambia el campus sin que nadie lo vea viene
        // APAGADO. La actualización automática (instala código solo) y el chat de grupo
        // (cambia «Entrar al chat» para los alumnos) se apagan también en los campus que ya
        // tenían el plugin: allí el ajuste se guardó encendido con el valor de serie de antes.
        // Se vuelven a encender a mano, campus a campus, en los ajustes del plugin.
        set_config('autoactualizar', 0, 'local_crm');
        set_config('chat_grupo', 0, 'local_crm');
        upgrade_plugin_savepoint(true, 2026111000, 'local', 'crm');
    }
    if ($oldversion < 2026111500) {
        // 1.10.6: la actualización automática vuelve a venir ENCENDIDA. Es segura sin que nadie
        // la mire: solo instala lo que trae la firma del CRM, nada si el sitio tiene
        // $CFG->disableupdateautodeploy, y el campus la puede apagar en los ajustes.
        // Se enciende también en los campus que ya tenían el plugin, donde el paso de la
        // 1.10.0 (justo encima) la dejó apagada. Este paso va DESPUÉS de aquel, así que un
        // campus que salte de una versión anterior a la 1.10.0 a esta también acaba encendido.
        // Solo se respeta a quien la apagó a mano: el último cambio del ajuste guardado desde
        // la página de ajustes (config_log; set_config, como el de la 1.10.0, no deja rastro)
        // fue de encendido a apagado.
        $ultimo = $DB->get_records('config_log', ['plugin' => 'local_crm', 'name' => 'autoactualizar'],
            'timemodified DESC, id DESC', 'id, value, oldvalue', 0, 1);
        $ultimo = reset($ultimo);
        $apagadaamano = $ultimo && (string) $ultimo->value === '0' && (string) $ultimo->oldvalue === '1';
        if (!$apagadaamano) {
            set_config('autoactualizar', 1, 'local_crm');
        }
        upgrade_plugin_savepoint(true, 2026111500, 'local', 'crm');
    }
    if ($oldversion < 2026111501) {
        // 1.10.7 (#681): el rol del servicio puede ver el avance de los alumnos
        // (report/completion:view), para el % hecho de «Mi campus». Solo si el campus ya
        // está conectado; si no, se le da al conectarlo. Va DESPUÉS de la 1.10.6: con un
        // número menor, los campus que ya tenían la 1.10.6 se lo saltarían.
        if ($DB->record_exists('user', ['username' => \local_crm\conexion::USUARIO_SERVICIO, 'deleted' => 0])) {
            \local_crm\conexion::usuario_servicio();
        }
        upgrade_plugin_savepoint(true, 2026111501, 'local', 'crm');
    }
    return true;
}
