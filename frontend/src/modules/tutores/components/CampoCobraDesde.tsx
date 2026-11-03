import { cobraDesdeActual, textoCobraDesdeActual } from '../lib/colaboraciones';
import Field from '@/shared/components/ui/Field';
import { inputClass } from '@/shared/lib/ui';

/*
  «Cobra desde» en Editar tutor.

  Diego, 13/10, al abrir «Editar tutor»: «ni me deja poner la fecha de inicio
  del tutor». Carlos queria «colocar fecha de ingreso en el CRM y poder
  cambiarla a más antes para que cuadren». Hasta hoy solo se podia formacion a
  formacion, con «Editar» en cada fila.

  La fecha pasa a TODAS sus colaboraciones activas al guardar. No genera
  comisiones: eso sigue siendo «Calcular», y se dice aqui mismo para que nadie
  espere ver el dinero nada mas guardar.

  Es un campo y no un dialogo aparte: vive dentro del formulario de Editar
  tutor, y el guardado lo hace la pantalla.
*/

const enCastellano = (f: string) => {
  const [a, m, d] = String(f).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : String(f);
};

export default function CampoCobraDesde({
  colabs, valor, onCambio, aplicaDesde,
}: {
  colabs: Array<{ activa: boolean; vigente_desde: string }>;
  valor: string;
  onCambio: (valor: string) => void;
  /** El corte general (`tutor_settings.aplica_desde`). */
  aplicaDesde?: string | null;
}) {
  const actual = cobraDesdeActual(colabs);
  const ahora = textoCobraDesdeActual(actual);
  const sinActivas = !actual.grupos.length;
  const corte = aplicaDesde ? String(aplicaDesde).slice(0, 10) : null;

  // El Field común (#106). Las ayudas van aparte y no en `hint`: son dos, y
  // la primera cambia de color cuando sus formaciones no van a la par.
  return (
    <div className="border-t border-border pt-3">
      <Field label="Cobra desde" htmlFor="tutor-cobra-desde" disabled={sinActivas}
        hint={sinActivas ? 'No tiene formaciones activas: añádele una primero.' : undefined}>
        <input id="tutor-cobra-desde" type="date" value={valor} disabled={sinActivas}
          onChange={(e) => onCambio(e.target.value)}
          className={`${inputClass} tabular-nums disabled:opacity-60 disabled:cursor-not-allowed`} />
      </Field>
      {!sinActivas && (
        <>
          {ahora && (
            <p className={`mt-1 px-1 text-secundario ${actual.distintas ? 'text-warning-soft-foreground font-medium' : 'text-muted-foreground'}`}>
              {ahora}
              {actual.distintas && ' Si cambias la fecha, todas pasan a la misma.'}
            </p>
          )}
          <p className="mt-1 px-1 text-secundario text-muted-foreground">
            {corte && `Las comisiones nunca cuentan antes del ${enCastellano(corte)}. `}
            Cambiar la fecha no toca las comisiones ya generadas; pulsa Calcular en
            Comisiones para añadir las que falten.
          </p>
        </>
      )}
    </div>
  );
}
