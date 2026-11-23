import Field from '@/shared/components/ui/Field';
import { inputClass } from '@/shared/lib/ui';
import { hoyEnMadrid } from '@/shared/lib/fechas';
import type { Falta } from '@/shared/lib/loQueFalta';

/*
  LA FECHA DE INICIO DEL CURSO, AL CERRAR LA VENTA (#767 paso 1, CRM#1036).

  Es la que pacta la comercial con el alumno, y con ella se programa la
  matrícula en Moodle: el día anterior, por la mañana. Sin ella, el alumno se
  matricula en cuanto paga, que no es lo que se le ha dicho.

  Obligatoria SOLO si el producto de la venta (o alguna de sus líneas) está
  unido a un curso de Moodle de su campus: solo entonces hay matrícula. Con
  otro producto el campo sigue ahí, opcional, y lo dice. Una fecha que ya pasó
  se deja poner: hay ventas de cursos ya empezados. Solo se avisa de que la
  matrícula irá con el pago.
*/

export const AYUDA_FECHA_INICIO = 'La matrícula en Moodle se hace el día anterior a esta fecha.';
export const AYUDA_CON_CURSO = 'Obligatoria: el producto tiene curso de Moodle y la matrícula se hace el día anterior a esta fecha.';
export const AYUDA_SIN_CURSO = 'Opcional: el producto elegido no tiene curso de Moodle.';
export const AYUDA_SIN_PRODUCTO = 'Obligatoria si el producto tiene curso de Moodle.';
export const AVISO_FECHA_PASADA = 'Esa fecha ya pasó: la matrícula en Moodle se hará en cuanto se confirme el pago.';
export const ERROR_FALTA_FECHA = 'Este producto tiene curso de Moodle: pon la fecha de inicio pactada con el alumno, que con ella se programa su matrícula.';

/** El aviso para la lista de «lo que falta», o null si está puesta o no hace falta. */
export function faltaFechaInicio(fecha: string | null | undefined, exige = true): Falta | null {
  if (!exige) return null;
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  return {
    title: 'Falta la fecha de inicio del curso',
    description: ERROR_FALTA_FECHA,
    que: 'la fecha en «Fecha de inicio del curso»',
  };
}

/** La línea de debajo con una fecha puesta: el aviso si ya pasó, la ayuda si no. */
export function ayudaFechaInicio(fecha: string, hoy: string = hoyEnMadrid()): string {
  return fecha && fecha < hoy ? AVISO_FECHA_PASADA : AYUDA_FECHA_INICIO;
}

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** El producto tiene curso de Moodle: la fecha es obligatoria. */
  required?: boolean;
  /** Aún no hay producto elegido: no se sabe si hará falta. */
  sinProducto?: boolean;
  /** Se ha intentado guardar: si falta, el campo lo dice. */
  intentado?: boolean;
  /** Otra ayuda para cuando no es obligatoria (p. ej. «Editar venta»). */
  hint?: string;
}

export default function FechaInicioCurso({ id, value, onChange, required = false, sinProducto = false, intentado = false, hint }: Props) {
  const error = required && intentado && !value ? ERROR_FALTA_FECHA : undefined;
  const ayuda = value
    ? ayudaFechaInicio(value)
    : required ? AYUDA_CON_CURSO : sinProducto ? AYUDA_SIN_PRODUCTO : (hint ?? AYUDA_SIN_CURSO);
  return (
    <Field label="Fecha de inicio del curso" required={required} htmlFor={id} error={error} hint={ayuda}>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined} aria-invalid={error ? true : undefined}
        className={inputClass} />
    </Field>
  );
}
