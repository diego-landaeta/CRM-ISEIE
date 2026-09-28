import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

/**
 * La encuesta de «¿por qué has desistido?» (#169), la que se abre desde el
 * correo.
 *
 * SIN CONTRASEÑA y fuera del CRM: la contesta alguien que no compró, y pedirle
 * que entre en algún sitio es garantizar que no conteste nadie. El enlace lleva
 * un token largo y aleatorio que solo sirve para contestar ESTA encuesta.
 *
 * Con la MARCA de su campus —logo y color—: preguntó en esa web y es lo que
 * reconoce. Nada de la estética del CRM.
 *
 * LAS PREGUNTAS LAS MANDA EL SERVIDOR (`modules/feedback/preguntas.js`), con el
 * nombre de su formación y de su asesor ya puestos. Todas van en DESPLEGABLE
 * (Diego, 28/09): una opción, varias o la nota de 1 a 5. La opción marcada como
 * `escribir` («Otro motivo», «Otra cosa») abre un recuadro para escribir.
 * Cambiar o añadir preguntas no toca esta pantalla.
 *
 * `?vista=1` es la copia que recibe la gestora cuando pide «quiero verlo»: se
 * ve igual, pero no guarda nada. Si contestara ella, la respuesta sería de la
 * persona equivocada.
 */

const API_BASE = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '') + '/api';

type Opcion = { clave: string; texto: string };
type Pregunta = {
  clave: string; tipo: 'unica' | 'varias' | 'escala';
  texto: string; ayuda?: string; destacado?: string; obligatoria?: boolean;
  opciones: Opcion[]; escribir?: string;
};
type Encuesta = {
  marca: string | null; logo_url: string | null; color: string | null;
  nombre: string; programa: string | null; preguntas: Pregunta[]; respondida: boolean;
};
type Respuestas = Record<string, string | number | string[]>;

export default function FeedbackEncuestaPage() {
  const { token } = useParams();
  const [query] = useSearchParams();
  const vista = query.get('vista') === '1';
  const [datos, setDatos] = useState<Encuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resp, setResp] = useState<Respuestas>({});
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/f/${token}`)
      .then((r) => r.json())
      .then((r) => { if (r?.success) setDatos(r.data); else setError(r?.error || 'Este enlace no es válido.'); })
      .catch(() => setError('No hemos podido cargar la encuesta. Vuelve a intentarlo en un rato.'));
  }, [token]);

  const color = /^#[0-9a-f]{6}$/i.test(datos?.color || '') ? (datos?.color as string) : '#1f4e79';
  const faltaObligatoria = (datos?.preguntas || []).some((p) => p.obligatoria && !resp[p.clave]);
  const poner = (clave: string, valor: string | number | string[]) => setResp((r) => ({ ...r, [clave]: valor }));
  const quitar = (clave: string) => setResp((r) => {
    const resto = { ...r };
    delete resto[clave];
    return resto;
  });
  const alternar = (clave: string, opcion: string) => setResp((r) => {
    const antes = Array.isArray(r[clave]) ? (r[clave] as string[]) : [];
    return { ...r, [clave]: antes.includes(opcion) ? antes.filter((x) => x !== opcion) : [...antes, opcion] };
  });
  const eligioOtro = (p: Pregunta) => Boolean(p.escribir) && [resp[p.clave]].flat().includes(p.escribir as string);

  async function enviar() {
    if (faltaObligatoria || vista) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/f/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respuestas: resp }),
      }).then((x) => x.json());
      if (!r?.success) throw new Error(r?.error || 'No se ha podido guardar');
      setHecho(true);
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  // El desplegable: nativo (en el móvil abre el selector del sistema), con la
  // flecha dibujada para que se vea igual en todos.
  const desplegable = 'block w-full cursor-pointer appearance-none rounded-lg border bg-white py-3 pl-4 pr-10 text-left text-base focus:outline-none focus:ring-2';
  const borde = (elegido: boolean) => ({ borderColor: elegido ? color : '#d8dee6' });
  const flecha = (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#5b6572]">
      <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <div className="min-h-screen bg-[#f4f6f8] px-4 py-10 text-[#1d2530]">
      <main className="mx-auto max-w-lg overflow-hidden rounded-xl bg-white shadow-sm">
        {/* La marca en una banda de su color: muchas guardan la version CLARA del
            logo (la de la cabecera oscura de su web) y sobre blanco no se ve. */}
        <header className="flex items-center gap-3 px-6 py-4 text-white sm:px-8" style={{ background: color }}>
          {datos?.logo_url && <img src={datos.logo_url} alt="" className="max-h-10 max-w-[160px]" />}
          {datos?.marca && <span className="text-lg font-bold">{datos.marca}</span>}
        </header>
        <div className="p-6 sm:p-8">
          {vista && (
            <p className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Vista previa: así la verá la persona. Lo que marques aquí no se guarda.
            </p>
          )}
          {error && !datos && <p className="text-base">{error}</p>}
          {!datos && !error && <p className="text-sm text-[#5b6572]">Cargando…</p>}

          {datos && (datos.respondida || hecho) && (
            <div>
              <h1 className="text-xl font-bold">¡Gracias{datos.nombre ? `, ${datos.nombre}` : ''}!</h1>
              <p className="mt-2 text-base leading-relaxed text-[#3b4450]">
                {hecho ? 'Nos lo apuntamos: nos ayuda de verdad a mejorar.' : 'Ya nos habías contestado. Nos sirve mucho.'}
              </p>
            </div>
          )}

          {datos && !datos.respondida && !hecho && (
            <div>
              <h1 className="text-xl font-bold leading-snug">
                {datos.nombre ? `${datos.nombre}, ¿nos` : '¿Nos'} ayudas con unas preguntas?
              </h1>
              <p className="mt-2 text-base leading-relaxed text-[#3b4450]">
                {datos.programa
                  ? <>Nos pediste información sobre <strong>{datos.programa}</strong> y no seguiste adelante. Es un minuto, y solo la primera es obligatoria.</>
                  : 'Es un minuto, y solo la primera es obligatoria.'}
              </p>

              <div className="mt-6 space-y-6">
                {datos.preguntas.map((p, i) => {
                  const id = `p-${p.clave}`;
                  const elegidas = Array.isArray(resp[p.clave]) ? (resp[p.clave] as string[]) : [];
                  return (
                    <div key={p.clave}>
                      <label htmlFor={id} className="block text-base font-semibold leading-snug">
                        <span className="mr-1 text-[#8a939e]">{i + 1}.</span> {p.texto}
                        {p.obligatoria && <span className="ml-1" style={{ color }} aria-label="obligatoria">*</span>}
                      </label>
                      {p.destacado && <p className="mt-1 text-sm font-semibold" style={{ color }}>{p.destacado}</p>}
                      {p.ayuda && <p className="mt-0.5 text-sm text-[#5b6572]">{p.ayuda}</p>}

                      {(p.tipo === 'unica' || p.tipo === 'escala') && (
                        <div className="relative mt-2">
                          <select id={id} value={resp[p.clave] === undefined ? '' : String(resp[p.clave])}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (!v) quitar(p.clave);
                              else poner(p.clave, p.tipo === 'escala' ? Number(v) : v);
                            }}
                            className={desplegable} style={borde(resp[p.clave] !== undefined)}>
                            <option value="">Elige una opción</option>
                            {p.opciones.map((o) => (
                              <option key={o.clave} value={o.clave}>{p.tipo === 'escala' ? `${o.clave} · ${o.texto}` : o.texto}</option>
                            ))}
                          </select>
                          {flecha}
                        </div>
                      )}

                      {/* Varias: un desplegable que al abrirse deja marcar las que quiera. */}
                      {p.tipo === 'varias' && (
                        <details className="mt-2">
                          <summary id={id} className={`relative ${desplegable} list-none [&::-webkit-details-marker]:hidden`} style={borde(elegidas.length > 0)}>
                            <span className={elegidas.length ? '' : 'text-[#5b6572]'}>
                              {elegidas.length
                                ? p.opciones.filter((o) => elegidas.includes(o.clave)).map((o) => o.texto).join(', ')
                                : 'Elige una o varias'}
                            </span>
                            {flecha}
                          </summary>
                          <div className="mt-1 space-y-0.5 rounded-lg border border-[#d8dee6] bg-white p-2 shadow-sm">
                            {p.opciones.map((o) => (
                              <label key={o.clave} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-base hover:bg-[#f4f6f8]">
                                <input type="checkbox" checked={elegidas.includes(o.clave)} onChange={() => alternar(p.clave, o.clave)}
                                  className="h-4 w-4" style={{ accentColor: color }} />
                                {o.texto}
                              </label>
                            ))}
                          </div>
                        </details>
                      )}

                      {eligioOtro(p) && (
                        <textarea value={(resp[`${p.clave}_otro`] as string) || ''} onChange={(e) => poner(`${p.clave}_otro`, e.target.value)}
                          maxLength={1000} rows={2} placeholder="Cuéntanos cuál" aria-label={`${p.texto}: escríbelo`}
                          className="mt-2 w-full rounded-lg border border-[#d8dee6] px-3 py-2 text-base focus:outline-none focus:ring-2" />
                      )}
                    </div>
                  );
                })}
              </div>

              {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

              <button type="button" onClick={enviar} disabled={faltaObligatoria || enviando || vista}
                className="mt-7 w-full rounded-lg px-5 py-3 text-base font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: color }}>
                {vista ? 'Vista previa: no se envía' : (enviando ? 'Enviando…' : 'Enviar')}
              </button>
              {faltaObligatoria && !vista && (
                <p className="mt-2 text-center text-sm text-[#5b6572]">Contesta al menos la primera para poder enviarla.</p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
