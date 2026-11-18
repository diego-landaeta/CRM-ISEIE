import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { WarningCircle } from '@phosphor-icons/react';
import client from '@/shared/api/client';

/*
  FALTAN NÚMEROS EN LA SERIE.

  Diego, 21/09: «hay que poner una alerta en el dashboard y en facturación,
  cuando hay saltos de facturas, como, faltan por poner x número de factura,
  para que sepan».

  Una serie fiscal no debería tener agujeros: si existe la 126 y la 128 pero no
  la 127, o falta una factura por cargar o alguien numeró a mano saltándose una.
  Es de lo primero que se mira en una revisión, y hasta ahora solo se veía
  dentro del formulario de crear factura — justo donde ya es tarde.

  El servidor ya los calcula: `/invoices/siguiente-numero` devuelve `huecos`.
  Aquí sólo se enseñan, y se enseñan donde se trabaja.
*/

type Anulada = { numero: number; codigo: string | null; motivo: string | null; fecha: string | null };
type Respuesta = { ano: number; serie: string; siguiente: number; codigo: string; huecos: number[]; anuladas?: Anulada[] };

export default function AvisoHuecosFacturas({ projectId }: { projectId?: number | null }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);

  useEffect(() => {
    // Con una empresa puesta el proyecto es el centinela -1 y no hay serie que
    // mirar: mejor no enseñar nada que enseñar un dato de otro sitio.
    if (!projectId || projectId === -1) { setDatos(null); return; }
    let vivo = true;
    client.get<Respuesta>(`/invoices/siguiente-numero?projectId=${projectId}`)
      .then((r) => { if (vivo && r?.success) setDatos(r.data); })
      .catch(() => { /* sin aviso es mejor que un aviso equivocado */ });
    return () => { vivo = false; };
  }, [projectId]);

  // Las ANULADAS (CRM#793) no son un hueco: siguen en la serie con su abono.
  // Se dicen con su motivo para que el número quede explicado.
  const anuladas = datos?.anuladas || [];
  if (!datos || (!datos.huecos?.length && !anuladas.length)) return null;
  if (!datos.huecos?.length) return <ListaDeAnuladas serie={datos.serie} anuladas={anuladas} />;

  const n = datos.huecos.length;
  const lista = datos.huecos
    .map((h) => `${datos.ano}/${String(h).padStart(4, '0')}`)
    .join(' · ');

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 sm:p-4" data-recorrido="facturas-huecos">
      <div className="flex items-start gap-3">
        <WarningCircle size={20} weight="fill" className="text-amber-600 dark:text-amber-400 flex-none mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
            {n === 1
              ? `Falta una factura por emitir en la serie ${datos.serie}`
              : `Faltan ${n} facturas por emitir en la serie ${datos.serie}`}
          </p>
          <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
            No existen estos números: <b className="tabular-nums break-words">{lista}</b>
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1.5">
            Una serie fiscal no debería tener huecos. O falta cargar esas facturas,
            o alguien numeró a mano saltándose un número, o se borraron cuando aún se
            podía. Desde el 18/11 una factura emitida no se borra: se anula con su motivo.
          </p>
          {anuladas.length > 0 && <ListaDeAnuladas serie={datos.serie} anuladas={anuladas} dentro />}
          <Link to="/accounting/facturas/nueva"
            className="inline-flex items-center mt-2 h-7 px-2.5 rounded border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40">
            Emitir la que falta
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Las anuladas de la serie, con su motivo: su número está, no es un hueco. */
function ListaDeAnuladas({ serie, anuladas, dentro = false }: { serie: string; anuladas: Anulada[]; dentro?: boolean }) {
  const lista = (
    <ul className="mt-1 space-y-0.5 text-xs">
      {anuladas.map((a) => (
        <li key={a.numero} className="break-words">
          <b className="tabular-nums">{a.codigo || a.numero}</b> anulada{a.motivo ? `: ${a.motivo}` : ''}
        </li>
      ))}
    </ul>
  );
  if (dentro) {
    return (
      <div className="mt-2 text-warning-soft-foreground">
        <p className="text-xs font-semibold">Y estas están anuladas (no son huecos: tienen su abono):</p>
        {lista}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 sm:p-4 text-muted-foreground" data-recorrido="facturas-huecos">
      <p className="text-sm font-semibold text-foreground">
        {anuladas.length === 1 ? `Una factura anulada en la serie ${serie}` : `${anuladas.length} facturas anuladas en la serie ${serie}`}
      </p>
      <p className="text-xs mt-0.5">Su número sigue en la serie y su abono la deja a cero.</p>
      {lista}
    </div>
  );
}
