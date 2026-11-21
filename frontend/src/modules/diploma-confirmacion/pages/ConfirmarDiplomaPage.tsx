import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/**
 * La confirmación de los datos del diploma (#768), la que se abre desde el
 * correo que recibe el alumno al terminar su formación.
 *
 * SIN CONTRASEÑA y fuera del CRM, con la marca de su campus, como el formulario
 * de datos fiscales (#764). El enlace es la llave: firmado, de un solo uso y con
 * caducidad. Enseña los datos con los que saldrá el diploma —para eso sirve—,
 * con el documento tapado salvo los últimos caracteres: si está mal, se escribe
 * entero otra vez.
 *
 * El alumno corrige su nombre y su documento. Curso, horas y fecha no los
 * cambia él: si algo no cuadra, lo dice en el comentario y lo revisa su centro.
 *
 * Lo que vale y lo que no lo decide el servidor (las mismas reglas que «Editar»
 * en Diplomas); aquí solo se ayuda a rellenar.
 */

const API_BASE = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '') + '/api';

/** El mismo texto que da el servidor (`ENLACE_NO_VALE`) para un enlace que no vale. */
const ENLACE_NO_VALIDO = 'Este enlace ya no es válido: o ya se usó, o ha caducado. Si necesitas cambiar tus datos, escribe a tu centro.';

/**
 * La forma de un enlace nuestro (`tokenBienFirmado` del servidor): 32 + «.» + 22
 * caracteres base64url. La firma la comprueba el servidor; aquí solo se evita
 * preguntar por algo que no puede ser un enlace.
 */
const tokenConForma = (t?: string | null) => /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{22}$/.test(t || '');

type Datos = {
  marca: string | null; logo_url: string | null; color: string | null; fondo?: string | null;
  nombre: string | null; documento: string | null; tiene_documento: boolean;
  curso: string | null; horas: number | null; fecha: string | null;
  caduca_at: string; intentos_restantes: number;
};

const esHex = (v?: string | null): v is string => /^#[0-9a-f]{6}$/i.test(v || '');

/** Texto blanco u oscuro, el que más se lea sobre ese fondo (el mismo cálculo que la encuesta). */
function tintaSobre(fondo: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(fondo.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luz = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luz + 0.05) >= (luz + 0.05) / (0.0178 + 0.05) ? '#ffffff' : '#1d2530';
}

const fecha = (iso: string | null, conAnio = true) => (iso
  ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', ...(conAnio ? { year: 'numeric' } : {}) })
  : null);

/** La fecha del diploma llega como «AAAA-MM-DD»: el mismo día en cualquier huso. */
const dia = (v: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m
    ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
};

const primerNombre = (n: string | null) => (n || '').trim().split(/\s+/)[0] || null;

export default function ConfirmarDiplomaPage() {
  const { token } = useParams();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<'confirmado' | 'corregido' | null>(null);

  useEffect(() => {
    // Un enlace que no tiene la forma de los nuestros no se pregunta: es «no
    // válido», no un fallo de red. Con un `%2F` el router lo descodifica a «/»,
    // la petición iba a otra ruta, volvía algo que no era JSON y la página decía
    // «vuelve a intentarlo» (QA de /testeo del 18/11).
    if (!tokenConForma(token)) { setError(ENLACE_NO_VALIDO); return; }
    fetch(`${API_BASE}/cd/${encodeURIComponent(token || '')}`)
      .then(async (r) => {
        const cuerpo = await r.json().catch(() => null);
        // Sin JSON: un 4xx es que el enlace no lleva a nada; lo demás, un fallo de verdad.
        if (!cuerpo) {
          if (r.status >= 400 && r.status < 500) return { success: false, error: ENLACE_NO_VALIDO };
          throw new Error('sin respuesta');
        }
        return cuerpo;
      })
      .then((r) => {
        if (!r?.success) { setError(r?.error || ENLACE_NO_VALIDO); return; }
        setDatos(r.data);
        setNombre(r.data.nombre || '');
        // Sin nombre o sin documento no hay nada que confirmar: directamente a corregir.
        if (!r.data.nombre || !r.data.tiene_documento) setCorrigiendo(true);
      })
      .catch(() => setError('No hemos podido cargar tus datos. Vuelve a intentarlo en un rato.'));
  }, [token]);

  const color = esHex(datos?.color) ? datos!.color! : '#1f4e79';
  const fondo = esHex(datos?.fondo) ? datos!.fondo! : '#ffffff';
  const tintaBoton = tintaSobre(color);
  const faltaDocumento = !datos?.tiene_documento && !documento.trim();
  const faltan = corrigiendo && (!nombre.trim() || faltaDocumento);

  async function enviar(accion: 'confirmar' | 'corregir') {
    if (enviando || (accion === 'corregir' && faltan)) return;
    setEnviando(true);
    setAviso(null);
    try {
      const cuerpo = accion === 'confirmar'
        ? { accion, comentario: comentario.trim() || null }
        : { accion, nombre: nombre.trim() || null, documento: documento.trim() || null, comentario: comentario.trim() || null };
      const r = await fetch(`${API_BASE}/cd/${encodeURIComponent(token || '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      }).then((x) => x.json());
      if (!r?.success) {
        // Sin intentos o enlace quemado: ya no hay formulario que enseñar.
        if (['SIN_INTENTOS', 'ENLACE_NO_VALE'].includes(r?.code)) { setDatos(null); setError(r.error); return; }
        throw new Error(r?.error || 'No se ha podido guardar');
      }
      setHecho(r.data?.estado === 'corregido' ? 'corregido' : 'confirmado');
      window.scrollTo(0, 0);
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const recuadro = 'mt-1 block w-full rounded-lg border border-[#d8dee6] bg-white px-3 py-2.5 text-base focus:outline-none focus:ring-2';
  const etiqueta = 'block text-sm font-semibold text-[#1d2530]';
  const anillo = { ['--tw-ring-color' as string]: color };

  const filas: [string, string][] = datos ? [
    ['Nombre completo', datos.nombre || 'Sin nombre'],
    ['Documento de identidad', datos.documento || 'Sin documento'],
    ['Curso', datos.curso || '—'],
    ['Horas', datos.horas ? `${datos.horas} h` : '—'],
    ['Fecha', dia(datos.fecha) || 'La del día en que se emita'],
  ] : [];

  return (
    <div className="min-h-screen bg-[#f4f6f8] px-4 py-10 text-[#1d2530]">
      <main className="mx-auto max-w-lg overflow-hidden rounded-xl bg-white shadow-sm">
        <header className="flex min-h-[76px] items-center px-6 py-4 sm:px-8"
          style={{ background: fondo, borderBottom: `4px solid ${color}`, color: tintaSobre(fondo) }}>
          {datos?.logo_url
            ? <img src={datos.logo_url} alt={datos.marca || ''} className="max-h-12 max-w-[220px]" />
            : datos?.marca && <span className="text-lg font-bold">{datos.marca}</span>}
        </header>
        <div className="p-6 sm:p-8">
          {error && !datos && <p className="text-base leading-relaxed">{error}</p>}
          {!datos && !error && <p className="text-sm text-[#5b6572]">Cargando…</p>}

          {datos && hecho && (
            <div>
              <h1 className="text-xl font-bold">¡Gracias{primerNombre(nombre) ? `, ${primerNombre(nombre)}` : ''}!</h1>
              <p className="mt-2 text-base leading-relaxed text-[#3b4450]">
                {hecho === 'corregido'
                  ? 'Hemos guardado tus datos corregidos. Tu diploma saldrá con ellos.'
                  : 'Has confirmado tus datos. Tu diploma saldrá con ellos.'}
                {' '}Te lo enviaremos por correo en cuanto esté emitido.
              </p>
            </div>
          )}

          {datos && !hecho && (
            <div>
              <h1 className="text-xl font-bold leading-snug">Revisa los datos de tu diploma</h1>
              <p className="mt-2 text-base leading-relaxed text-[#3b4450]">
                ¡Enhorabuena por terminar tu formación! Así saldrá tu diploma. Si está todo bien,
                confírmalo; si tu nombre o tu documento no son correctos, corrígelos.
              </p>

              <dl className="mt-5 divide-y divide-[#eef1f4] rounded-lg border border-[#d8dee6]">
                {filas.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-1 gap-0.5 px-4 py-2.5 sm:grid-cols-[170px_1fr] sm:gap-3">
                    <dt className="text-sm text-[#5b6572]">{k}</dt>
                    <dd className="break-words text-base font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>

              {corrigiendo && (
                <div className="mt-6 space-y-4">
                  <label className={etiqueta}>
                    Nombre completo, tal y como debe salir en el diploma
                    <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={recuadro}
                      style={anillo} autoComplete="name" maxLength={160} />
                  </label>
                  <label className={etiqueta}>
                    Documento de identidad (DNI, NIE o pasaporte)
                    <input value={documento} onChange={(e) => setDocumento(e.target.value)} className={recuadro}
                      style={anillo} maxLength={30} autoCapitalize="characters"
                      placeholder={datos.tiene_documento ? 'Déjalo vacío si el de arriba es correcto' : ''} />
                  </label>
                </div>
              )}

              <label className={`${etiqueta} mt-5`}>
                ¿Algo más no cuadra? (curso, horas o fecha)
                <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2}
                  maxLength={1000} className={recuadro} style={anillo}
                  placeholder="Opcional. Lo revisará tu centro antes de emitir." />
              </label>

              {aviso && (
                <p role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{aviso}</p>
              )}

              {corrigiendo ? (
                <div className="mt-6 space-y-2">
                  <button type="button" onClick={() => enviar('corregir')} disabled={faltan || enviando}
                    className="w-full rounded-lg px-5 py-3 text-base font-bold disabled:opacity-50"
                    style={{ background: color, color: tintaBoton }}>
                    {enviando ? 'Guardando…' : 'Guardar mis datos'}
                  </button>
                  {datos.nombre && datos.tiene_documento && (
                    <button type="button" onClick={() => { setCorrigiendo(false); setAviso(null); }} disabled={enviando}
                      className="w-full rounded-lg border border-[#d8dee6] bg-white px-5 py-3 text-base font-semibold text-[#1d2530]">
                      Están bien, no quiero corregir nada
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-6 space-y-2">
                  <button type="button" onClick={() => enviar('confirmar')} disabled={enviando}
                    className="w-full rounded-lg px-5 py-3 text-base font-bold disabled:opacity-50"
                    style={{ background: color, color: tintaBoton }}>
                    {enviando ? 'Guardando…' : 'Mis datos son correctos'}
                  </button>
                  <button type="button" onClick={() => setCorrigiendo(true)} disabled={enviando}
                    className="w-full rounded-lg border border-[#d8dee6] bg-white px-5 py-3 text-base font-semibold text-[#1d2530]">
                    Corregir mi nombre o mi documento
                  </button>
                </div>
              )}
              <p className="mt-3 text-xs leading-relaxed text-[#5b6572]">
                El enlace es personal y solo sirve una vez. Puedes usarlo hasta el {fecha(datos.caduca_at, false)};
                si no contestas, emitiremos el diploma con estos datos.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
