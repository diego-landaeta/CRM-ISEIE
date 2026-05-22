import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/api';

type TemplateKind = 'contacto_basico' | 'lead_con_producto' | 'custom';

interface FormField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'textarea';
  required: boolean;
}

interface FormMeta {
  nombre: string;
  template_kind: TemplateKind;
  config?: {
    color?: string;
    button_label?: string;
    success_msg?: string;
    redirect_url?: string;
  };
  project?: { nombre?: string };
}

const FIELDS_BY_KIND: Record<TemplateKind, FormField[]> = {
  contacto_basico: [
    { key: 'nombre', label: 'Nombre', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'telefono', label: 'Teléfono', type: 'tel', required: false },
  ],
  lead_con_producto: [
    { key: 'nombre', label: 'Nombre', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'telefono', label: 'Teléfono', type: 'tel', required: false },
    { key: 'notas', label: '¿Qué te interesa?', type: 'textarea', required: false },
  ],
  custom: [],
};

export default function EmbedFormPage() {
  const { embedId } = useParams<{ embedId: string }>();
  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/forms/public/${embedId}`)
      .then(r => r.json())
      .then(res => {
        if (res.success) setMeta(res.data);
        else setError(res.error || 'Formulario no disponible');
      })
      .catch(() => setError('No se pudo cargar el formulario'));
  }, [embedId]);

  const color = meta?.config?.color || '#4361ee';
  const buttonLabel = meta?.config?.button_label || 'Enviar';
  const successMsg = meta?.config?.success_msg || '¡Gracias! Hemos recibido tus datos.';

  const fields = meta
    ? (FIELDS_BY_KIND[meta.template_kind] || FIELDS_BY_KIND.contacto_basico)
    : [];

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/forms/public/${embedId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (json.success) {
        if (meta?.config?.redirect_url && window.top) {
          window.top.location.href = meta.config.redirect_url;
        } else {
          setSubmitted(true);
        }
      } else {
        setError(json.error || 'Error al enviar. Inténtalo de nuevo.');
        setSubmitting(false);
      }
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.');
      setSubmitting(false);
    }
  }

  const style: CSSProperties = {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    background: '#f9fafb',
  };

  if (error) {
    return (
      <div style={style}>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center', color: '#6b7280' }}>
          <p style={{ fontSize: 14 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!meta) {
    return (
      <div style={style}>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: `3px solid ${color}`, borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={style}>
        <div style={{ maxWidth: 440, width: '100%', background: '#fff', borderRadius: 16, padding: '40px 32px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: 0 }}>{successMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={style}>
      <div style={{ maxWidth: 440, width: '100%', background: '#fff', borderRadius: 16, padding: '32px 28px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        {meta.project?.nombre && (
          <p style={{ fontSize: 12, fontWeight: 700, color: color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            {meta.project.nombre}
          </p>
        )}
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 24px' }}>{meta.nombre}</h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {fields.map(field => (
            <label key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                {field.label}{field.required && <span style={{ color: '#ef4444' }}> *</span>}
              </span>
              {field.type === 'textarea' ? (
                <textarea
                  value={values[field.key] || ''}
                  onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                  required={field.required}
                  rows={3}
                  style={{ padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit', resize: 'vertical', outline: 'none', transition: 'border-color 0.15s' }}
                  onFocus={e => { e.target.style.borderColor = color; }}
                  onBlur={e => { e.target.style.borderColor = '#e5e7eb'; }}
                />
              ) : (
                <input
                  type={field.type}
                  value={values[field.key] || ''}
                  onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                  required={field.required}
                  style={{ height: 42, padding: '0 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: 14, fontFamily: 'inherit', outline: 'none', transition: 'border-color 0.15s' }}
                  onFocus={e => { e.target.style.borderColor = color; }}
                  onBlur={e => { e.target.style.borderColor = '#e5e7eb'; }}
                />
              )}
            </label>
          ))}

          {error && (
            <p style={{ fontSize: 13, color: '#ef4444', background: '#fef2f2', padding: '8px 12px', borderRadius: 8, margin: 0 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 4,
              height: 44,
              borderRadius: 10,
              background: color,
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              transition: 'opacity 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {submitting ? 'Enviando...' : buttonLabel}
          </button>
        </form>
      </div>
    </div>
  );
}
