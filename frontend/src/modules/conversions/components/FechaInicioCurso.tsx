import Field from '@/shared/components/ui/Field';
import { inputClass } from '@/shared/lib/ui';
import { hoyEnMadrid } from '@/shared/lib/fechas';
import type { Falta } from '@/shared/lib/loQueFalta';

/*
  LA FECHA DE INICIO DEL CURSO, AL CERRAR LA VENTA (#767, paso 1).

  Es la que pacta la comercial con el alumno, y con ella se programa la
  matrícula en Moodle: el día anterior, por la mañana. Sin ella, el alumno se
  matricula en cuanto paga, que no es lo que se le ha dicho.

  Obligatoria en los formularios que cierran una venta («Nueva venta» de la
  ficha y «Registrar venta»). Una fecha que ya pasó se deja poner: hay ventas
  de cursos ya empezados. Solo se avisa de que la matrícula irá con el pago.
*/

export const AYUDA_FECHA_INICIO = 'La matrícula en Moodle se hace el día anterior a esta fecha.';
export const AVISO_FECHA_PASADA = 'Esa fecha ya pasó: la matrícula en Moodle se hará en cuanto se confirme el pago.';
export const ERROR_FALTA_FECHA = 'Pon la fecha de inicio pactada con el alumno: con ella se programa su matrícula en Moodle.';

/** El aviso para la lista de «lo que falta», o null si está puesta. */
export function faltaFechaInicio(fecha: string | null | undefined): Falta | null {
  if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  return {
    title: 'Falta la fecha de inicio del curso',
    description: ERROR_FALTA_FECHA,
    que: 'la fecha en «Fecha de inicio del curso»',
  };
}

/** La línea de debajo del campo: el error si falta, el aviso si ya pasó, la ayuda si no. */
export function ayudaFechaInicio(fecha: string, hoy: string = hoyEnMadrid()): string {
  return fecha && fecha < hoy ? AVISO_FECHA_PASADA : AYUDA_FECHA_INICIO;
}

interface Props {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** En «Editar venta» no lo es: las ventas de antes no la tienen. */
  required?: boolean;
  /** Se ha intentado guardar: si falta, el campo lo dice. */
  intentado?: boolean;
  hint?: string;
}

export default function FechaInicioCurso({ id, value, onChange, required = true, intentado = false, hint }: Props) {
  const error = required && intentado && !value ? ERROR_FALTA_FECHA : undefined;
  return (
    <Field label="Fecha de inicio del curso" required={required} htmlFor={id} error={error}
      hint={value ? ayudaFechaInicio(value) : (hint ?? AYUDA_FECHA_INICIO)}>
      <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined} aria-invalid={error ? true : undefined}
        className={inputClass} />
    </Field>
  );
}
