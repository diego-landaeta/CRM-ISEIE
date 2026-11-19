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
 * «Conectar con el CRM»: pegar el código y listo. Con los componentes del propio
 * Moodle (tarjetas de Bootstrap), para que se vea como el resto del panel.
 *
 * @package    local_crm
 * @copyright  2026 ISEIE Innovation School
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

require_login();
$contexto = context_system::instance();
require_capability('moodle/site:config', $contexto);

$PAGE->set_context($contexto);
$PAGE->set_url(new moodle_url('/local/crm/conectar.php'));
$PAGE->set_pagelayout('admin');
$PAGE->set_title(get_string('conectar_titulo', 'local_crm'));
$PAGE->set_heading(get_string('conectar_titulo', 'local_crm'));

$accion = optional_param('accion', '', PARAM_ALPHA);
$error = null;
// Un código de OTRO CRM: se para y se pregunta antes de cambiar (#689). ['actual', 'nuevo', 'codigo'].
$cambio = null;

if ($accion !== '') {
    // confirm_sesskey() no lanza: devuelve false. Con la sesión caducada se dice, en vez de
    // repintar el formulario vacío sin explicación (lo que le pasó a local_certifex).
    if (!confirm_sesskey()) {
        $error = get_string('conectar_sesskey', 'local_crm');
    } else if ($accion === 'conectar') {
        $pegado = required_param('codigo', PARAM_RAW_TRIMMED);
        // La confirmación lleva el CRM de ahora tal como se vio en el aviso: si entretanto ha
        // cambiado, conexion::conectar() no la da por buena y el aviso sale otra vez.
        $confirmado = optional_param('confirmar_cambio', 0, PARAM_BOOL)
            ? optional_param('crm_actual', '', PARAM_RAW_TRIMMED) : null;
        $r = \local_crm\conexion::conectar($pegado, $contexto, (int) $USER->id, $confirmado);
        if ($r['ok']) {
            redirect($PAGE->url, get_string('conectar_ok', 'local_crm', s($r['campus'])), null, \core\output\notification::NOTIFY_SUCCESS);
        }
        if (!empty($r['cambio'])) {
            $cambio = $r['cambio'] + ['codigo' => $pegado];
        } else {
            $error = get_string('conectar_error', 'local_crm', s($r['error']));
        }
    } else if ($accion === 'actualizar') {
        // Por el cron, no aquí: instalar código desde la página que se está sirviendo no es seguro.
        \core\task\manager::queue_adhoc_task(new \local_crm\task\buscar_actualizacion(), true);
        redirect($PAGE->url, get_string('act_en_cola', 'local_crm'), null, \core\output\notification::NOTIFY_INFO);
    } else if ($accion === 'desconectar') {
        \local_crm\conexion::desconectar();
        redirect($PAGE->url, get_string('desconectar_ok', 'local_crm'), null, \core\output\notification::NOTIFY_INFO);
    }
}

/** El formulario del código (vacío y con el foco donde hace falta). */
$formulario = function (string $boton) {
    global $PAGE;
    $f = html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
    $f .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'accion', 'value' => 'conectar']);
    $f .= html_writer::tag('label', get_string('conectar_codigo', 'local_crm'), ['for' => 'local-crm-codigo', 'class' => 'form-label fw-semibold']);
    $f .= html_writer::tag('textarea', '', [
        'id' => 'local-crm-codigo', 'name' => 'codigo', 'rows' => 3, 'required' => 'required',
        'class' => 'form-control font-monospace mb-3', 'placeholder' => 'crm1.…', 'autocomplete' => 'off', 'spellcheck' => 'false',
    ]);
    $f .= html_writer::tag('button', $boton, ['type' => 'submit', 'class' => 'btn btn-primary']);
    return html_writer::tag('form', $f, ['method' => 'post', 'action' => $PAGE->url->out(false)]);
};

echo $OUTPUT->header();
if ($error) {
    echo $OUTPUT->notification($error, \core\output\notification::NOTIFY_ERROR);
}

if ($cambio) {
    // El código es de otro CRM. El plugin habla con UN solo CRM: si se cambia, el de ahora deja
    // de recibir los mensajes. Se dice cuál es cuál y se pide una confirmación expresa (#689).
    $actual = \local_crm\conexion::describir_crm($cambio['actual']);
    $nuevo = \local_crm\conexion::describir_crm($cambio['nuevo']);
    $filas = html_writer::tag('dt', get_string('cambio_ahora', 'local_crm'), ['class' => 'col-sm-4 fw-normal text-muted']) .
        html_writer::tag('dd', html_writer::tag('strong', s($actual)), ['class' => 'col-sm-8 mb-2']) .
        html_writer::tag('dt', get_string('cambio_pasa_a', 'local_crm'), ['class' => 'col-sm-4 fw-normal text-muted']) .
        html_writer::tag('dd', html_writer::tag('strong', s($nuevo)), ['class' => 'col-sm-8 mb-2']);
    $f = html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
    $f .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'accion', 'value' => 'conectar']);
    $f .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'codigo', 'value' => $cambio['codigo']]);
    $f .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'crm_actual', 'value' => $cambio['actual']]);
    $f .= html_writer::div(
        html_writer::empty_tag('input', ['type' => 'checkbox', 'class' => 'form-check-input', 'id' => 'local-crm-confirmar',
            'name' => 'confirmar_cambio', 'value' => 1, 'required' => 'required']) .
        html_writer::tag('label', get_string('cambio_entiendo', 'local_crm', s($actual)), ['class' => 'form-check-label', 'for' => 'local-crm-confirmar']),
        'form-check mb-3');
    $f .= html_writer::div(
        html_writer::tag('button', get_string('cambio_boton', 'local_crm', s($nuevo)), ['type' => 'submit', 'class' => 'btn btn-danger']) .
        html_writer::link($PAGE->url, get_string('cambio_cancelar', 'local_crm'), ['class' => 'btn btn-outline-secondary']),
        'd-flex flex-wrap gap-2');
    echo html_writer::div(
        html_writer::div(
            html_writer::tag('h3', get_string('cambio_titulo', 'local_crm'), ['class' => 'h5 card-title mb-3']) .
            html_writer::tag('dl', $filas, ['class' => 'row mb-2']) .
            html_writer::tag('p', get_string('cambio_que_pasa', 'local_crm', (object) ['actual' => s($actual), 'nuevo' => s($nuevo)]),
                ['class' => 'card-text mb-3']) .
            html_writer::tag('form', $f, ['method' => 'post', 'action' => $PAGE->url->out(false)]),
            'card-body p-4'),
        'card border-warning shadow-sm', ['style' => 'max-width: 46rem']);
    echo $OUTPUT->footer();
    exit;
}

$conectado = \local_crm\conexion::conectado();
echo html_writer::start_div('', ['style' => 'max-width: 46rem']);

if (!$conectado) {
    // Sin conectar: tres pasos y el código.
    $pasos = html_writer::tag('ol', implode('', array_map(fn($k) => html_writer::tag('li', get_string($k, 'local_crm'), ['class' => 'mb-1']),
        ['paso_1', 'paso_2', 'paso_3'])), ['class' => 'ps-3 mb-4 text-muted']);
    echo html_writer::div(
        html_writer::div(
            html_writer::tag('h3', get_string('conectar_falta', 'local_crm'), ['class' => 'h5 card-title mb-2']) .
            html_writer::tag('p', get_string('conectar_intro', 'local_crm'), ['class' => 'card-text text-muted mb-3']) .
            $pasos . $formulario(get_string('conectar_boton', 'local_crm')),
            'card-body p-4'),
        'card shadow-sm');
} else {
    // Conectado: a qué CRM, desde cuándo y qué hace; cambiar el código, plegado; desconectar, aparte.
    $desde = (int) get_config('local_crm', 'conectado');
    $filas = [
        get_string('dato_campus', 'local_crm') => s((string) get_config('local_crm', 'campus')),
        get_string('dato_desde', 'local_crm') => $desde ? userdate($desde, get_string('strftimedatetimeshort', 'langconfig')) : '—',
        // Con la ruta: solo el dominio no distingue producción (360crm.tech/crm) de pruebas (/testeo).
        get_string('dato_crm', 'local_crm') => s(\local_crm\conexion::describir_crm(
            (string) (\local_crm\actualizar::base_api() ?? get_config('local_crm', 'url')))),
    ];
    $dl = '';
    foreach ($filas as $k => $v) {
        $dl .= html_writer::tag('dt', $k, ['class' => 'col-sm-4 fw-normal text-muted']) . html_writer::tag('dd', $v, ['class' => 'col-sm-8 mb-2']);
    }
    $estado = html_writer::span(
        html_writer::span('', 'd-inline-block rounded-circle bg-success me-2', ['style' => 'width:.5rem;height:.5rem']) .
        get_string('estado_conectado', 'local_crm'), 'badge rounded-pill bg-success-subtle text-success-emphasis border border-success-subtle px-3 py-2');
    echo html_writer::div(
        html_writer::div(
            html_writer::div(html_writer::tag('h3', get_string('conectado_titulo', 'local_crm'), ['class' => 'h5 card-title mb-0']) . $estado,
                'd-flex flex-wrap align-items-center justify-content-between gap-2 mb-3') .
            html_writer::tag('p', get_string('conectado_que', 'local_crm'), ['class' => 'card-text text-muted mb-3']) .
            html_writer::tag('dl', $dl, ['class' => 'row mb-0']),
            'card-body p-4'),
        'card shadow-sm mb-3');

    // Actualizaciones: la versión, lo último que pasó y un botón. Nada más.
    {
        $info = \core_plugin_manager::instance()->get_plugin_info('local_crm');
        $ultima = \local_crm\actualizar::ultima();
        $texto = \local_crm\actualizar::activa()
            ? get_string('act_sola', 'local_crm') : get_string('act_apagada', 'local_crm');
        $linea = '';
        if ($ultima) {
            $clase = ['actualizado' => 'text-success', 'error' => 'text-danger', 'disponible' => 'text-warning'][$ultima['estado']] ?? 'text-muted';
            $linea = html_writer::tag('p', s($ultima['mensaje']) . ' · ' . userdate((int) $ultima['at'], get_string('strftimedatetimeshort', 'langconfig')),
                ['class' => 'small mb-3 ' . $clase]);
        }
        $b = html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
        $b .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'accion', 'value' => 'actualizar']);
        $b .= html_writer::tag('button', get_string('act_boton', 'local_crm'), ['type' => 'submit', 'class' => 'btn btn-outline-secondary btn-sm']);
        echo html_writer::div(
            html_writer::div(
                html_writer::tag('h3', get_string('act_titulo', 'local_crm'), ['class' => 'h6 mb-1']) .
                html_writer::tag('p', get_string('act_version', 'local_crm', s($info->release ?? $info->versiondisk)) . ' · ' . $texto,
                    ['class' => 'text-muted small mb-2']) .
                $linea .
                html_writer::tag('form', $b, ['method' => 'post', 'action' => $PAGE->url->out(false)]),
                'card-body p-3'),
            'card mb-3');
    }

    // Cambiar el código: solo si hace falta (otro CRM, conexión perdida).
    echo html_writer::start_tag('details', ['class' => 'card mb-3']);
    echo html_writer::tag('summary', get_string('conectar_rehacer', 'local_crm'), ['class' => 'card-body py-3 fw-semibold', 'style' => 'cursor:pointer']);
    echo html_writer::div(html_writer::tag('p', get_string('conectar_otra_vez', 'local_crm'), ['class' => 'text-muted']) .
        $formulario(get_string('conectar_boton', 'local_crm')), 'card-body pt-0');
    echo html_writer::end_tag('details');

    // Desconectar, aparte y con su explicación.
    $d = html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'sesskey', 'value' => sesskey()]);
    $d .= html_writer::empty_tag('input', ['type' => 'hidden', 'name' => 'accion', 'value' => 'desconectar']);
    $d .= html_writer::tag('button', get_string('desconectar_boton', 'local_crm'), ['type' => 'submit', 'class' => 'btn btn-outline-danger btn-sm']);
    echo html_writer::div(
        html_writer::tag('p', get_string('desconectar_que', 'local_crm'), ['class' => 'text-muted small mb-2']) .
        html_writer::tag('form', $d, ['method' => 'post', 'action' => $PAGE->url->out(false)]),
        'border-top pt-3');
}

echo html_writer::end_div();
echo $OUTPUT->footer();
