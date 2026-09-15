import { useState, useEffect } from 'react';
import { CaretDown, CaretUp, ShieldWarning, CheckCircle, XCircle } from '@phosphor-icons/react';

// Aviso de uso para las gestoras, arriba del todo.
//
// No es burocracia: WhatsApp suspende números por escribir en masa o por
// acumular bloqueos, y el número que se pierde es el suyo, con sus
// conversaciones dentro. Prefiero que lo lean una vez a explicarlo después.
//
// Se pliega y se recuerda plegado, pero NO se puede cerrar del todo: la línea
// de arriba queda siempre visible. Un aviso que se puede hacer desaparecer para
// siempre acaba sin leerse nunca.

const CLAVE = 'crm.whatsapp.aviso-plegado';

const HACER = [
  'Escribe a quien está arriba de la cola: primero quien nunca ha recibido nada.',
  'Cambia algo de la plantilla antes de enviar. Cien mensajes idénticos es justo lo que WhatsApp detecta.',
  '«Copiar y abrir» deja el contacto anotado en la ficha. No hace falta apuntarlo aparte.',
  'Si no te contestan, espera. Insistir el mismo día no acelera nada y molesta.',
];

const NO_HACER = [
  'No mandes el mismo texto tal cual a mucha gente seguida.',
  'No escribas a quien no ha pedido información.',
  'No uses programas de envío masivo con tu número. Para eso está Wasapi.',
  'Si alguien te pide que no le escribas, márcalo como no interesado y déjalo. Que te bloqueen es lo que hace que WhatsApp te suspenda.',
];

export default function AvisoUso() {
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    try { setAbierto(localStorage.getItem(CLAVE) !== '1'); } catch { setAbierto(true); }
  }, []);

  function alternar() {
    const nuevo = !abierto;
    setAbierto(nuevo);
    try { localStorage.setItem(CLAVE, nuevo ? '0' : '1'); } catch { /* sin localStorage se abre siempre */ }
  }

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30">
      <button type="button" onClick={alternar}
        className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <ShieldWarning size={17} weight="fill" className="text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-sm font-semibold text-amber-900 dark:text-amber-200 flex-1">
          Antes de escribir: qué hacer y qué no
        </span>
        <span className="text-xs text-amber-800/70 dark:text-amber-300/70 hidden sm:inline">
          tu número puede ser suspendido
        </span>
        {abierto
          ? <CaretUp size={14} weight="bold" className="text-amber-700 dark:text-amber-400 shrink-0" />
          : <CaretDown size={14} weight="bold" className="text-amber-700 dark:text-amber-400 shrink-0" />}
      </button>

      {abierto && (
        <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400 mb-1">
              Sí
            </p>
            <ul className="space-y-1">
              {HACER.map((t) => (
                <li key={t} className="flex gap-1.5 text-xs text-amber-900 dark:text-amber-200/90 leading-relaxed">
                  <CheckCircle size={13} weight="fill" className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-2 md:mt-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-red-700 dark:text-red-400 mb-1">
              No
            </p>
            <ul className="space-y-1">
              {NO_HACER.map((t) => (
                <li key={t} className="flex gap-1.5 text-xs text-amber-900 dark:text-amber-200/90 leading-relaxed">
                  <XCircle size={13} weight="fill" className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
