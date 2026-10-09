// «Descartar este seguimiento», con su motivo.
//
// Diego, 23/09: «añadir como: descartar este seguimiento, y cuando se descarta
// se irá a la parte de por qué desistió».
//
// QUÉ HACE. Marca a la persona como NO INTERESADA con el motivo que se elija.
// Eso la saca del repaso —la base excluye `no_interesado`— y le manda el correo
// de «¿por qué has desistido?» (#169). O sea que descartar aquí NO es tirar a
// alguien a la basura: es pasarlo de «a ver si contesta» a «pregúntale por qué
// no».
//
// EL MOTIVO ES OBLIGATORIO, y no es un capricho de la pantalla: el servidor lo
// exige al pasar a `no_interesado`. Una base llena de bajas sin motivo no se
// puede analizar, y es justo lo que el panel de feedback (#170) lee.
//
// UNA VENTANA GRANDE, NO UNOS BOTONCITOS EN LA FILA (Diego, 28/09: «el cuadro
// de confirmación tiene que ser grande»). Descartar manda un correo que no se
// deshace: tiene que verse bien qué se va a hacer, a quién y por qué, antes de
// darle. Todo en un paso: el motivo y la confirmación juntos.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { EnvelopeSimple, Prohibit, X } from '@phosphor-icons/react';

/** Lo que de verdad se contesta cuando alguien lleva meses sin responder. */
const MOTIVOS = [
  'No responde',
  'Ya no le interesa',
  'Precio',
  'Lo deja para más adelante',
];

export default function DescartarDelRepaso({
  nombre,
  onDescartar,
}: {
  nombre: string | null;
  /**
   * Devuelve el motivo elegido y qué hacer con el correo de «¿por qué has
   * desistido?»: mandarlo ya, o prepararlo para verlo antes. Quien llama es
   * el que habla con el servidor.
   */
  onDescartar: (motivo: string, feedback: 'enviar' | 'revisar') => Promise<void> | void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [otro, setOtro] = useState('');
  const [yendo, setYendo] = useState(false);

  const elegido = motivo === 'otro' ? otro.trim() : motivo;
  const quien = nombre || 'esta persona';

  function cerrar() {
    if (yendo) return;
    setAbierto(false);
    setMotivo(null);
    setOtro('');
  }

  // Escape cierra, como cualquier ventana.
  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmar(feedback: 'enviar' | 'revisar') {
    if (!elegido) return;
    setYendo(true);
    try {
      await onDescartar(elegido, feedback);
      setAbierto(false);
      setMotivo(null);
      setOtro('');
    } finally {
      setYendo(false);
    }
  }

  const boton = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setAbierto(true); }}
      title="Sacarlo del repaso y preguntarle por qué desistió"
      aria-label={`Descartar el seguimiento de ${quien}`}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-warning hover:bg-warning-soft hover:text-warning-soft-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
    >
      <Prohibit size={14} />
    </button>
  );

  if (!abierto) return boton;

  const eleccion = (activo: boolean) => `rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors disabled:opacity-50 ${
    activo ? 'border-primary bg-primary/10 text-foreground ring-2 ring-primary/30' : 'border-border bg-card hover:bg-muted'
  }`;

  return (
    <>
      {boton}
      {createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
          onClick={(e) => { e.stopPropagation(); cerrar(); }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="descartar-titulo"
            className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-card shadow-xl sm:max-w-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-warning">Descartar el seguimiento</p>
                <h2 id="descartar-titulo" className="mt-1 text-xl font-bold leading-snug">{quien}</h2>
              </div>
              <button type="button" onClick={cerrar} aria-label="Cancelar"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X size={18} /></button>
            </div>

            <div className="space-y-5 px-6 py-5">

              <fieldset>
                <legend className="text-sm font-semibold">¿Por qué se descarta?</legend>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {MOTIVOS.map((m) => (
                    <button key={m} type="button" disabled={yendo} aria-pressed={motivo === m}
                      onClick={() => setMotivo(m)} className={eleccion(motivo === m)}>
                      {m}
                    </button>
                  ))}
                  <button type="button" disabled={yendo} aria-pressed={motivo === 'otro'}
                    onClick={() => setMotivo('otro')} className={`${eleccion(motivo === 'otro')} sm:col-span-2`}>
                    Otro motivo…
                  </button>
                </div>
                {motivo === 'otro' && (
                  <input autoFocus value={otro} onChange={(e) => setOtro(e.target.value)} maxLength={200}
                    onKeyDown={(e) => { if (e.key === 'Enter' && otro.trim()) confirmar('enviar'); }}
                    placeholder="Escríbelo en una línea" aria-label="Otro motivo"
                    className="mt-2 h-11 w-full rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                )}
              </fieldset>
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:justify-end">
              <button type="button" disabled={yendo} onClick={cerrar}
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" disabled={yendo || !elegido} onClick={() => confirmar('enviar')}
                className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50">
                {yendo ? 'Descartando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
