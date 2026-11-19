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
 * Quiénes son las tutoras de un curso, y lo que queda del chat directo (1.6.0 a 1.8.0).
 *
 * Desde la 1.9.0, «Entrar al chat» abre la conversación de GRUPO del alumno con las
 * tutoras del curso (chat_grupo). De aquí sale el criterio de quién es tutora, el mismo
 * que antes: profesora del curso (con o sin edición), con la matrícula activa, sin las
 * cuentas excluidas por nombre («Inspector…») y, para estar en el chat, sin las que el CRM
 * ha marcado «No disponible».
 *
 * Las conversaciones privadas que abrió el chat directo siguen como estaban: su curso está
 * en `local_crm_chat` y sus mensajes siguen llegando al CRM.
 */
class chat_directo {

    /** Los ids de Moodle que el CRM ha marcado «No disponible». */
    public static function no_disponibles(): array {
        $v = (string) get_config('local_crm', 'no_disponibles');
        return array_values(array_filter(array_map('intval', explode(',', $v))));
    }

    /** Los roles de tutora: los de profesor, con y sin permiso de edición. */
    public static function roles_tutora(): array {
        $ids = [];
        foreach (['editingteacher', 'teacher'] as $arquetipo) {
            foreach (get_archetype_roles($arquetipo) as $r) {
                $ids[] = (int) $r->id;
            }
        }
        return array_values(array_unique($ids));
    }

    /**
     * Las tutoras del curso: rol de profesora EN el curso y matrícula activa, sin las
     * excluidas por nombre. Con `$disponibles`, sin las «No disponible» del CRM.
     *
     * @return \stdClass[] indexado por id
     */
    public static function tutoras(\context_course $contexto, bool $disponibles = true): array {
        global $DB;
        $roles = self::roles_tutora();
        if (!$roles) {
            return [];
        }
        [$insql, $params] = $DB->get_in_or_equal($roles, SQL_PARAMS_NAMED);
        $params['ctx'] = $contexto->id;
        $campos = \core_user\fields::for_name()->get_sql('u', false, '', '', false)->selects;
        $gente = $DB->get_records_sql(
            "SELECT DISTINCT u.id, $campos
               FROM {role_assignments} ra
               JOIN {user} u ON u.id = ra.userid
              WHERE ra.contextid = :ctx AND ra.roleid $insql AND u.deleted = 0 AND u.suspended = 0", $params);
        if (!$gente) {
            return [];
        }
        $activos = get_enrolled_users($contexto, '', 0, 'u.id', null, 0, 0, true);
        $gente = array_intersect_key($gente, $activos);
        $excluir = \core_text::strtolower(trim((string) (get_config('local_crm', 'excluir_nombre') ?: 'Inspector')));
        $fuera = $disponibles ? array_flip(self::no_disponibles()) : [];
        return array_filter($gente, function ($u) use ($excluir, $fuera) {
            if (isset($fuera[(int) $u->id])) {
                return false;
            }
            return $excluir === '' || \core_text::strpos(\core_text::strtolower(fullname($u)), $excluir) !== 0;
        });
    }

    /** ¿Es tutora de ese curso (aunque esté «No disponible»)? */
    public static function es_tutora(\context_course $contexto, int $userid): bool {
        return isset(self::tutoras($contexto, false)[$userid]);
    }

    /** El curso de una conversación, si se abrió desde el chat de un curso. */
    public static function curso_de(int $conversationid): ?int {
        global $DB;
        $c = $DB->get_field('local_crm_chat', 'courseid', ['conversationid' => $conversationid]);
        return $c ? (int) $c : null;
    }

    /**
     * El script que cambia «Entrar al chat» en la página de la actividad Chat: lleva a
     * chat.php (que abre la conversación de grupo) y quita «Usar interfaz más accesible»,
     * que abre la misma sala. Sin expresiones regulares ni dependencias: cualquier tema.
     */
    public static function script_del_boton(): string {
        global $PAGE;
        if (!chat_grupo::activo() || $PAGE->pagetype !== 'mod-chat-view' || !isloggedin() || isguestuser() || empty($PAGE->cm->id)) {
            return '';
        }
        $destino = json_encode((new \moodle_url('/local/crm/chat.php', ['id' => $PAGE->cm->id]))->out(false));
        return <<<HTML
<script>
(function () {
  function cambiar() {
    var zona = document.querySelector("#region-main") || document.body;
    Array.prototype.forEach.call(zona.querySelectorAll("a[href*='/mod/chat/gui_']"), function (a) {
      if ((a.getAttribute("href") || "").indexOf("gui_basic") >= 0) { a.remove(); return; }
      var n = a.cloneNode(true);
      n.removeAttribute("id");
      n.removeAttribute("target");
      n.setAttribute("href", {$destino});
      n.setAttribute("data-crm-chat", "grupo");
      a.parentNode.replaceChild(n, a);
    });
  }
  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", cambiar); } else { cambiar(); }
})();
</script>
HTML;
    }
}
