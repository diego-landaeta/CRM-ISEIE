<?php
// Temas y actividades variadas en el curso de prueba (solo local), para «Ver el curso completo».
define('CLI_SCRIPT', true);
require(getenv('MOODLE_CONFIG') ?: '/bitnami/moodle/config.php');
require_once($CFG->libdir . '/testing/generator/lib.php');
require_once($CFG->dirroot . '/course/lib.php');
global $DB;
\core\session\manager::set_user(get_admin());
$curso = $DB->get_record('course', ['shortname' => 'CRM679'], '*', MUST_EXIST);
$gen = new testing_data_generator();
course_create_sections_if_missing($curso, [1, 2, 3]);
$nombres = [1 => 'Módulo 1 · Fundamentos', 2 => 'Módulo 2 · Casos prácticos', 3 => 'Módulo 3 · Evaluación final (en preparación)'];
foreach ($nombres as $n => $nombre) {
    $s = $DB->get_record('course_sections', ['course' => $curso->id, 'section' => $n], '*', MUST_EXIST);
    course_update_section($curso, $s, ['name' => $nombre, 'visible' => $n === 3 ? 0 : 1]);
}
$hay = fn($nombre) => $DB->record_exists_sql("SELECT 1 FROM {course_modules} cm JOIN {modules} m ON m.id = cm.module
    WHERE cm.course = ? AND cm.deletioninprogress = 0 AND m.name IN ('page','url','quiz','forum','resource','folder')
      AND EXISTS (SELECT 1 FROM {page} p WHERE m.name = 'page' AND p.id = cm.instance AND p.name = ?)", [$curso->id, $nombre]);
if (!$DB->record_exists('page', ['course' => $curso->id, 'name' => 'Lectura: introducción al módulo'])) {
    $gen->create_module('page', ['course' => $curso->id, 'section' => 1, 'name' => 'Lectura: introducción al módulo', 'content' => '<p>Texto.</p>']);
    $gen->create_module('url', ['course' => $curso->id, 'section' => 1, 'name' => 'Vídeo de la clase 1', 'externalurl' => 'https://example.com/video']);
    $gen->create_module('quiz', ['course' => $curso->id, 'section' => 1, 'name' => 'Cuestionario del módulo 1', 'timeclose' => time() + 10 * 86400]);
    $gen->create_module('forum', ['course' => $curso->id, 'section' => 2, 'name' => 'Foro de dudas del módulo 2']);
    $gen->create_module('resource', ['course' => $curso->id, 'section' => 2, 'name' => 'Guía del caso práctico (PDF)']);
    $gen->create_module('folder', ['course' => $curso->id, 'section' => 3, 'name' => 'Materiales del examen', 'visible' => 0]);
}
rebuild_course_cache($curso->id, true);
echo "ok\n";
