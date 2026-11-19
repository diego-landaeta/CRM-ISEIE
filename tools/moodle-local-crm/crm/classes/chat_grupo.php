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
 * El chat de grupo del alumno con las tutoras de su curso (1.9.0, opción B de la #285).
 *
 * «Entrar al chat» de la actividad Chat abre UNA conversación de grupo por alumno y curso:
 * el alumno y las tutoras disponibles de ese curso. Todas ven lo mismo y cualquiera
 * responde, desde Moodle o desde el CRM.
 *
 * Es una conversación de la mensajería de Moodle (tipo grupo) con el componente
 * `local_crm`, el tipo `consulta`, el alumno como `itemid` y el contexto del curso. NO es
 * un grupo del curso: no toca los grupos separados ni la calificación.
 *
 * Quién está dentro: el alumno (siempre) y las tutoras del curso con el mismo criterio que
 * el chat directo (chat_directo::tutoras): profesora con o sin edición en ESE curso, con
 * la matrícula activa, sin las excluidas por nombre («Inspector…») y sin las «No
 * disponible» del CRM. Se repasa al abrir el chat y cuando el CRM manda la disponibilidad
 * (al cambiar y en el repaso de cada 15 minutos): la que deja de estar sale y, al volver,
 * entra otra vez y ve todo el historial.
 */
class chat_grupo {

    /** El componente y el tipo de las conversaciones del plugin en la mensajería. */
    const COMPONENTE = 'local_crm';
    const TIPO = 'consulta';

    /**
     * ¿Está encendido? (ajuste «chat_grupo»). De serie, NO (revisión de la #689): cambia
     * lo que ven los alumnos en «Entrar al chat», así que se enciende a mano, campus a
     * campus. Sin ajuste guardado (false) cuenta como apagado.
     */
    public static function activo(): bool {
        return (bool) get_config('local_crm', 'chat_grupo');
    }

    /** El nombre que ve todo el mundo en la mensajería: «Consultas · <curso> · <alumno>». */
    public static function nombre(\stdClass $curso, \stdClass $alumno): string {
        $contexto = \context_course::instance($curso->id);
        $n = get_string('chat_grupo_nombre', 'local_crm', (object) [
            'curso'  => format_string($curso->fullname, true, ['context' => $contexto, 'escape' => false]),
            'alumno' => fullname($alumno),
        ]);
        return \core_text::substr($n, 0, 255);
    }

    /** La fila del plugin de una conversación de grupo, o null si no es suya. */
    public static function de_conversacion(int $conversationid): ?\stdClass {
        global $DB;
        $fila = $DB->get_record('local_crm_conversaciones', ['conversationid' => $conversationid]);
        return $fila ?: null;
    }

    /**
     * La conversación de grupo del alumno en ese curso, con los miembros al día. Si no
     * existe, la crea (solo si hay al menos una tutora disponible: un grupo con el alumno
     * solo no lo ve nadie en Moodle). Null si no hay conversación ni tutoras.
     */
    public static function conversacion(int $courseid, int $alumnoid, bool $crear = true): ?int {
        global $DB;
        $contexto = \context_course::instance($courseid);
        $tutoras = array_keys(chat_directo::tutoras($contexto));
        $id = self::existente($courseid, $alumnoid, $contexto);
        if ($id) {
            self::sincronizar($id, $alumnoid, $tutoras);
            return $id;
        }
        if (!$crear || !$tutoras) {
            return null;
        }
        // Dos pestañas a la vez no pueden crear dos conversaciones del mismo alumno y curso.
        $cerrojo = \core\lock\lock_config::get_lock_factory('local_crm')->get_lock("conv_{$courseid}_{$alumnoid}", 10);
        if (!$cerrojo) {
            return self::existente($courseid, $alumnoid, $contexto);
        }
        try {
            $id = self::existente($courseid, $alumnoid, $contexto);
            if ($id) {
                self::sincronizar($id, $alumnoid, $tutoras);
                return $id;
            }
            $curso = get_course($courseid);
            $alumno = \core_user::get_user($alumnoid, '*', MUST_EXIST);
            $c = \core_message\api::create_conversation(
                \core_message\api::MESSAGE_CONVERSATION_TYPE_GROUP,
                array_values(array_unique(array_merge([$alumnoid], $tutoras))),
                self::nombre($curso, $alumno),
                \core_message\api::MESSAGE_CONVERSATION_ENABLED,
                self::COMPONENTE, self::TIPO, $alumnoid, $contexto->id);
            $DB->insert_record('local_crm_conversaciones', (object) [
                'courseid' => $courseid, 'userid' => $alumnoid, 'conversationid' => (int) $c->id, 'timecreated' => time(),
            ]);
            return (int) $c->id;
        } finally {
            $cerrojo->release();
        }
    }

    /**
     * La que ya hay (por la tabla del plugin). Si la conversación ya no existe (la borró la
     * API de privacidad o un administrador), la fila sobra y se quita.
     */
    private static function existente(int $courseid, int $alumnoid, \context_course $contexto): ?int {
        global $DB;
        $fila = $DB->get_record('local_crm_conversaciones', ['courseid' => $courseid, 'userid' => $alumnoid]);
        if ($fila) {
            if ($DB->record_exists('message_conversations', ['id' => $fila->conversationid])) {
                return (int) $fila->conversationid;
            }
            $DB->delete_records('local_crm_conversaciones', ['id' => $fila->id]);
        }
        // Por si la fila se perdió y la conversación sigue: se recupera por su área.
        $c = \core_message\api::get_conversation_by_area(self::COMPONENTE, self::TIPO, $alumnoid, $contexto->id);
        if ($c) {
            $DB->insert_record('local_crm_conversaciones', (object) [
                'courseid' => $courseid, 'userid' => $alumnoid, 'conversationid' => (int) $c->id, 'timecreated' => time(),
            ]);
            return (int) $c->id;
        }
        return null;
    }

    /**
     * Deja dentro al alumno y a las tutoras disponibles, y fuera a todos los demás (las «No
     * disponible», quien ya no da clase en el curso). Al alumno no se le saca nunca.
     *
     * @param int[]|null $tutoras las tutoras disponibles del curso (si ya se tienen)
     * @return array ['entran' => int[], 'salen' => int[]]
     */
    public static function sincronizar(int $conversationid, int $alumnoid, ?array $tutoras = null): array {
        global $DB;
        if ($tutoras === null) {
            $fila = self::de_conversacion($conversationid);
            if (!$fila) {
                return ['entran' => [], 'salen' => []];
            }
            $tutoras = array_keys(chat_directo::tutoras(\context_course::instance($fila->courseid)));
        }
        $quiero = array_map('intval', array_unique(array_merge([$alumnoid], $tutoras)));
        $hay = array_map('intval', $DB->get_fieldset_select('message_conversation_members', 'userid',
            'conversationid = ?', [$conversationid]));
        $entran = array_values(array_diff($quiero, $hay));
        $salen = array_values(array_diff($hay, $quiero, [$alumnoid]));
        if ($entran) {
            \core_message\api::add_members_to_conversation($entran, $conversationid);
        }
        if ($salen) {
            \core_message\api::remove_members_from_conversation($salen, $conversationid);
        }
        return ['entran' => $entran, 'salen' => $salen];
    }

    /**
     * El curso de una conversación de grupo que NO es del plugin (#285, Diego: «todos los chats
     * a los que pertenece la tutora»): la de un grupo del curso (core_group) o cualquier otra
     * vinculada al contexto de un curso. Null si no es de grupo o no es de ningún curso.
     */
    public static function curso_de_conversacion(int $conversationid): ?int {
        global $DB;
        $c = $DB->get_record('message_conversations', ['id' => $conversationid], 'id, type, component, itemtype, itemid, contextid');
        if (!$c || (int) $c->type !== \core_message\api::MESSAGE_CONVERSATION_TYPE_GROUP) {
            return null;
        }
        if ($c->component === 'core_group' && $c->itemtype === 'groups' && $c->itemid) {
            $curso = $DB->get_field('groups', 'courseid', ['id' => $c->itemid]);
            if ($curso) {
                return (int) $curso;
            }
        }
        if ($c->contextid) {
            $ctx = \context::instance_by_id((int) $c->contextid, IGNORE_MISSING);
            if ($ctx && ($cc = $ctx->get_course_context(false))) {
                return (int) $cc->instanceid;
            }
        }
        return null;
    }

    /**
     * Las tutoras del curso que están en una conversación (aunque estén «No disponible»):
     * una conversación de grupo del curso entra en el CRM solo si hay alguna dentro.
     *
     * @return int[]
     */
    public static function tutoras_dentro(int $conversationid, int $courseid): array {
        global $DB;
        $contexto = \context_course::instance($courseid, IGNORE_MISSING);
        if (!$contexto) {
            return [];
        }
        $tutoras = chat_directo::tutoras($contexto, false);
        if (!$tutoras) {
            return [];
        }
        $miembros = $DB->get_fieldset_select('message_conversation_members', 'userid', 'conversationid = ?', [$conversationid]);
        return array_values(array_map('intval', array_intersect(array_map('intval', $miembros), array_keys($tutoras))));
    }

    /** Repasa los miembros de todas las conversaciones del plugin (lo lanza la disponibilidad). */
    public static function sincronizar_todas(): array {
        global $DB;
        $total = ['conversaciones' => 0, 'entran' => 0, 'salen' => 0];
        $porcurso = [];
        $filas = $DB->get_recordset('local_crm_conversaciones', null, 'courseid, id');
        foreach ($filas as $f) {
            $contexto = \context_course::instance($f->courseid, IGNORE_MISSING);
            if (!$contexto || !$DB->record_exists('message_conversations', ['id' => $f->conversationid])) {
                continue;
            }
            if (!isset($porcurso[$f->courseid])) {
                // Solo se guarda la del curso de ahora: las filas vienen ordenadas por curso.
                $porcurso = [$f->courseid => array_keys(chat_directo::tutoras($contexto))];
            }
            $r = self::sincronizar((int) $f->conversationid, (int) $f->userid, $porcurso[$f->courseid]);
            $total['conversaciones']++;
            $total['entran'] += count($r['entran']);
            $total['salen'] += count($r['salen']);
        }
        $filas->close();
        return $total;
    }
}
