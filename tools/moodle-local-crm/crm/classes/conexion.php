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
 * Conectar el campus con el CRM pegando UN código (como local_certifex).
 *
 * El código lo da el CRM (Integraciones › Campus › Conectar campus) y lleva dentro la
 * dirección del CRM. Con él, este plugin hace solo lo demás: enciende los servicios web
 * y REST, deja activo su servicio «CRM» y crea un token permanente para el
 * administrador que conecta, se presenta al CRM y guarda la dirección y la clave que
 * el CRM le devuelve. Nadie ve ni teclea el token ni la clave. Se puede repetir.
 */
class conexion {

    /** El servicio externo del plugin (db/services.php). */
    const SERVICIO = 'local_crm';

    /** Prefijo del código: si no empieza así, no es un código del CRM. */
    const PREFIJO = 'crm1.';

    /** ¿Está conectado? Lo está si tiene dirección y clave. */
    public static function conectado(): bool {
        return aviso::configurado();
    }

    /**
     * Lee el código pegado: ['crm' => url de la API del CRM, 'c' => código de un solo uso].
     *
     * @return array|null null si no es un código del CRM.
     */
    public static function leer_codigo(string $pegado): ?array {
        $pegado = preg_replace('/\s+/', '', $pegado);
        if (strpos($pegado, self::PREFIJO) !== 0) {
            return null;
        }
        $b64 = strtr(substr($pegado, strlen(self::PREFIJO)), '-_', '+/');
        $json = base64_decode($b64 . str_repeat('=', (4 - strlen($b64) % 4) % 4), true);
        $datos = $json !== false ? json_decode($json, true) : null;
        if (!is_array($datos) || empty($datos['crm']) || empty($datos['c'])) {
            return null;
        }
        return ['crm' => rtrim((string) $datos['crm'], '/'), 'c' => (string) $datos['c']];
    }

    /**
     * El token de este campus no sale por http: solo https. La única excepción es un
     * CRM de pruebas en la misma máquina (localhost o el host de Docker).
     */
    public static function url_segura(string $url): bool {
        $partes = parse_url($url);
        if (empty($partes['scheme']) || empty($partes['host'])) {
            return false;
        }
        if ($partes['scheme'] === 'https') {
            return true;
        }
        return $partes['scheme'] === 'http'
            && in_array($partes['host'], ['localhost', '127.0.0.1', 'host.docker.internal'], true);
    }

    /** Los CRM a los que este campus puede mandar su token (ajuste «crms», uno por línea). */
    const CRMS_POR_DEFECTO = "360crm.tech\ncrm.iseie.com";

    /**
     * ¿Es un CRM de la lista? Un código lo puede fabricar cualquiera: sin la lista, un
     * código falso haría que el campus mandara su token a otro servidor. El CRM de pruebas
     * en la misma máquina (localhost, Docker) vale siempre.
     */
    public static function crm_permitido(string $url): bool {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if ($host === '') {
            return false;
        }
        if (in_array($host, ['localhost', '127.0.0.1', 'host.docker.internal'], true)) {
            return true;
        }
        $lista = get_config('local_crm', 'crms');
        $lista = $lista === false ? self::CRMS_POR_DEFECTO : (string) $lista;
        $hosts = array_filter(array_map(fn($h) => strtolower(trim($h)), preg_split('/[\s,]+/', $lista)));
        return in_array($host, $hosts, true);
    }

    /** Una dirección de la API del CRM, comparable: sin protocolo, sin barra final y en minúsculas. */
    public static function clave_crm(string $url): string {
        return strtolower(rtrim((string) preg_replace('~^https?://~i', '', trim($url)), '/'));
    }

    /**
     * ¿Este código cambia el campus de CRM? (#689) El plugin guarda UNA sola dirección y UNA
     * sola clave: conectar con otro CRM deja al de ahora sin los mensajes del campus. Y entre
     * producción (360crm.tech/crm) y pruebas (360crm.tech/testeo) el dominio es el mismo, así
     * que la lista de CRM permitidos no lo frena: antes de cambiar, se avisa y se confirma.
     *
     * @param string $nuevo la dirección de la API que trae el código.
     * @return array|null ['actual' => API del CRM de ahora ('' si no se sabe), 'nuevo' => la del código];
     *         null si el campus no está conectado o el código es del mismo CRM.
     */
    public static function cambio_de_crm(string $nuevo): ?array {
        if (!self::conectado()) {
            return null;
        }
        $actual = (string) actualizar::base_api();
        if ($actual !== '' && self::clave_crm($actual) === self::clave_crm($nuevo)) {
            return null;
        }
        return ['actual' => $actual, 'nuevo' => rtrim($nuevo, '/')];
    }

    /**
     * El CRM, dicho para una persona: «360crm.tech/crm (producción)», «360crm.tech/testeo
     * (pruebas)», «host.docker.internal:3002 (local, en esta máquina)». Sin el «/api» final.
     */
    public static function describir_crm(string $url): string {
        $partes = parse_url(trim($url));
        $host = strtolower((string) ($partes['host'] ?? ''));
        if ($host === '') {
            return get_string('crm_desconocido', 'local_crm');
        }
        $ruta = (string) preg_replace('~/api$~', '', rtrim((string) ($partes['path'] ?? ''), '/'));
        $donde = $host . (isset($partes['port']) ? ':' . $partes['port'] : '') . $ruta;
        if (in_array($host, ['localhost', '127.0.0.1', 'host.docker.internal'], true)) {
            return get_string('crm_tipo_local', 'local_crm', $donde);
        }
        return get_string(preg_match('~/testeo(/|$)~', $ruta) ? 'crm_tipo_pruebas' : 'crm_tipo_produccion', 'local_crm', $donde);
    }

    /** El usuario del servicio: el token del CRM es suyo, no del administrador que conecta. */
    const USUARIO_SERVICIO = 'crm_servicio';

    /** Su rol, solo en el sistema y solo con lo que usa el CRM. */
    const ROL_SERVICIO = 'local_crm_servicio';

    /**
     * Lo que el CRM necesita leer y hacer en el campus, y nada más: leer cursos, matrículas,
     * mensajes y entregas, abrir los archivos entregados, y escribir y calificar en nombre de
     * una tutora (que el plugin vuelve a comprobar en cada llamada). Sin «administrar el sitio».
     */
    const CAPACIDADES_SERVICIO = [
        'webservice/rest:use',
        'local/crm:enviarcomo',
        'moodle/site:readallmessages',
        'moodle/site:viewuseridentity',
        'moodle/site:accessallgroups',
        'moodle/user:viewdetails',
        'moodle/user:viewhiddendetails',
        'moodle/course:view',
        'moodle/course:viewhiddencourses',
        'moodle/course:viewhiddenactivities',
        'moodle/course:viewhiddensections',
        'moodle/course:viewparticipants',
        'moodle/course:enrolreview',
        'moodle/grade:viewall',
        'mod/assign:view',
        'mod/assign:grade',
        'mod/assign:viewgrades',
        // El % del curso hecho por cada alumno («Mi campus», #681): sin esto Moodle lo
        // calcula pero no se lo da a quien no es el propio alumno (`progress` sale vacío:
        // completion_can_view_data, en lib/completionlib.php).
        'report/completion:view',
    ];

    /**
     * El usuario del servicio, creado la primera vez: cuenta manual con contraseña aleatoria
     * que nadie conoce (no se usa para entrar, solo para el token) y su rol en el sistema.
     * Idempotente: en cada conexión deja el rol con exactamente esas capacidades.
     */
    public static function usuario_servicio(): int {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/user/lib.php');
        $usuario = $DB->get_record('user', ['username' => self::USUARIO_SERVICIO, 'mnethostid' => $CFG->mnet_localhost_id, 'deleted' => 0]);
        if (!$usuario) {
            $id = user_create_user((object) [
                'username' => self::USUARIO_SERVICIO, 'auth' => 'manual', 'password' => random_string(40) . 'A1!',
                'firstname' => 'CRM', 'lastname' => 'servicio', 'email' => 'noreply-crm@invalid.local',
                'confirmed' => 1, 'policyagreed' => 1, 'mnethostid' => $CFG->mnet_localhost_id,
            ], true, false);
        } else {
            $id = (int) $usuario->id;
            if (!empty($usuario->suspended)) {
                $DB->set_field('user', 'suspended', 0, ['id' => $id]);
            }
        }
        $sistema = \context_system::instance();
        $rol = $DB->get_record('role', ['shortname' => self::ROL_SERVICIO]);
        $rolid = $rol ? (int) $rol->id : create_role('CRM (servicio)', self::ROL_SERVICIO,
            'Rol del usuario con el que el CRM lee el campus y responde en nombre de las tutoras (local_crm).');
        set_role_contextlevels($rolid, [CONTEXT_SYSTEM]);
        foreach (self::CAPACIDADES_SERVICIO as $cap) {
            if (get_capability_info($cap)) {
                assign_capability($cap, CAP_ALLOW, $rolid, $sistema->id, true);
            }
        }
        // Ver cada tipo de actividad (cuestionarios, foros, lecciones…), para que «el curso
        // completo» del CRM las enseñe todas: solo «:view», ninguna de escribir.
        foreach (get_all_capabilities() as $cap) {
            if (preg_match('~^mod/[a-z0-9_]+:view$~', $cap['name'])) {
                assign_capability($cap['name'], CAP_ALLOW, $rolid, $sistema->id, true);
            }
        }
        if (!user_has_role_assignment($id, $rolid, $sistema->id)) {
            role_assign($rolid, $id, $sistema->id);
        }
        $sistema->mark_dirty();
        return $id;
    }

    /**
     * Servicios web + REST encendidos, el servicio del plugin activo y un token
     * permanente para $userid. Aditivo e idempotente: reutiliza el token si ya existe.
     */
    public static function preparar_token(\context $contexto, int $userid): string {
        global $DB;
        set_config('enablewebservices', 1);
        $activos = array_filter(array_map('trim', explode(',', (string) get_config('core', 'webserviceprotocols'))));
        if (!in_array('rest', $activos, true)) {
            $activos[] = 'rest';
            set_config('webserviceprotocols', implode(',', $activos));
        }
        $servicio = $DB->get_record('external_services', ['shortname' => self::SERVICIO], '*', MUST_EXIST);
        if (empty($servicio->enabled) || !empty($servicio->restrictedusers)) {
            $DB->update_record('external_services', (object) ['id' => $servicio->id, 'enabled' => 1, 'restrictedusers' => 0]);
        }
        $existente = $DB->get_record('external_tokens', [
            'externalserviceid' => $servicio->id, 'userid' => $userid, 'tokentype' => EXTERNAL_TOKEN_PERMANENT,
        ]);
        if ($existente) {
            return $existente->token;
        }
        return \core_external\util::generate_token(EXTERNAL_TOKEN_PERMANENT, $servicio, $userid, $contexto);
    }

    /**
     * Conecta: prepara el token, se presenta al CRM con el código y guarda lo que
     * devuelve.
     *
     * Si el código es de OTRO CRM (#689), no conecta sin `$cambio_confirmado`: la dirección
     * del CRM de ahora que la persona vio en el aviso y confirmó. Si no viene, o ya no es la
     * de ahora, devuelve 'cambio' => ['actual', 'nuevo'] para enseñar el aviso, y no toca nada.
     *
     * @param string|null $cambio_confirmado la API del CRM actual, tal como se confirmó; null = sin confirmar.
     * @return array ['ok' => bool, 'campus' => string, 'error' => string] (+ 'cambio' si falta confirmar)
     */
    public static function conectar(string $pegado, \context $contexto, int $userid, ?string $cambio_confirmado = null): array {
        global $CFG;
        require_once($CFG->libdir . '/filelib.php');

        $codigo = self::leer_codigo($pegado);
        if ($codigo === null) {
            return ['ok' => false, 'campus' => '', 'error' => get_string('conectar_codigo_malo', 'local_crm')];
        }
        if (!self::url_segura($codigo['crm'])) {
            return ['ok' => false, 'campus' => '', 'error' => get_string('conectar_inseguro', 'local_crm')];
        }
        if (!self::crm_permitido($codigo['crm'])) {
            return ['ok' => false, 'campus' => '',
                'error' => get_string('conectar_no_permitido', 'local_crm', s((string) parse_url($codigo['crm'], PHP_URL_HOST)))];
        }
        // Cambiar de CRM, solo confirmado: antes de revocar ni guardar nada.
        $cambio = self::cambio_de_crm($codigo['crm']);
        if ($cambio !== null
                && ($cambio_confirmado === null || self::clave_crm($cambio_confirmado) !== self::clave_crm($cambio['actual']))) {
            return ['ok' => false, 'campus' => '', 'error' => get_string('cambio_sin_confirmar', 'local_crm'), 'cambio' => $cambio];
        }

        // El token, del usuario del servicio (no de quien conecta): si se filtra, no administra el sitio.
        // Los tokens que el plugin dio antes a administradores dejan de valer.
        $servicio = self::usuario_servicio();
        self::revocar_tokens($servicio);
        $token = self::preparar_token($contexto, $servicio);
        $curl = new \curl();
        $curl->setHeader(['Content-Type: application/json', 'Accept: application/json']);
        $respuesta = $curl->post($codigo['crm'] . '/moodle-avisos/conectar', json_encode([
            'codigo' => $codigo['c'],
            'sitio'  => $CFG->wwwroot,
            'token'  => $token,
        ]), ['CURLOPT_TIMEOUT' => 30, 'CURLOPT_CONNECTTIMEOUT' => 5]);
        $http = (int) ($curl->get_info()['http_code'] ?? 0);
        $datos = is_string($respuesta) ? json_decode($respuesta, true) : null;

        if ($http === 200 && !empty($datos['success']) && !empty($datos['data']['secreto']) && !empty($datos['data']['avisos'])) {
            set_config('url', (string) $datos['data']['avisos'], 'local_crm');
            set_config('secreto', (string) $datos['data']['secreto'], 'local_crm');
            set_config('campus', (string) ($datos['data']['campus'] ?? ''), 'local_crm');
            set_config('conectado', time(), 'local_crm');
            return ['ok' => true, 'campus' => (string) ($datos['data']['campus'] ?? ''), 'error' => ''];
        }
        // El CRM dice por qué no (código usado, caducado, no ha podido entrar…): se pasa tal cual.
        $error = is_array($datos) && !empty($datos['error'])
            ? (string) $datos['error']
            : ($curl->get_errno() ? get_string('conectar_sin_respuesta', 'local_crm', $curl->error) : 'HTTP ' . $http);
        return ['ok' => false, 'campus' => '', 'error' => $error];
    }

    /** Revoca los tokens del servicio del plugin, salvo los del usuario `$menos`. */
    public static function revocar_tokens(int $menos = 0): void {
        global $DB;
        $servicio = $DB->get_record('external_services', ['shortname' => self::SERVICIO], 'id');
        if ($servicio) {
            $DB->delete_records_select('external_tokens', 'externalserviceid = ? AND userid <> ?', [$servicio->id, $menos]);
        }
    }

    /**
     * Desconecta: olvida la dirección y la clave, y revoca los tokens del servicio del
     * plugin. El CRM deja de recibir avisos y su token deja de valer en este campus.
     */
    public static function desconectar(): void {
        global $DB;
        foreach (['url', 'secreto', 'campus', 'conectado'] as $clave) {
            unset_config($clave, 'local_crm');
        }
        $servicio = $DB->get_record('external_services', ['shortname' => self::SERVICIO], 'id');
        if ($servicio) {
            $DB->delete_records('external_tokens', ['externalserviceid' => $servicio->id]);
        }
    }
}
