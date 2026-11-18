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

// Se instala con el ZIP desde el panel y se conecta pegando el código que da el
// CRM (Administración del sitio › Extensiones › Extensiones locales › CRM). Ver README.md.

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_crm';
$plugin->version   = 2026111700;
$plugin->requires  = 2024042200; // Moodle 4.4.
$plugin->supported = [404, 502]; // Del 4.4 (ISEIE) al 5.2 (ISECD, ISSLOGG, ISEF).
$plugin->maturity  = MATURITY_STABLE;
$plugin->release   = '1.10.8';
