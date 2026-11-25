import Field from '@/shared/components/ui/Field';
import FilaCampos from '@/shared/components/ui/FilaCampos';
import { inputClass } from '@/shared/lib/ui';

/*
  LOS DATOS FISCALES DE LA PERSONA, EN LA VENTA (Diego, 25/11).

  La gestora los carga al registrar la venta si no llegaron ya por la solicitud
  de admisión (entonces salen rellenos, de la ficha). Van a la ficha del alumno
  junto con la venta, antes de que el primer cobro llegue a la factura
  automática: con ellos completos no se le pide el formulario al alumno y, en
  «Por enviar» (ISEIE), administración los verifica en Facturación antes de
  mandar la factura.
*/

export interface DatosFiscalesEnVenta {
  nif: string;
  direccion: string;
  codigo_postal: string;
  ciudad: string;
  pais: string;
}

export const DATOS_FISCALES_VACIOS: DatosFiscalesEnVenta = { nif: '', direccion: '', codigo_postal: '', ciudad: '', pais: '' };

/** Lo que trae la ficha (GET /leads/:id), con los nombres de la venta. */
export function deLaFicha(l: Record<string, unknown> | null | undefined): DatosFiscalesEnVenta {
  const t = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    nif: t(l?.identificacion_fiscal),
    direccion: t(l?.direccion_fiscal),
    codigo_postal: t(l?.codigo_postal_fiscal),
    ciudad: t(l?.ciudad_fiscal),
    pais: t(l?.pais_fiscal),
  };
}

/** Los que faltan para facturar (el servidor vuelve a mirarlo, con el NIF de verdad). */
export function faltanDatosFiscales(d: DatosFiscalesEnVenta): string[] {
  const f: string[] = [];
  if (!d.nif.trim()) f.push('el documento (NIF/DNI/pasaporte)');
  if (d.direccion.trim().length < 5) f.push('la dirección');
  if (!d.ciudad.trim()) f.push('la ciudad');
  if (!d.pais.trim()) f.push('el país');
  if (/^(es|españa|espana|spain)$/i.test(d.pais.trim()) && !/^\d{5}$/.test(d.codigo_postal.trim())) f.push('el código postal');
  return f;
}

/** Lo que va al servidor: solo lo escrito (lo vacío no pisa la ficha). */
export function aDatosFiscales(d: DatosFiscalesEnVenta): Partial<DatosFiscalesEnVenta> | undefined {
  const o = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
  return Object.keys(o).length ? o : undefined;
}

interface Props {
  value: DatosFiscalesEnVenta;
  onChange: (v: DatosFiscalesEnVenta) => void;
  idBase: string;
  /** En «Por enviar» con cobro: son obligatorios (se marca lo que falta). */
  obligatorios?: boolean;
}

export default function DatosFiscalesVenta({ value, onChange, idBase, obligatorios = false }: Props) {
  const set = (k: keyof DatosFiscalesEnVenta) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  const faltan = obligatorios ? faltanDatosFiscales(value) : [];
  const etiqueta = (t: string) => (obligatorios ? `${t} *` : t);
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3" aria-describedby={`${idBase}-ayuda`}>
      <legend className="px-1 text-sm font-semibold">Datos de la persona para la factura</legend>
      <p id={`${idBase}-ayuda`} className="text-xs text-muted-foreground">
        Si llegaron por la solicitud de admisión ya salen rellenos. Si no, cárgalos: con ellos
        administración verifica y envía la factura desde Facturación.
      </p>
      <Field label={etiqueta('Documento (NIF / DNI / pasaporte)')} htmlFor={`${idBase}-nif`}>
        <input id={`${idBase}-nif`} autoComplete="off" maxLength={50} className={inputClass}
          value={value.nif} onChange={set('nif')} />
      </Field>
      <Field label={etiqueta('Dirección')} htmlFor={`${idBase}-direccion`}>
        <input id={`${idBase}-direccion`} autoComplete="off" maxLength={300} className={inputClass}
          value={value.direccion} onChange={set('direccion')} placeholder="Calle, número, piso" />
      </Field>
      <FilaCampos>
        <Field label="Código postal" htmlFor={`${idBase}-cp`}>
          <input id={`${idBase}-cp`} autoComplete="off" maxLength={20} className={inputClass}
            value={value.codigo_postal} onChange={set('codigo_postal')} />
        </Field>
        <Field label={etiqueta('Ciudad')} htmlFor={`${idBase}-ciudad`}>
          <input id={`${idBase}-ciudad`} autoComplete="off" maxLength={120} className={inputClass}
            value={value.ciudad} onChange={set('ciudad')} />
        </Field>
        <Field label={etiqueta('País')} htmlFor={`${idBase}-pais`}>
          <input id={`${idBase}-pais`} autoComplete="off" maxLength={80} className={inputClass}
            value={value.pais} onChange={set('pais')} />
        </Field>
      </FilaCampos>
      {faltan.length > 0 && (
        <p role="status" className="text-xs text-warning-soft-foreground">Falta {faltan.join(', ')}.</p>
      )}
    </fieldset>
  );
}
