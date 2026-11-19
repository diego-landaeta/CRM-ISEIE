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
 * El aviso que recibe el CRM por cada mensaje privado del campus.
 *
 * Lleva quién escribe, a quién, el texto y si cada uno es «personal» del campus
 * (tutor, profesor o gestor; nunca el administrador del sitio). Con eso el CRM distingue la duda de
 * un alumno a su tutora, la respuesta de la tutora escrita en el campus y los
 * mensajes entre alumnos (que no le importan).
 *
 * Va firmado: cabecera `X-Crm-Firma: t=<unix>,v1=<hex>`, con
 * v1 = HMAC-SHA256(secreto, "<t>.<cuerpo>"). El CRM rechaza la firma que no
 * cuadre o que tenga más de 5 minutos.
 */
class aviso {
    /** Los arquetipos de rol que cuentan como personal del campus. */
    const ARQUETIPOS_PERSONAL = ['editingteacher', 'teacher', 'manager', 'coursecreator'];

    public static function configurado(): bool {
        return trim((string) get_config('local_crm', 'url')) !== ''
            && trim((string) get_config('local_crm', 'secreto')) !== '';
    }

    /**
     * ¿Es personal del campus (y no alumno)?
     *
     * El administrador del sitio NO (1.10.1, revisión de la #689, punto 2): no es una
     * tutora, y como lo puede todo, dejarlo pasar permitía que el CRM escribiera o
     * calificara como él. Aunque además tenga un rol de profesor o de gestor.
     */
    public static function es_personal(int $userid): bool {
        global $DB;
        if (is_siteadmin($userid)) {
            return false;
        }
        [$sql, $params] = $DB->get_in_or_equal(self::ARQUETIPOS_PERSONAL, SQL_PARAMS_NAMED);
        $params['userid'] = $userid;
        return $DB->record_exists_sql(
            "SELECT 1 FROM {role_assignments} ra JOIN {role} r ON r.id = ra.roleid
              WHERE ra.userid = :userid AND r.archetype $sql", $params);
    }

    /** Lo que el CRM necesita de un usuario. */
    private static function usuario(int $userid): ?array {
        // Todos los campos del nombre: `fullname()` los usa (fonéticos, segundo nombre…) y,
        // con el modo de depuración alto, avisa de los que faltan.
        $nombre = implode(', ', \core_user\fields::for_name()->get_required_fields());
        $u = \core_user::get_user($userid, 'id, email, deleted, ' . $nombre);
        if (!$u || $u->deleted) {
            return null;
        }
        return [
            'id'       => (int) $u->id,
            'nombre'   => fullname($u),
            'email'    => $u->email,
            'personal' => self::es_personal((int) $u->id),
        ];
    }

    /**
     * El aviso de un mensaje, o null si no va al CRM: borrado, de una conversación de
     * grupo que no es un chat del plugin, la de uno consigo mismo, o un privado en el que
     * no hay nadie del personal del campus (entre alumnos).
     *
     * Por aquí pasan el aviso al momento (task\avisar_crm) y el repaso del CRM
     * (external\mensajes_desde): lo que se descarta aquí no sale nunca del campus.
     */
    public static function del_mensaje(int $mensajeid): ?array {
        global $DB, $CFG;
        $m = $DB->get_record('messages', ['id' => $mensajeid]);
        if (!$m) {
            return null;
        }
        $conv = $DB->get_record('message_conversations', ['id' => $m->conversationid], 'id, type');
        if (!$conv) {
            return null;
        }
        if ((int) $conv->type === \core_message\api::MESSAGE_CONVERSATION_TYPE_GROUP) {
            return self::del_mensaje_de_grupo($m);
        }
        if ((int) $conv->type !== \core_message\api::MESSAGE_CONVERSATION_TYPE_INDIVIDUAL) {
            return null;
        }
        $de = self::usuario((int) $m->useridfrom);
        if (!$de) {
            return null;
        }
        $para = [];
        $miembros = $DB->get_fieldset_select('message_conversation_members', 'userid',
            'conversationid = ? AND userid <> ?', [$conv->id, $m->useridfrom]);
        foreach ($miembros as $id) {
            if ($u = self::usuario((int) $id)) {
                $para[] = $u;
            }
        }
        if (!$para) {
            return null;
        }
        // Un privado entre alumnos no es una consulta y no es asunto del CRM: no sale del
        // campus. Antes llegaba entero y el CRM lo descartaba («entre alumnos»), pero el
        // texto ya había viajado (revisión de la #689, 8c). Va solo si quien escribe o
        // alguien que lo recibe es personal del campus (tutora, profesor o gestor).
        $conpersonal = !empty($de['personal'])
            || (bool) array_filter($para, static fn(array $u): bool => !empty($u['personal']));
        if (!$conpersonal) {
            return null;
        }
        return [
            'evento'  => 'mensaje',
            'sitio'   => $CFG->wwwroot,
            'mensaje' => [
                'id'              => (int) $m->id,
                'conversacion_id' => (int) $conv->id,
                // El curso, si la conversación se abrió desde «Entrar al chat» de un curso:
                // el CRM solo pasa la consulta a tutoras de ese curso.
                'curso_id'        => chat_directo::curso_de((int) $conv->id),
                'html'            => self::html($m),
                'fecha'           => (int) $m->timecreated,
            ],
            'de'      => $de,
            'para'    => $para,
        ];
    }

    /**
     * El aviso de un mensaje del chat de grupo del alumno con las tutoras (1.9.0).
     *
     * Además de lo de siempre lleva `grupo`: el alumno de la consulta, el curso y quién
     * está ahora en la conversación (para que el CRM enseñe los participantes). `de.tutora`
     * dice si quien escribe es tutora de ESE curso. Va aunque no haya nadie más dentro (todas
     * las tutoras «No disponible»): lo que escribe el alumno llega al CRM sin excepción.
     */
    private static function del_mensaje_de_grupo(\stdClass $m): ?array {
        global $DB, $CFG;
        $fila = chat_grupo::de_conversacion((int) $m->conversationid);
        if (!$fila) {
            return self::del_mensaje_de_grupo_del_curso($m);
        }
        $de = self::usuario((int) $m->useridfrom);
        $alumno = self::usuario((int) $fila->userid);
        $curso = $DB->get_record('course', ['id' => $fila->courseid], 'id, fullname, shortname');
        if (!$de || !$alumno || !$curso) {
            return null;
        }
        $contexto = \context_course::instance($curso->id);
        $tutoras = chat_directo::tutoras($contexto, false);
        $de['tutora'] = isset($tutoras[$de['id']]);
        $alumno['tutora'] = false;
        $miembros = [];
        $para = [];
        $ids = $DB->get_fieldset_select('message_conversation_members', 'userid', 'conversationid = ?', [$m->conversationid]);
        foreach ($ids as $id) {
            if ($u = self::usuario((int) $id)) {
                $u['tutora'] = isset($tutoras[$u['id']]);
                $miembros[] = ['id' => $u['id'], 'nombre' => $u['nombre'], 'tutora' => $u['tutora'],
                    'alumno' => $u['id'] === $alumno['id']];
                if ($u['id'] !== $de['id']) {
                    $para[] = $u;
                }
            }
        }
        return [
            'evento'  => 'mensaje',
            'sitio'   => $CFG->wwwroot,
            'mensaje' => [
                'id'              => (int) $m->id,
                'conversacion_id' => (int) $m->conversationid,
                'curso_id'        => (int) $curso->id,
                'html'            => self::html($m),
                'fecha'           => (int) $m->timecreated,
                'tipo'            => 'grupo',
            ],
            'de'      => $de,
            'para'    => $para,
            'grupo'   => [
                'alumno'   => $alumno,
                'curso'    => ['id' => (int) $curso->id,
                    'nombre' => format_string($curso->fullname, true, ['context' => $contexto, 'escape' => false])],
                'miembros' => $miembros,
            ],
        ];
    }

    /**
     * El aviso de un mensaje de otra conversación de grupo de un curso (la de un grupo del
     * curso, p. ej.) en la que hay alguna tutora de ese curso. `grupo.tipo` = 'curso': ahí
     * escriben varios alumnos, así que `grupo.alumno` es quien escribe si es alumno, y null si
     * escribe una tutora (el CRM lo cuenta como respuesta a la consulta de esa conversación).
     * En `miembros` solo van las tutoras y quien escribe: el resto del grupo no le hace falta.
     */
    private static function del_mensaje_de_grupo_del_curso(\stdClass $m): ?array {
        global $DB, $CFG;
        $convid = (int) $m->conversationid;
        $cursoid = chat_grupo::curso_de_conversacion($convid);
        if (!$cursoid) {
            return null;
        }
        $dentro = chat_grupo::tutoras_dentro($convid, $cursoid);
        $curso = $DB->get_record('course', ['id' => $cursoid], 'id, fullname');
        $de = self::usuario((int) $m->useridfrom);
        if (!$dentro || !$curso || !$de) {
            return null;
        }
        $contexto = \context_course::instance($curso->id);
        $de['tutora'] = in_array($de['id'], $dentro, true) || chat_directo::es_tutora($contexto, $de['id']);
        $miembros = [];
        foreach (array_unique(array_merge($dentro, [$de['id']])) as $id) {
            if ($u = self::usuario((int) $id)) {
                $esde = $u['id'] === $de['id'];
                $miembros[] = ['id' => $u['id'], 'nombre' => $u['nombre'],
                    'tutora' => $esde ? $de['tutora'] : in_array($u['id'], $dentro, true),
                    // Quien escribe, si no es tutora de ese curso, es un alumno del grupo.
                    'alumno' => $esde && !$de['tutora']];
            }
        }
        $nombre = (string) $DB->get_field('message_conversations', 'name', ['id' => $convid]);
        return [
            'evento'  => 'mensaje',
            'sitio'   => $CFG->wwwroot,
            'mensaje' => [
                'id'              => (int) $m->id,
                'conversacion_id' => $convid,
                'curso_id'        => (int) $curso->id,
                'html'            => self::html($m),
                'fecha'           => (int) $m->timecreated,
                'tipo'            => 'grupo_curso',
            ],
            'de'      => $de,
            'para'    => [],
            'grupo'   => [
                'tipo'     => 'curso',
                'nombre'   => format_string($nombre, true, ['context' => $contexto, 'escape' => false]),
                // Responde solo una profesora de ESE curso; ser «personal» del campus no basta.
                'alumno'   => $de['tutora'] ? null : $de,
                'curso'    => ['id' => (int) $curso->id,
                    'nombre' => format_string($curso->fullname, true, ['context' => $contexto, 'escape' => false])],
                'miembros' => $miembros,
            ],
        ];
    }

    /** El texto del mensaje, en HTML. */
    private static function html(\stdClass $m): string {
        return trim((string) $m->fullmessagehtml) !== ''
            ? (string) $m->fullmessagehtml
            : format_text($m->fullmessage, $m->fullmessageformat, ['context' => \context_system::instance()]);
    }

    /** La firma del cuerpo, tal y como la comprueba el CRM. */
    public static function firma(string $cuerpo, string $secreto, int $t): string {
        return 't=' . $t . ',v1=' . hash_hmac('sha256', $t . '.' . $cuerpo, $secreto);
    }

    /**
     * Lo manda al CRM. Si el CRM no contesta o falla (5xx, 408, 429), excepción: la tarea se
     * reintenta. Si lo rechaza (otro 4xx: clave cambiada, campus desconectado, aviso que no
     * entiende), reintentar no lo arregla: se apunta y se descarta.
     */
    public static function enviar(array $aviso): void {
        global $CFG;
        require_once($CFG->libdir . '/filelib.php');
        $url = trim((string) get_config('local_crm', 'url'));
        $secreto = trim((string) get_config('local_crm', 'secreto'));
        $cuerpo = json_encode($aviso, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $curl = new \curl();
        $curl->setHeader([
            'Content-Type: application/json',
            'X-Crm-Firma: ' . self::firma($cuerpo, $secreto, time()),
        ]);
        $respuesta = $curl->post($url, $cuerpo, ['CURLOPT_TIMEOUT' => 15, 'CURLOPT_CONNECTTIMEOUT' => 5]);
        $codigo = (int) ($curl->get_info()['http_code'] ?? 0);
        if (!$curl->get_errno() && $codigo >= 400 && $codigo < 500 && !in_array($codigo, [408, 429], true)) {
            if (function_exists('mtrace')) {
                mtrace('local_crm: el CRM ha rechazado el aviso (HTTP ' . $codigo . '); no se reintenta.');
            }
            return;
        }
        if ($curl->get_errno() || $codigo < 200 || $codigo >= 300) {
            $detalle = $curl->get_errno() ? $curl->error : ('HTTP ' . $codigo . ' ' . substr((string) $respuesta, 0, 200));
            throw new \moodle_exception('errorenvio', 'local_crm', '', $detalle);
        }
    }
}
