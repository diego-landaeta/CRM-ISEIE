// «Descartar este seguimiento», con su motivo.
//
// Diego, 23/09: «añadir como: descartar este seguimiento, y cuando se descarta
// se irá a la parte de por qué desistió».
//
// QUÉ HACE. Marca a la persona como NO INTERESADA con el motivo que se elija.
// Eso la saca del repaso —la base excluye `no_interesado`— y, sobre todo, la
// mete en el grupo al que va dirigido el correo de «¿por qué desististe?» que
// tiene Ángel entre manos (#169): ese correo sale a quien no compró y no está
// interesado. O sea que descartar aquí NO es tirar a alguien a la basura: es
// pasarlo de «a ver si contesta» a «pregúntale por qué no».
//
// EL MOTIVO ES OBLIGATORIO, y no es un capricho de la pantalla: el servidor lo
// exige al pasar a `no_interesado`. Tiene sentido — una base llena de bajas sin
// motivo no se puede analizar, y es justo lo que el panel de feedback (#170)
// va a querer leer.
//
// POR QUÉ MOTIVOS SUELTOS Y NO UN DESPLEGABLE LARGO. Son los cuatro que se
// repiten en el repaso de fin de mes. El quinto botón abre un campo libre, que
// es donde acaban los casos raros sin obligar a nadie a elegir uno que no es.

import { useState } from 'react';
import { Prohibit, X } from '@phosphor-icons/react';

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
  /** Devuelve el motivo elegido. Quien llama es el que habla con el servidor. */
  onDescartar: (motivo: string) => Promise<void> | void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [otro, setOtro] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);

  async function mandar(motivo: string) {
    const limpio = motivo.trim();
    if (!limpio) return;
    setYendo(true);
    try {
      await onDescartar(limpio);
      setAbierto(false);
      setOtro(null);
    } finally {
      setYendo(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAbierto(true); }}
        title="Sacarlo del repaso y preguntarle por qué desistió"
        aria-label={`Descartar el seguimiento de ${nombre || 'este prospecto'}`}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-warning hover:bg-warning-soft hover:text-warning-soft-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <Prohibit size={14} />
      </button>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-end gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="mr-1 text-[11px] font-semibold text-muted-foreground">¿Por qué?</span>
      {otro === null ? (
        <>
          {MOTIVOS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={yendo}
              onClick={() => mandar(m)}
              className="rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
            >
              {m}
            </button>
          ))}
          <button
            type="button"
            disabled={yendo}
            onClick={() => setOtro('')}
            className="rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
          >
            Otro…
          </button>
        </>
      ) : (
        <>
          <input
            autoFocus
            value={otro}
            onChange={(e) => setOtro(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') mandar(otro); }}
            placeholder="En una línea"
            maxLength={200}
            className="h-7 w-44 rounded-md border border-border bg-card px-2 text-[11px]"
          />
          <button
            type="button"
            disabled={yendo || !otro.trim()}
            onClick={() => mandar(otro)}
            className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            Descartar
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => { setAbierto(false); setOtro(null); }}
        aria-label="Dejarlo como está"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      >
        <X size={12} />
      </button>
    </div>
  );
}
