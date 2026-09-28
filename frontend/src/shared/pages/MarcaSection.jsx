import { useCallback, useEffect, useState } from 'react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

/**
 * La marca en correos y formularios (paridad con «Configurar esta marca» de
 * MultiCRM, Diego 28/09): lo que ven los alumnos en el correo de feedback y en
 * su encuesta.
 *
 *  · Logo y color de marca (el color es también el del CRM al trabajar en ella).
 *  · Fondo de la cabecera: sobre qué va el logo. Blanco para un logo de color;
 *    oscuro para la versión blanca.
 *  · Remitente «no contestar» y la cuenta de Brevo de la marca, cifrada en la
 *    base: se cambian aquí, sin tocar código ni el servidor. Sin cuenta propia,
 *    los correos salen por la del CRM.
 */

const esHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
const input = 'h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';

function Campo({ label, hint, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Color({ value, onChange, porDefecto, etiqueta }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={esHex(value) ? value : porDefecto} onChange={(e) => onChange(e.target.value)}
        aria-label={etiqueta} className="h-9 w-12 flex-shrink-0 cursor-pointer rounded border border-border" />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={porDefecto}
        maxLength={7} className={`${input} font-mono`} aria-label={`${etiqueta} (hex)`} />
      {value && (
        <button type="button" onClick={() => onChange('')} className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground">Quitar</button>
      )}
    </div>
  );
}

export default function MarcaSection({ isAdmin }) {
  const [proyectos, setProyectos] = useState([]);
  const [id, setId] = useState(null);
  const [form, setForm] = useState(null);
  const [brevo, setBrevo] = useState(null);
  const [clave, setClave] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const r = await client.get('/projects');
    if (r?.success) {
      setProyectos(r.data || []);
      setId((antes) => antes ?? r.data?.[0]?.id ?? null);
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const p = proyectos.find((x) => x.id === id);
  useEffect(() => {
    if (!p) return;
    setForm({
      logo_url: p.logo_url || '',
      theme_color: p.theme_color || '',
      color_cabecera: p.color_cabecera || '',
      remitente_no_contestar: p.remitente_no_contestar || '',
    });
  }, [p?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargarBrevo = useCallback(async () => {
    if (!id) return;
    try {
      const r = await client.get(`/credentials?projectId=${id}&service=brevo`);
      setBrevo((r?.data || []).find((c) => c.project_id === id) || null);
    } catch { setBrevo(null); }
  }, [id]);
  useEffect(() => { cargarBrevo(); }, [cargarBrevo]);

  async function guardar(e) {
    e.preventDefault();
    if ((form.theme_color && !esHex(form.theme_color)) || (form.color_cabecera && !esHex(form.color_cabecera))) {
      toast({ title: 'Color inválido', description: 'Usa formato #rrggbb (ej. #002776)', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      await client.patch(`/projects/${id}`, {
        logo_url: form.logo_url.trim() || null,
        theme_color: form.theme_color.trim() || null,
        color_cabecera: form.color_cabecera.trim() || null,
        remitente_no_contestar: form.remitente_no_contestar.trim() || null,
      });
      if (clave.trim()) {
        await client.post('/credentials', { project_id: id, service: 'brevo', value: clave.trim() });
        setClave('');
        await cargarBrevo();
      }
      toast({ title: 'Marca guardada' });
      await cargar();
    } catch (err) {
      toast({ title: 'No se ha guardado', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  async function quitarBrevo() {
    if (!brevo) return;
    try {
      await client.delete(`/credentials/${brevo.id}`);
      await cargarBrevo();
      toast({ title: 'Cuenta de Brevo quitada', description: 'Sus correos saldrán por la del CRM.' });
    } catch (err) {
      toast({ title: 'No se ha quitado', description: err?.data?.error || err.message, variant: 'destructive' });
    }
  }

  if (!form) return <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Cargando…</div>;

  const fondo = esHex(form.color_cabecera) ? form.color_cabecera : '#ffffff';
  const acento = esHex(form.theme_color) ? form.theme_color : '#1f4e79';

  return (
    <form onSubmit={guardar} className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">Marca en correos y formularios</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que ven los alumnos en el correo de feedback y en su encuesta: el logo sobre su fondo, el color de la marca y el remitente.
        </p>
      </div>

      {proyectos.length > 1 && (
        <Campo label="Marca">
          <select value={id ?? ''} onChange={(e) => setId(Number(e.target.value))} className={input}>
            {proyectos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
          </select>
        </Campo>
      )}

      {/* Así se verá la cabecera del correo y de la encuesta. */}
      <div className="overflow-hidden rounded-md border border-border" aria-label="Vista previa de la cabecera">
        <div className="flex min-h-[64px] items-center px-5 py-3" style={{ background: fondo, borderBottom: `4px solid ${acento}` }}>
          {form.logo_url.trim()
            ? <img src={form.logo_url.trim()} alt={p?.nombre} className="max-h-11 max-w-[200px]" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <span className="text-base font-bold text-[#1d2530]">{p?.nombre}</span>}
        </div>
        <p className="bg-muted/30 px-5 py-2 text-xs text-muted-foreground">Vista previa de la cabecera</p>
      </div>

      <fieldset disabled={!isAdmin} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Campo label="Logo" hint="URL pública de la imagen. Mejor una versión ligera (unos 300 px de ancho): pesa poco en el correo.">
            <input type="url" value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              placeholder="https://iseie.com/…/logo.png" className={input} />
          </Campo>
        </div>
        <Campo label="Color de marca" hint="Botón, filete y acentos. También el del CRM al trabajar en esta marca.">
          <Color value={form.theme_color} onChange={(v) => setForm({ ...form, theme_color: v })} porDefecto="#1f4e79" etiqueta="Color de marca" />
        </Campo>
        <Campo label="Fondo de la cabecera" hint="Sobre qué va el logo. Blanco si es de color; oscuro si es la versión blanca.">
          <Color value={form.color_cabecera} onChange={(v) => setForm({ ...form, color_cabecera: v })} porDefecto="#ffffff" etiqueta="Fondo de la cabecera" />
        </Campo>
        <div className="sm:col-span-2">
          <Campo label="Remitente «no contestar»" hint="Del que salen sus correos. Tiene que ser de un dominio autenticado en su cuenta de Brevo. Vacío = el del CRM.">
            <input type="email" value={form.remitente_no_contestar} onChange={(e) => setForm({ ...form, remitente_no_contestar: e.target.value })}
              placeholder="noresponder@iseie.com" className={input} />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo
            label="Cuenta de Brevo de la marca"
            hint={brevo
              ? `Guardada (${brevo.masked_value}). Escribe otra para cambiarla. Se guarda cifrada.`
              : 'Sin cuenta propia: sus correos salen por la cuenta de Brevo del CRM. Pega aquí su API key si tiene otra.'}
          >
            <div className="flex items-center gap-2">
              <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off"
                placeholder={brevo ? 'xkeysib-… (dejar vacío para no cambiarla)' : 'xkeysib-…'} className={`${input} font-mono`} />
              {brevo && (
                <button type="button" onClick={quitarBrevo} className="flex-shrink-0 text-xs text-muted-foreground hover:text-red-600">Quitar</button>
              )}
            </div>
          </Campo>
        </div>
      </fieldset>

      {isAdmin && (
        <div className="flex justify-end">
          <button type="submit" disabled={guardando}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-primary/90 disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      )}
    </form>
  );
}
