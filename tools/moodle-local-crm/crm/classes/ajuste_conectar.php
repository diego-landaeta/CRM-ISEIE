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

namespace local_crm;

defined('MOODLE_INTERNAL') || die();

/**
 * Lo que aparece justo después de instalar: «conecta el campus» y un botón.
 *
 * Moodle enseña «Nuevos ajustes» al instalar, pero solo con los ajustes sin valor. Este
 * no guarda nada y cuenta como «sin configurar» mientras el campus no esté conectado:
 * así la página aparece y lleva a «Conectar con el CRM», en vez de pedir que se
 * tecleen dirección y clave a mano (el mismo arreglo que local_certifex).
 */
class ajuste_conectar extends \admin_setting {

    public function __construct() {
        parent::__construct('local_crm/conexion', get_string('conectar_titulo', 'local_crm'), '', '');
    }

    /** Null = «sin configurar»: hace aparecer la página de nuevos ajustes. */
    public function get_setting() {
        return conexion::conectado() ? (string) get_config('local_crm', 'campus') : null;
    }

    /** No se escribe nada desde aquí: lo escribe «Conectar con el CRM». */
    public function write_setting($data) {
        return '';
    }

    public function output_html($data, $query = '') {
        $conectado = conexion::conectado();
        $cuerpo = $conectado
            ? \html_writer::div(get_string('conectado_con', 'local_crm', s((string) get_config('local_crm', 'campus'))), 'alert alert-success')
            : \html_writer::div(
                \html_writer::tag('strong', get_string('conectar_falta', 'local_crm')) . \html_writer::empty_tag('br') .
                get_string('conectar_como', 'local_crm'), 'alert alert-info');
        $cuerpo .= \html_writer::link(new \moodle_url('/local/crm/conectar.php'),
            get_string($conectado ? 'conectar_rehacer' : 'conectar_abrir', 'local_crm'),
            ['class' => $conectado ? 'btn btn-secondary' : 'btn btn-primary btn-lg']);
        return format_admin_setting($this, '', $cuerpo, '', true, '', null, $query);
    }
}
