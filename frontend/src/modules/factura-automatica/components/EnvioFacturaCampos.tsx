import { useState } from 'react';
import { CheckCircle, PencilSimple, PaperPlaneTilt } from '@phosphor-icons/react';
import { inputClass } from '@/shared/lib/ui';
import type { EnvioFactura } from '../api/facturaAutomatica.api';

/*
  «ENVIAR FACTURA AUTOMÁTICAMENTE: SÍ / NO» Y «ENVIAR A ESTE CORREO» (#764, 24/11).

  Diego, al encender la facturación automática en producción:
    · Sí de serie: la factura sale sola y el CRM le manda el PDF al alumno.
    · No: la factura la envía la gestora. Se emite igual, sin mandar el PDF, y
      lleva «No se envía automáticamente: la envía la gestora».
    · El correo del alumno ya relleno, con «Confirmar» o «Editar». El
      formulario de datos fiscales y el PDF van a ese correo.

  El mismo bloque en el alta de la venta (las dos), en el link de pago, en la
  ficha de la venta y en la cola. Controlado: quien lo usa guarda el valor.
*/

export const NOTA_LA_ENVIA_LA_GESTORA = 'No se envía automáticamente: la envía la gestora';

export type EnvioEnEdicion = {
  auto: boolean;
  /** El correo escrito; null = el de la ficha. */
  email: string | null;
  confirmado: boolean;
  editando: boolean;
};

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const correoValido = (e: string | null | undefined) => CORREO.test(String(e || '').trim());

export function envioInicial(emailFicha: string | null | undefined, previo?: Partial<EnvioEnEdicion> | null): EnvioEnEdicion {
  const hay = correoValido(emailFicha) || correoValido(previo?.email);
  return { auto: true, email: null, confirmado: false, editando: !hay, ...(previo || {}) };
}

/** El correo que se enseña: el escrito o el de la ficha. */
export const correoDe = (v: EnvioEnEdicion, emailFicha: string | null | undefined) =>
  (v.email ?? emailFicha ?? '').trim();

/** Lo que va al servidor. */
export function aEnvioFactura(v: EnvioEnEdicion, emailFicha: string | null | undefined): EnvioFactura {
  const email = correoDe(v, emailFicha);
  return { auto: v.auto, email: correoValido(email) ? email.toLowerCase() : null };
}

/** ¿Falta confirmar el correo? (con `sinCorreoVale`, un link sin prospecto puede ir sin él) */
export function faltaConfirmar(v: EnvioEnEdicion, emailFicha: string | null | undefined, sinCorreoVale = false) {
  if (sinCorreoVale && !correoDe(v, emailFicha)) return false;
  return !v.confirmado || v.editando;
}

export const SIN_CORREO_VENTA = 'Sin correo: el formulario no puede salir; la factura se hará con su ficha a los 7 días o desde la cola';
export const SIN_CORREO_LINK = 'Sin correo: irá al que escriba el alumno al pagar';

export default function EnvioFacturaCampos({
  value, onChange, emailFicha, sinCorreoVale = false, textoSinCorreo = SIN_CORREO_VENTA, idBase = 'envio-factura', compacto = false,
}: {
  value: EnvioEnEdicion;
  onChange: (v: EnvioEnEdicion) => void;
  emailFicha: string | null | undefined;
  /** Se puede seguir sin correo (ficha sin él, o link sin prospecto). */
  sinCorreoVale?: boolean;
  /** Lo que se lee cuando no hay correo. */
  textoSinCorreo?: string;
  idBase?: string;
  compacto?: boolean;
}) {
  const [borrador, setBorrador] = useState(() => correoDe(value, emailFicha));
  const [error, setError] = useState<string | null>(null);
  const correo = correoDe(value, emailFicha);

  function confirmar() {
    const e = (value.editando ? borrador : correo).trim();
    if (!e && sinCorreoVale) { onChange({ ...value, email: null, editando: false, confirmado: true }); setError(null); return; }
    if (!correoValido(e)) { setError('Escribe un correo válido (nombre@dominio.com).'); return; }
    setError(null);
    onChange({ ...value, email: e.toLowerCase(), editando: false, confirmado: true });
  }
  function editar() {
    setBorrador(correo);
    onChange({ ...value, editando: true, confirmado: false });
  }

  return (
    <fieldset
      className={`rounded-lg border border-border ${compacto ? 'p-2.5' : 'p-3'} space-y-2.5 bg-muted/20`}
      data-recorrido="envio-factura"
    >
      <legend className="sr-only">Envío de la factura</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${idBase}-auto`} className="text-sm font-semibold inline-flex items-center gap-1.5">
          <PaperPlaneTilt size={14} weight="bold" /> Enviar factura automáticamente
        </span>
        <div role="radiogroup" aria-labelledby={`${idBase}-auto`} className="inline-flex rounded-md border border-border overflow-hidden text-sm font-semibold">
          {([[true, 'Sí'], [false, 'No']] as const).map(([v, t]) => (
            <button key={t} type="button" role="radio" aria-checked={value.auto === v}
              onClick={() => onChange({ ...value, auto: v })}
              className={`h-8 px-4 ${value.auto === v
                ? (v ? 'bg-success-soft text-success-soft-foreground' : 'bg-warning-soft text-warning-soft-foreground')
                : 'bg-card text-muted-foreground hover:bg-muted/50'} ${v ? '' : 'border-l border-border'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">
        {value.auto
          ? 'La factura sale sola cuando el alumno da sus datos fiscales (o a los 7 días con su ficha) y le llega en PDF a este correo.'
          : <><strong className="text-warning-soft-foreground">{NOTA_LA_ENVIA_LA_GESTORA}.</strong> La factura se emite igual, con su número, pero el PDF no sale: se lo mandas tú.</>}
      </p>

      <div className="space-y-1">
        <label htmlFor={`${idBase}-email`} className="block text-[12px] font-semibold">
          Enviar a este correo <span className="font-normal text-muted-foreground">(el formulario de datos fiscales{value.auto ? ' y el PDF' : ''})</span>
        </label>
        {value.editando ? (
          <div className="flex flex-wrap gap-2">
            <input id={`${idBase}-email`} type="email" autoComplete="off" value={borrador}
              onChange={(e) => setBorrador(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } }}
              placeholder="nombre@dominio.com"
              className={`${inputClass} flex-1 min-w-[12rem]`} />
            <button type="button" onClick={confirmar}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center gap-1">
              <CheckCircle size={14} weight="bold" /> Confirmar
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <output id={`${idBase}-email`} className="flex-1 min-w-0 truncate text-sm font-medium">
              {correo || <span className="text-muted-foreground whitespace-normal">{textoSinCorreo}</span>}
            </output>
            {value.confirmado
              ? <span className="text-[11px] font-semibold text-success inline-flex items-center gap-1"><CheckCircle size={12} weight="bold" /> Confirmado</span>
              : (
                <button type="button" onClick={confirmar}
                  className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold inline-flex items-center gap-1">
                  <CheckCircle size={13} weight="bold" /> Confirmar
                </button>
              )}
            <button type="button" onClick={editar}
              className="h-8 px-3 rounded-md border border-border bg-card text-[12px] font-semibold hover:bg-muted inline-flex items-center gap-1">
              <PencilSimple size={13} weight="bold" /> Editar
            </button>
          </div>
        )}
        {value.editando && sinCorreoVale && !borrador.trim() && (
          <p className="text-[11px] text-muted-foreground">{textoSinCorreo}.</p>
        )}
        {error && <p role="alert" className="text-[12px] text-destructive">{error}</p>}
      </div>
    </fieldset>
  );
}
