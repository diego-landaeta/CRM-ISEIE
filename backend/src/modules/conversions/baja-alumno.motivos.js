/**
 * Los motivos de la baja de un alumno (migración 341; 330 en el 360).
 *
 * La CLAVE es lo que se guarda (CHECK en `conversions.baja_motivo`); el texto
 * se puede reescribir sin tocar la base. Con «otro», la nota es obligatoria.
 *
 * No son los de `feedback/motivos.js`: aquellos son del prospecto que no compró
 * («¿por qué has desistido?», #169); estos, del alumno que ya compró.
 */
export const MOTIVOS_BAJA = [
  { clave: 'desistimiento', texto: 'Desistimiento en plazo' },
  { clave: 'voluntaria', texto: 'Baja voluntaria' },
  { clave: 'impago', texto: 'Impago' },
  { clave: 'otro', texto: 'Otro' },
];

export const CLAVES_BAJA = MOTIVOS_BAJA.map((m) => m.clave);

export const textoMotivoBaja = (clave) => MOTIVOS_BAJA.find((m) => m.clave === clave)?.texto || 'Otro';
