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
 * `?vista=1` es la copia que recibe la gestora cuando pide «quiero verlo»: se
 * ve igual, pero no guarda nada. Si contestara ella, la respuesta sería de la
 * persona equivocada.
 */

const API_BASE = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '') + '/api';

type Motivo = { clave: string; texto: string };
type Encuesta = {
  marca: string | null; logo_url: string | null; color: string | null;
  nombre: string; programa: string | null; motivos: Motivo[]; respondida: boolean;
};

export default function FeedbackEncuestaPage() {
  const { token } = useParams();
  const [query] = useSearchParams();
  const vista = query.get('vista') === '1';
  const [datos, setDatos] = useState<Encuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/f/${token}`)
      .then((r) => r.json())
      .then((r) => { if (r?.success) setDatos(r.data); else setError(r?.error || 'Este enlace no es válido.'); })
      .catch(() => setError('No hemos podido cargar la encuesta. Vuelve a intentarlo en un rato.'));
  }, [token]);

  const color = /^#[0-9a-f]{6}$/i.test(datos?.color || '') ? (datos?.color as string) : '#1f4e79';

  async function enviar() {
    if (!motivo || vista) return;
    setEnviando(true);
    try {
      const r = await fetch(`${API_BASE}/f/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo, comentario: comentario.trim() || null }),
      }).then((x) => x.json());
      if (!r?.success) throw new Error(r?.error || 'No se ha podido guardar');
      setHecho(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

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
              {datos.nombre ? `${datos.nombre}, ¿` : '¿'}por qué no seguiste adelante?
            </h1>
            <p className="mt-2 text-base leading-relaxed text-[#3b4450]">
              {datos.programa
                ? <>Nos pediste información sobre <strong>{datos.programa}</strong>. Elige lo que más se parezca a tu caso.</>
                : 'Elige lo que más se parezca a tu caso.'}
            </p>

            <fieldset className="mt-5 space-y-2">
              <legend className="sr-only">Motivo</legend>
              {datos.motivos.map((m) => {
                const elegido = motivo === m.clave;
                return (
                  <label key={m.clave}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-base transition-colors"
                    style={{ borderColor: elegido ? color : '#d8dee6', background: elegido ? `${color}12` : '#fff' }}>
                    <input type="radio" name="motivo" value={m.clave} checked={elegido}
                      onChange={() => setMotivo(m.clave)} className="h-4 w-4" style={{ accentColor: color }} />
                    {m.texto}
                  </label>
                );
              })}
            </fieldset>

            <label className="mt-5 block text-sm font-semibold text-[#3b4450]" htmlFor="comentario">
              ¿Algo más que quieras contarnos? <span className="font-normal text-[#5b6572]">(opcional)</span>
            </label>
            <textarea id="comentario" value={comentario} onChange={(e) => setComentario(e.target.value)}
              maxLength={1000} rows={3}
              className="mt-2 w-full rounded-lg border border-[#d8dee6] px-3 py-2 text-base focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as string]: color }} />

            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

            <button type="button" onClick={enviar} disabled={!motivo || enviando || vista}
              className="mt-5 w-full rounded-lg px-5 py-3 text-base font-bold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: color }}>
              {vista ? 'Vista previa: no se envía' : (enviando ? 'Enviando…' : 'Enviar')}
            </button>
          </div>
        )}
        </div>
      </main>
    </div>
  );
}
