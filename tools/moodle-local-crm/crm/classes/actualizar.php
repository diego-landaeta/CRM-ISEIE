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
 * La actualización automática del plugin.
 *
 * Pregunta al CRM al que está conectado qué versión hay publicada y, si es más nueva:
 *   1. comprueba la FIRMA (RSA-SHA256 sobre «local_crm|versión|sha256») con las claves
 *      públicas de {@see claves}: sin firma válida no se instala nada;
 *   2. descarga el ZIP y comprueba su huella, su carpeta raíz («crm») y su version.php;
 *   3. guarda una copia de la versión instalada (el archivo de Moodle), pone la nueva y
 *      ejecuta su actualización; si algo falla, vuelve a la copia.
 * Lo que pasa queda apuntado (ajuste «ultima_comprobacion») y se ve en «Conectar con el CRM».
 *
 * No instala si el campus lo tiene apagado (ajuste «autoactualizar»), si el sitio no deja
 * instalar extensiones solas ($CFG->disableupdateautodeploy) o si Moodle no puede escribir
 * en la carpeta del plugin: entonces avisa de que hay versión nueva para instalar a mano.
 */
class actualizar {

    /**
     * ¿Está encendida? De serie, SÍ (1.10.6; de la 1.10.0 a la 1.10.5 venía apagada): lo que
     * instala tiene que traer la firma del CRM ({@see claves}), y el campus la apaga en los
     * ajustes del plugin. Sin ajuste guardado (false) cuenta como el valor de serie.
     */
    public static function activa(): bool {
        $v = get_config('local_crm', 'autoactualizar');
        return $v === false ? true : (bool) $v;
    }

    /** La dirección de la API del CRM, sacada de la de los avisos (…/api/moodle-avisos/<campus>). */
    public static function base_api(): ?string {
        $url = trim((string) get_config('local_crm', 'url'));
        if ($url === '' || !preg_match('~^(https?://.+)/moodle-avisos/\d+/?$~', $url, $m)) {
            return null;
        }
        return $m[1];
    }

    /** Lo último que pasó (para enseñarlo en la página del plugin). */
    public static function ultima(): ?array {
        $v = get_config('local_crm', 'ultima_comprobacion');
        $d = $v ? json_decode($v, true) : null;
        return is_array($d) ? $d : null;
    }

    private static function anotar(string $estado, string $mensaje, array $extra = []): array {
        $r = ['estado' => $estado, 'mensaje' => $mensaje, 'at' => time()] + $extra;
        set_config('ultima_comprobacion', json_encode($r), 'local_crm');
        if (function_exists('mtrace')) {
            mtrace("local_crm: [{$estado}] {$mensaje}");
        }
        return $r;
    }

    /** ¿La firma la hizo la clave privada de alguna de las claves públicas de confianza? */
    public static function firma_valida(string $mensaje, string $firmab64): bool {
        $firma = base64_decode($firmab64, true);
        if ($firma === false || $firma === '') {
            return false;
        }
        foreach (claves::PUBLICAS as $pem) {
            $clave = openssl_pkey_get_public($pem);
            if ($clave && openssl_verify($mensaje, $firma, $clave, OPENSSL_ALGO_SHA256) === 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * Comprueba si hay versión nueva y, con `$instalar` (y si se puede), la instala.
     *
     * @return array ['estado' => al_dia|disponible|actualizado|error, 'mensaje' => string, ...]
     */
    public static function comprobar(bool $instalar = true): array {
        global $CFG;
        require_once($CFG->libdir . '/filelib.php');

        $base = self::base_api();
        if (!$base) {
            return self::anotar('error', get_string('act_sin_conexion', 'local_crm'));
        }
        $curl = new \curl();
        $curl->setHeader(['Accept: application/json']);
        $respuesta = $curl->get($base . '/moodle-avisos/plugin/ultima', [], ['CURLOPT_TIMEOUT' => 20, 'CURLOPT_CONNECTTIMEOUT' => 5]);
        $http = (int) ($curl->get_info()['http_code'] ?? 0);
        if ($http === 404) {
            return self::anotar('al_dia', get_string('act_nada_publicado', 'local_crm'));
        }
        $datos = is_string($respuesta) ? json_decode($respuesta, true) : null;
        $m = $datos['data'] ?? null;
        if ($http !== 200 || !is_array($m)) {
            return self::anotar('error', get_string('act_sin_respuesta', 'local_crm', $curl->get_errno() ? $curl->error : 'HTTP ' . $http));
        }
        if (($m['componente'] ?? '') !== 'local_crm' || !ctype_digit((string) ($m['version'] ?? ''))
                || !preg_match('/^[0-9a-f]{64}$/', (string) ($m['sha256'] ?? '')) || empty($m['firma'])) {
            return self::anotar('error', get_string('act_manifiesto_malo', 'local_crm'));
        }
        $nueva = (int) $m['version'];
        $release = clean_param((string) ($m['release'] ?? $nueva), PARAM_TEXT);
        $actual = (int) get_config('local_crm', 'version');
        $actualrelease = (string) (\core_plugin_manager::instance()->get_plugin_info('local_crm')->release ?? $actual);
        if ($nueva <= $actual) {
            return self::anotar('al_dia', get_string('act_al_dia', 'local_crm', s($actualrelease)), ['version' => $actualrelease]);
        }
        if (!self::firma_valida("local_crm|{$nueva}|{$m['sha256']}", (string) $m['firma'])) {
            return self::anotar('error', get_string('act_firma_mala', 'local_crm', s($release)));
        }
        if (!empty($m['requires']) && (int) $m['requires'] > (int) $CFG->version) {
            return self::anotar('disponible', get_string('act_moodle_viejo', 'local_crm', s($release)), ['nueva' => $release]);
        }
        if (!$instalar || !self::activa()) {
            return self::anotar('disponible', get_string('act_disponible', 'local_crm', s($release)), ['nueva' => $release]);
        }
        if (!empty($CFG->disableupdateautodeploy)) {
            return self::anotar('disponible', get_string('act_bloqueada_sitio', 'local_crm', s($release)), ['nueva' => $release]);
        }
        $dir = \core_component::get_plugin_directory('local', 'crm');
        if (!$dir || !is_writable($dir) || !is_writable(dirname($dir))) {
            return self::anotar('disponible', get_string('act_sin_permisos', 'local_crm', s($release)), ['nueva' => $release]);
        }

        // Descargar y comprobar la huella.
        $tmp = make_request_directory();
        $zip = $tmp . '/local_crm.zip';
        $ok = $curl->download_one($base . '/moodle-avisos/plugin/local_crm.zip', null,
            ['filepath' => $zip, 'timeout' => 120, 'followlocation' => false]);
        if ($ok !== true || !is_file($zip) || hash_file('sha256', $zip) !== $m['sha256']) {
            return self::anotar('error', get_string('act_descarga_mala', 'local_crm', s($release)));
        }
        // Comprobar lo que trae, en una carpeta aparte: raíz «crm», componente y versión.
        $cm = new \core\update\code_manager();
        if ($cm->get_plugin_zip_root_dir($zip) !== 'crm') {
            return self::anotar('error', get_string('act_zip_malo', 'local_crm'));
        }
        $prueba = make_request_directory();
        $cm->unzip_plugin_file($zip, $prueba);
        $plugin = new \stdClass();
        $fichero = $prueba . '/crm/version.php';
        if (is_file($fichero)) {
            $codigo = file_get_contents($fichero);
            if (preg_match('/\$plugin->component\s*=\s*\'([a-z_]+)\'/', $codigo, $c)) {
                $plugin->component = $c[1];
            }
            if (preg_match('/\$plugin->version\s*=\s*(\d+)/', $codigo, $v)) {
                $plugin->version = (int) $v[1];
            }
        }
        if (($plugin->component ?? '') !== 'local_crm' || ($plugin->version ?? 0) !== $nueva) {
            return self::anotar('error', get_string('act_zip_malo', 'local_crm'));
        }

        // Copia de la instalada, la nueva en su sitio y su actualización. Si falla, vuelta atrás.
        $cm->archive_plugin_version($dir, 'local_crm', $actual, true);
        try {
            remove_dir($dir);
            $cm->unzip_plugin_file($zip, dirname($dir), 'crm');
            require_once($CFG->libdir . '/upgradelib.php');
            upgrade_noncore(false);
            purge_all_caches();
        } catch (\Throwable $e) {
            $copia = $cm->get_archived_plugin_version('local_crm', $actual);
            if ($copia) {
                remove_dir($dir);
                $cm->unzip_plugin_file($copia, dirname($dir), 'crm');
                purge_all_caches();
            }
            return self::anotar('error', get_string('act_fallo_instalar', 'local_crm', s($e->getMessage())));
        }
        return self::anotar('actualizado', get_string('act_hecho', 'local_crm', ['de' => s($actualrelease), 'a' => s($release)]),
            ['version' => $release]);
    }
}
