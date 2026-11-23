import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/**
 * El formulario de datos fiscales para la factura automática (#452), el que se
 * abre desde el correo del primer pago.
 *
 * SIN CONTRASEÑA y fuera del CRM, con la marca de su campus, como la encuesta
 * de feedback. El enlace es la llave: firmado, de un solo uso y con caducidad.
 * La página no enseña ningún dato guardado —solo la marca y el nombre de pila—
 * para que un enlace reenviado no destape el NIF ni la dirección de nadie.
 *
 * Lo que vale y lo que no lo decide el servidor (la misma regla que se aplica
 * a la ficha el día 7); aquí solo se ayuda a rellenar.
 */

const API_BASE = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '') + '/api';

type Formulario = {
  marca: string | null; logo_url: string | null; color: string | null; fondo?: string | null;
  nombre: string | null; caduca_at: string; intentos_restantes: number;
};
type Datos = {
  tipo: 'particular' | 'empresa'; nombre: string; nif: string; direccion: string;
  codigo_postal: string; ciudad: string; pais: string; email: string;
};

const VACIO: Datos = {
  tipo: 'particular', nombre: '', nif: '', direccion: '', codigo_postal: '', ciudad: '', pais: 'España', email: '',
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

const esEspana = (p: string) => /^(espa[ñn]a|spain|es)$/i.test(p.trim());

export default function DatosFiscalesPage() {
  const { token } = useParams();
  const [form, setForm] = useState<Formulario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [d, setD] = useState<Datos>(VACIO);
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/fd/${token}`)
      .then((r) => r.json())
      .then((r) => { if (r?.success) setForm(r.data); else setError(r?.error || 'Este enlace no es válido.'); })
      .catch(() => setError('No hemos podido cargar el formulario. Vuelve a intentarlo en un rato.'));
  }, [token]);

  const color = esHex(form?.color) ? form!.color! : '#1f4e79';
  const fondo = esHex(form?.fondo) ? form!.fondo! : '#ffffff';
  const tintaBoton = tintaSobre(color);
  const poner = (k: keyof Datos, v: string) => setD((x) => ({ ...x, [k]: v }));
  const empresa = d.tipo === 'empresa';
  const espana = esEspana(d.pais);
  const faltan = !d.nombre.trim() || !d.nif.trim() || !d.direccion.trim() || !d.ciudad.trim()
    || !d.pais.trim() || !d.email.trim() || (espana && !d.codigo_postal.trim());

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (faltan || enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await fetch(`${API_BASE}/fd/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      }).then((x) => x.json());
      if (!r?.success) {
        // Sin intentos o enlace quemado: ya no hay formulario que enseñar.
        if (['SIN_INTENTOS', 'ENLACE_NO_VALE'].includes(r?.code)) { setForm(null); setError(r.error); return; }
        throw new Error(r?.error || 'No se ha podido guardar');
      }
      setHecho(true);
      window.scrollTo(0, 0);
    } catch (err) {
      setAviso((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const recuadro = 'mt-1 block w-full rounded-lg border border-[#d8dee6] bg-white px-3 py-2.5 text-base focus:outline-none focus:ring-2';
  const etiqueta = 'block text-sm font-semibold text-[#1d2530]';
  const campo = (k: keyof Datos, texto: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className={etiqueta}>
      {texto}
      <input value={d[k]} onChange={(e) => poner(k, e.target.value)} className={recuadro}
        style={{ ['--tw-ring-color' as string]: color }} {...extra} />
    </label>
  );

  return (
    <div className="min-h-screen bg-[#f4f6f8] px-4 py-10 text-[#1d2530]">
      <main className="mx-auto max-w-lg overflow-hidden rounded-xl bg-white shadow-sm">
        <header className="flex min-h-[76px] items-center px-6 py-4 sm:px-8"
          style={{ background: fondo, borderBottom: `4px solid ${color}`, color: tintaSobre(fondo) }}>
          {form?.logo_url
            ? <img src={form.logo_url} alt={form.marca || ''} className="max-h-12 max-w-[220px]" />
            : form?.marca && <span className="text-lg font-bold">{form.marca}</span>}
        </header>
        <div className="p-6 sm:p-8">
          {error && !form && <p className="text-base leading-relaxed">{error}</p>}
          {!form && !error && <p className="text-sm text-[#5b6572]">Cargando…</p>}

          {form && hecho && (
            <div>
              <h1 className="text-xl font-bold">¡Gracias{form.nombre ? `, ${form.nombre}` : ''}!</h1>
              <p className="mt-2 text-base leading-relaxed text-[#3b4450]">
                Hemos guardado tus datos. Te mandaremos la factura a <strong>{d.email}</strong>.
              </p>
            </div>
          )}

          {form && !hecho && (
            <form onSubmit={enviar} noValidate>
              <h1 className="text-xl font-bold leading-snug">
                {form.nombre ? `${form.nombre}, tus` : 'Tus'} datos para la factura
              </h1>
              <p className="mt-2 text-base leading-relaxed text-[#3b4450]">
                Hemos recibido tu pago. Dinos a nombre de quién hacemos la factura; con estos datos
                haremos también la de tus próximas cuotas.
              </p>

              <fieldset className="mt-6">
                <legend className={etiqueta}>La factura va a nombre de</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(['particular', 'empresa'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => poner('tipo', t)}
                      className="rounded-lg border px-3 py-2.5 text-base font-semibold"
                      style={d.tipo === t
                        ? { borderColor: color, background: color, color: tintaBoton }
                        : { borderColor: '#d8dee6', background: '#ffffff', color: '#1d2530' }}>
                      {t === 'particular' ? 'Mí, a título personal' : 'Una empresa'}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="mt-5 space-y-4">
                {campo('nombre', empresa ? 'Razón social' : 'Nombre y apellidos', { autoComplete: empresa ? 'organization' : 'name', maxLength: 200 })}
                {campo('nif', espana ? (empresa ? 'CIF' : 'NIF o NIE') : 'Identificación fiscal (RFC, RUT, CUIT, DNI…)', { maxLength: 50, autoCapitalize: 'characters' })}
                {campo('direccion', 'Dirección', { autoComplete: 'street-address', maxLength: 300 })}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[140px_1fr]">
                  {campo('codigo_postal', espana ? 'Código postal' : 'Código postal (si tiene)', { autoComplete: 'postal-code', maxLength: 20, inputMode: espana ? 'numeric' : 'text' })}
                  {campo('ciudad', 'Ciudad', { autoComplete: 'address-level2', maxLength: 120 })}
                </div>
                {campo('pais', 'País', { autoComplete: 'country-name', maxLength: 80 })}
                {campo('email', 'Correo al que te mandamos la factura', { type: 'email', autoComplete: 'email', maxLength: 255 })}
              </div>

              {aviso && (
                <p role="alert" className="mt-5 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{aviso}</p>
              )}

              <button type="submit" disabled={faltan || enviando}
                className="mt-6 w-full rounded-lg px-5 py-3 text-base font-bold disabled:opacity-50"
                style={{ background: color, color: tintaBoton }}>
                {enviando ? 'Guardando…' : 'Guardar mis datos'}
              </button>
              <p className="mt-3 text-xs leading-relaxed text-[#5b6572]">
                El enlace es personal y solo sirve una vez. Solo usamos estos datos para tu factura.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
