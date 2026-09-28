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
 * nombre de su formación ya puesto. Esta pantalla solo sabe
 * pintar cuatro tipos: una opción, varias, una escala de 1 a 5 y texto. Cambiar
 * o añadir preguntas no la toca.
 *
 * `?vista=1` es la copia que recibe la gestora cuando pide «quiero verlo»: se
 * ve igual, pero no guarda nada. Si contestara ella, la respuesta sería de la
 * persona equivocada.
 */

const API_BASE = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '') + '/api';

type Opcion = { clave: string; texto: string };
type Pregunta = {
  clave: string; tipo: 'unica' | 'varias' | 'escala' | 'texto';
  texto: string; ayuda?: string; obligatoria?: boolean; opciones?: Opcion[];
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
  const alternar = (clave: string, opcion: string) => setResp((r) => {
    const antes = Array.isArray(r[clave]) ? (r[clave] as string[]) : [];
    return { ...r, [clave]: antes.includes(opcion) ? antes.filter((x) => x !== opcion) : [...antes, opcion] };
  });

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

  const caja = 'flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-base transition-colors';
  const estiloCaja = (elegido: boolean) => ({ borderColor: elegido ? color : '#d8dee6', background: elegido ? `${color}12` : '#fff' });

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
                  ? <>Nos pediste información sobre <strong>{datos.programa}</strong> y no seguiste adelante. Son dos minutos, y solo la primera es obligatoria.</>
                  : 'Son dos minutos, y solo la primera es obligatoria.'}
              </p>

              <div className="mt-6 space-y-7">
                {datos.preguntas.map((p, i) => (
                  <fieldset key={p.clave}>
                    <legend className="text-base font-semibold leading-snug">
                      <span className="mr-1 text-[#8a939e]">{i + 1}.</span> {p.texto}
                      {p.obligatoria && <span className="ml-1" style={{ color }} aria-label="obligatoria">*</span>}
                    </legend>
                    {p.ayuda && <p className="mt-0.5 text-sm text-[#5b6572]">{p.ayuda}</p>}

                    {p.tipo === 'unica' && (
                      <div className="mt-3 space-y-2">
                        {(p.opciones || []).map((o) => {
                          const elegido = resp[p.clave] === o.clave;
                          return (
                            <label key={o.clave} className={caja} style={estiloCaja(elegido)}>
                              <input type="radio" name={p.clave} value={o.clave} checked={elegido}
                                onChange={() => poner(p.clave, o.clave)} className="h-4 w-4" style={{ accentColor: color }} />
                              {o.texto}
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {p.tipo === 'varias' && (
                      <div className="mt-3 space-y-2">
                        {(p.opciones || []).map((o) => {
                          const elegido = Array.isArray(resp[p.clave]) && (resp[p.clave] as string[]).includes(o.clave);
                          return (
                            <label key={o.clave} className={caja} style={estiloCaja(elegido)}>
                              <input type="checkbox" checked={elegido} onChange={() => alternar(p.clave, o.clave)}
                                className="h-4 w-4" style={{ accentColor: color }} />
                              {o.texto}
                            </label>
                          );
                        })}
                      </div>
                    )}

                    {p.tipo === 'escala' && (
                      <div className="mt-3 grid grid-cols-5 gap-2" role="radiogroup" aria-label={p.texto}>
                        {[1, 2, 3, 4, 5].map((n) => {
                          const elegido = resp[p.clave] === n;
                          return (
                            <button key={n} type="button" role="radio" aria-checked={elegido} onClick={() => poner(p.clave, n)}
                              className="h-12 rounded-lg border text-lg font-bold transition-colors"
                              style={{ borderColor: elegido ? color : '#d8dee6', background: elegido ? color : '#fff', color: elegido ? '#fff' : '#1d2530' }}>
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {p.tipo === 'texto' && (
                      <textarea value={(resp[p.clave] as string) || ''} onChange={(e) => poner(p.clave, e.target.value)}
                        maxLength={1000} rows={3} aria-label={p.texto}
                        className="mt-3 w-full rounded-lg border border-[#d8dee6] px-3 py-2 text-base focus:outline-none focus:ring-2" />
                    )}
                  </fieldset>
                ))}
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
