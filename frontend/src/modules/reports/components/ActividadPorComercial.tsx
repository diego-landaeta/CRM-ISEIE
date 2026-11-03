import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, PhoneCall, ArrowRight } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { ATAJOS } from '@/shared/lib/rangosDeFecha';
import {
  getActividad, getDetalleActividad,
  type Actividad, type FilaActividad, type TipoDeDetalle, type ContactoDeDetalle,
} from '../api/actividadComercial.api';

/*
  «Actividad por comercial» (#203, parte B; comentario de Diego del 27/10).

  Una fila por gestora, ordenada por llamadas: lo primero que se mira por la
  mañana. Los números salen de LA MISMA consulta que contesta Claude (parte A),
  así que la pantalla y Claude no pueden decir cosas distintas. El recorte lo
  hace el servidor: una gestora recibe solo su fila, pida lo que pida.

  «Llamadas registradas en el CRM», no «llamadas»: solo cuentan las apuntadas
  (la issue lo explica; con Zadarma, #137, entrarán solas).
*/

type Ambito = { projectId?: number; issuerId?: number };

// Los cuatro atajos que pide la issue, con «Ayer» por defecto.
const ATAJOS_ACTIVIDAD = ['hoy', 'ayer', 'esta_semana', 'este_mes']
  .map((clave) => ATAJOS.find((a) => a.clave === clave)!);

const rangoDe = (clave: string) => ATAJOS_ACTIVIDAD.find((a) => a.clave === clave)!.calcular(new Date());

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function rotuloDelPeriodo(clave: string, desde: string, hasta: string) {
  const etiqueta = ATAJOS_ACTIVIDAD.find((a) => a.clave === clave)?.etiqueta ?? '';
  return desde === hasta ? `${etiqueta} (${ddmm(desde)})` : `${etiqueta} (${ddmm(desde)}–${ddmm(hasta)})`;
}

const TITULO_DETALLE: Record<TipoDeDetalle, string> = {
  llamada: 'Llamadas registradas',
  whatsapp: 'WhatsApp',
  email: 'Correos',
  nota: 'Notas',
  toques: 'Contactos',
};

const NOMBRE_TIPO: Record<ContactoDeDetalle['tipo'], string> = {
  llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Correo', nota: 'Nota',
};

// La hora en Madrid, que es como se corta el día en el servidor.
const hora = (d: string) => new Date(d).toLocaleString('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

function useActividad(ambito: Ambito, clave: string) {
  const [datos, setDatos] = useState<Actividad | null>(null);
  const [fallo, setFallo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const claveAmbito = JSON.stringify(ambito);
  useEffect(() => {
    let vivo = true;
    const { from, to } = rangoDe(clave);
    setCargando(true);
    setFallo(false);
    getActividad(ambito, from, to)
      .then((d) => { if (vivo) setDatos(d); })
      .catch(() => { if (vivo) setFallo(true); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [claveAmbito, clave]);
  return { datos, fallo, cargando };
}

// Solo quien contactó a alguien. Las notas no son contactos (Diego, 07/10): quien
// solo escribió notas saldría con todo a 0, y quien no hizo nada ya no sale. El
// servidor la manda igual (Claude sí cuenta las notas, aparte); los totales del
// equipo no cambian (prueba de Diana del 30/10).
const conContactos = (filas: FilaActividad[]) =>
  filas.filter((f) => f.toques + f.whatsapp_texto + f.whatsapp_voz > 0);

type Pulsado = { fila: FilaActividad; tipo: TipoDeDetalle };

/** La lista detrás de un número: lead, hora y nota. */
function DetalleActividad({ ambito, datos, pulsado, onClose }: {
  ambito: Ambito; datos: Actividad; pulsado: Pulsado; onClose: () => void;
}) {
  const [filas, setFilas] = useState<ContactoDeDetalle[] | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    getDetalleActividad(ambito, pulsado.fila.user_id!, pulsado.tipo, datos.desde, datos.hasta)
      .then((d) => { if (vivo) setFilas(d); })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [pulsado]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const periodo = datos.desde === datos.hasta ? ddmm(datos.desde) : `${ddmm(datos.desde)}–${ddmm(datos.hasta)}`;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="detalle-actividad-titulo"
        className="bg-card border border-border rounded-xl shadow-dialog w-full max-w-2xl max-h-[86vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div className="min-w-0">
            <h3 id="detalle-actividad-titulo" className="font-semibold">
              {TITULO_DETALLE[pulsado.tipo]} · {pulsado.fila.comercial}
            </h3>
            <p className="text-xs text-muted-foreground">
              {periodo}
              {filas && filas.length >= 500 && ' · las 500 más recientes'}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted flex-shrink-0" aria-label="Cerrar">
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="overflow-auto flex-1">
          {fallo ? (
            <p className="p-6 text-sm text-muted-foreground">No se pudo cargar la lista.</p>
          ) : !filas ? (
            <p className="p-6 text-sm text-muted-foreground">Cargando…</p>
          ) : !filas.length ? (
            <p className="p-6 text-sm text-muted-foreground">No hay registros.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Lead</th>
                  <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Hora</th>
                  {pulsado.tipo === 'toques' && <th className="px-3 py-2 text-left font-medium">Tipo</th>}
                  <th className="px-3 py-2 text-left font-medium">Nota</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 last:border-0 align-top">
                    <td className="px-3 py-2">
                      <Link to={`/leads/${c.lead_id}`} className="text-primary hover:underline">{c.lead}</Link>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">{hora(c.fecha)}</td>
                    {pulsado.tipo === 'toques' && <td className="px-3 py-2 whitespace-nowrap">{NOMBRE_TIPO[c.tipo]}</td>}
                    <td className="px-3 py-2 break-words">{c.nota || <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Un número que abre su lista. Los ceros, en gris y sin enlace. */
function Cifra({ n, onAbrir, etiqueta }: { n: number; onAbrir?: () => void; etiqueta: string }) {
  if (!n) return <span className="text-muted-foreground">0</span>;
  if (!onAbrir) return <span>{n}</span>;
  return (
    <button type="button" onClick={onAbrir} aria-label={etiqueta}
      className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded">
      {n}
    </button>
  );
}

/** El bloque de Reportes, arriba del todo. */
export default function ActividadPorComercial({ ambito }: { ambito: Ambito }) {
  const [clave, setClave] = useState('ayer');
  const { datos, fallo, cargando } = useActividad(ambito, clave);
  const [pulsado, setPulsado] = useState<Pulsado | null>(null);

  const filas = conContactos(datos?.filas ?? []);
  const maxLlamadas = Math.max(1, ...filas.map((f) => f.llamadas));
  const abrir = (fila: FilaActividad, tipo: TipoDeDetalle) => (fila.user_id ? () => setPulsado({ fila, tipo }) : undefined);

  return (
    <section className="bg-card border border-border rounded-lg p-4" aria-labelledby="actividad-comercial-titulo">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 id="actividad-comercial-titulo" className="font-semibold text-base flex items-center gap-2">
            <PhoneCall size={16} /> Actividad por comercial
            {datos && <span className="font-normal text-muted-foreground">· {rotuloDelPeriodo(clave, datos.desde, datos.hasta)}</span>}
          </h2>
          <p className="text-xs text-muted-foreground">
            Contado por quien hizo el contacto, también en fichas de otra, con el día de Madrid.
          </p>
        </div>
        <div className="inline-flex items-center gap-1 flex-wrap" role="group" aria-label="Periodo de la actividad">
          {ATAJOS_ACTIVIDAD.map((a) => (
            <button key={a.clave} type="button" onClick={() => setClave(a.clave)} aria-pressed={clave === a.clave}
              className={
                'h-8 px-2.5 rounded-md border text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 '
                + (clave === a.clave
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground')
              }>
              {a.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {fallo ? (
        <p className="text-sm text-muted-foreground">No se pudo cargar la actividad.</p>
      ) : !datos || (cargando && !datos) ? (
        <div className="h-24 bg-muted/50 rounded-md animate-pulse" />
      ) : !filas.length ? (
        <p className="text-sm text-muted-foreground">Nadie registró actividad en este periodo.</p>
      ) : (
        <div className={'overflow-x-auto' + (cargando ? ' opacity-60' : '')}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Comercial</th>
                <th className="py-2 px-3 font-medium">Llamadas registradas</th>
                <th className="py-2 px-3 font-medium text-right">WhatsApp</th>
                <th className="py-2 px-3 font-medium text-right">Correos</th>
                <th className="py-2 px-3 font-medium text-right">Personas</th>
                <th className="py-2 pl-3 font-medium text-right">Toques</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {filas.map((f) => (
                <tr key={f.user_id ?? 'sin-asignar'} className="border-b border-border/50 last:border-0">
                  <td className={'py-2 pr-3' + (f.user_id ? '' : ' text-muted-foreground')}>{f.comercial}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 text-right">
                        <Cifra n={f.llamadas} onAbrir={abrir(f, 'llamada')} etiqueta={`Llamadas de ${f.comercial}`} />
                      </span>
                      {/* La barra corta junto a las llamadas (idea de Diego del 01/10). */}
                      <span className="h-1.5 w-16 sm:w-24 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                        <span className="block h-full bg-primary rounded-full" style={{ width: `${(f.llamadas / maxLlamadas) * 100}%` }} />
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <Cifra n={f.whatsapp} onAbrir={abrir(f, 'whatsapp')} etiqueta={`WhatsApp de ${f.comercial}`} />
                    {/* Escrito y de voz, de los mensajes que salieron (#128). */}
                    {(f.whatsapp_texto > 0 || f.whatsapp_voz > 0) && (
                      <span className="block text-xs text-muted-foreground whitespace-nowrap">
                        {f.whatsapp_texto} escritos · {f.whatsapp_voz} de voz
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <Cifra n={f.correos} onAbrir={abrir(f, 'email')} etiqueta={`Correos de ${f.comercial}`} />
                  </td>
                  <td className="py-2 px-3 text-right"><Cifra n={f.personas} etiqueta="" /></td>
                  <td className="py-2 pl-3 text-right">
                    <Cifra n={f.toques} onAbrir={abrir(f, 'toques')} etiqueta={`Contactos de ${f.comercial}`} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tabular-nums">
              <tr className="border-t border-border font-semibold">
                <td className="py-2 pr-3">Equipo</td>
                <td className="py-2 px-3"><span className="inline-block w-6 text-right">{datos.equipo.llamadas}</span></td>
                <td className="py-2 px-3 text-right">
                  {datos.equipo.whatsapp}
                  {(datos.equipo.whatsapp_texto > 0 || datos.equipo.whatsapp_voz > 0) && (
                    <span className="block text-xs font-normal text-muted-foreground whitespace-nowrap">
                      {datos.equipo.whatsapp_texto} escritos · {datos.equipo.whatsapp_voz} de voz
                    </span>
                  )}
                </td>
                <td className="py-2 px-3 text-right">{datos.equipo.correos}</td>
                <td className="py-2 px-3 text-right">{datos.equipo.personas}</td>
                <td className="py-2 pl-3 text-right">{datos.equipo.toques}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        <strong className="text-foreground">Llamadas registradas en el CRM:</strong> solo cuentan las apuntadas en el CRM; con
        Zadarma (#137) entrarán solas. Las notas internas no son contactos. «Personas» del equipo no es la suma: dos
        comerciales pueden haber contactado a la misma. Pulsa un número para ver la lista.
      </p>

      {pulsado && datos && (
        <DetalleActividad ambito={ambito} datos={datos} pulsado={pulsado} onClose={() => setPulsado(null)} />
      )}
    </section>
  );
}

/** La tarjeta del Dashboard: las 3 primeras por llamadas y el total del
 *  equipo, con «Ver todo». A una gestora, solo su línea. */
export function TarjetaActividad({ ambito }: { ambito: Ambito }) {
  const { user } = useAuth();
  const veTodo = user?.role === 'admin' || user?.role === 'superadmin';
  const { datos, fallo } = useActividad(ambito, 'ayer');

  // Callada si falla, como «Ayer y hoy»: es un bloque de apoyo.
  if (fallo || !datos) return null;
  const e = datos.equipo;
  const linea = (n: { llamadas: number; whatsapp: number; correos: number }) => (
    `${n.llamadas} ${n.llamadas === 1 ? 'llamada registrada' : 'llamadas registradas'} · ${n.whatsapp} WhatsApp · ${n.correos} ${n.correos === 1 ? 'correo' : 'correos'}`
  );

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-base">Actividad por comercial</h2>
          <p className="text-xs text-muted-foreground">Ayer ({ddmm(datos.desde)})</p>
        </div>
        {veTodo && (
          <Link to="/informes" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline whitespace-nowrap">
            Ver todo <ArrowRight size={12} weight="bold" />
          </Link>
        )}
      </div>
      {veTodo ? (
        <>
          <p className="text-sm font-medium mt-3 tabular-nums">{linea(e)}</p>
          {conContactos(datos.filas).filter((f) => f.user_id).slice(0, 3).map((f) => (
            <p key={f.user_id} className="text-sm mt-1.5 flex flex-wrap justify-between gap-x-3 tabular-nums">
              <span>{f.comercial}</span>
              <span className="text-muted-foreground">{linea(f)}</span>
            </p>
          ))}
          {!conContactos(datos.filas).length && <p className="text-sm text-muted-foreground mt-2">Nadie registró actividad ayer.</p>}
        </>
      ) : (
        <p className="text-sm mt-3 tabular-nums">Ayer: {linea(e)}</p>
      )}
    </div>
  );
}
