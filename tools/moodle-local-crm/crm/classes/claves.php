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
 * local_crm: las claves públicas con las que se comprueban las actualizaciones (CRM #679).
 *
 * @package    local_crm
 * @copyright  2026 ISEIE Innovation School
 * @license    https://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_crm;

defined('MOODLE_INTERNAL') || die();

/**
 * Solo se instala una versión nueva si su firma la hizo la clave privada de una de estas.
 * La privada vive en el servidor del CRM (PLUGIN_FIRMA_CLAVE_ARCHIVO) y nunca en el repo.
 *
 * IMPORTANTE ANTES DE PRODUCCIÓN: la clave de abajo es la de PRUEBAS LOCALES. Quien despliega
 * genera el par de producción (ver backend/scripts/publicar-plugin-moodle.mjs), pone aquí la
 * PÚBLICA y publica el plugin con la PRIVADA. Para cambiar de clave sin cortar las
 * actualizaciones: añadir la nueva, publicar una versión firmada con la vieja, y después quitarla.
 */
class claves {
    /** @var string[] Claves públicas en PEM (RSA). */
    const PUBLICAS = [
        // Pruebas locales (#679, 05/11/2026). Sustituir por la de producción.
        <<<'PEM'
-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAjE0Exco15LQBg6uWbwn4
16aMK5Rt+Chmce0ShF+ixnVeZAK46zfyb6V5MaVCEORnZJUSv5Q5za2SHFZpPvj5
2nBFfzJy6mNHH/ExwI82KR7oeB2EO+U81C3HOgNMkSXDPvlYmCfrKTQGvmQIGJfG
Bc4PVa0fFvwMphZ8JauD2h5IXKKjqxTqyEex7e3OSKgcSWVZnbZad40mB8PLaO8S
SsLm0+hLIoIS4NDIzSd6X1ZgSJLiz2OMZp8y+KL1yF7RgWvL1fX+AWKCtoB/Ktsp
+aTzxx0F2nq1aHpNGdpZ41MkEt8XKz+kWaVNJSjPqVnbSNLxjaL+KhulM2TvTa8D
0pEAXm25OL/6Qpnj0evjnsdZ6H1L777uHl83Ca8hIyBflSWBpqVVb88wbJmxtMee
G7mK6afEmB9IBpDGI+XCsZfoYoCEQ1F7FR7FWVdtVFsHzRyHHzCtlK8wg2RppCMx
wilEetWRWUfcxFiX0wSd7PMJnDyGNxwVSroom7oc+ICNAgMBAAE=
-----END PUBLIC KEY-----
PEM,
    ];
}
