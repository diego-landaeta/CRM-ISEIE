import { useEffect, useState } from 'react';
import { rfcApi, RfcDetail, ESTADO_LABELS } from '../api/changeRequests.api';

// Documento imprimible para PDF de la RFC. Se monta SIEMPRE en el DOM (oculto
// con CSS @media screen) y se hace visible solo en @media print, ocultando el
// resto de la pantalla. Así window.print() entrega un PDF formal con portada,
// secciones, decisiones y firmas — no un screenshot.

const DECISION_LABELS: Record<string, string> = { a_favor: 'A FAVOR', en_contra: 'EN CONTRA', diferir: 'DIFERIR' };
const ROL_LABELS: Record<string, string> = { ceo: 'CEO / Sponsor', pm: 'Project Manager', dev: 'Desarrollador' };

interface Props { rfc: RfcDetail; orgName?: string }

export default function RfcPrintTemplate({ rfc, orgName = 'CRM ISEIE' }: Props) {
  // Cargamos las firmas (base64) bajo demanda para incrustarlas en el PDF.
  const [signatures, setSignatures] = useState<Record<number, string | null>>({});

  useEffect(() => {
    const signed = rfc.approvals.filter((a: any) => a.has_firma);
    Promise.all(signed.map((a: any) =>
      rfcApi.getSignature(a.id)
        .then((r: any) => [a.id, r?.data?.firma_data || null] as [number, string | null])
        .catch(() => [a.id, null] as [number, string | null])
    )).then((rows) => {
      const obj: Record<number, string | null> = {};
      rows.forEach(([id, data]) => { obj[id] = data; });
      setSignatures(obj);
    });
  }, [rfc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const opciones: any[] = Array.isArray(rfc.opciones_consideradas) ? rfc.opciones_consideradas : [];

  return (
    <div className="rfc-print-doc">
      {/* ─────────── PORTADA ─────────── */}
      <section className="rfc-cover">
        <div className="rfc-cover-top">
          <div className="rfc-org">{orgName}</div>
          <div className="rfc-doctype">SOLICITUD DE CAMBIO (RFC)</div>
        </div>
        <div className="rfc-cover-mid">
          <div className="rfc-code">{rfc.codigo_rfc}</div>
          <h1 className="rfc-title">{rfc.titulo}</h1>
          <div className="rfc-status">Estado: <strong>{ESTADO_LABELS[rfc.estado] || rfc.estado}</strong></div>
        </div>
        <div className="rfc-cover-meta">
          <table>
            <tbody>
              <tr><td>Proyecto</td><td><strong>{rfc.proyecto_nombre || 'General (plataforma)'}</strong></td></tr>
              <tr><td>Solicitante</td><td>{rfc.solicitante_nombre} — {rfc.solicitante_email}</td></tr>
              <tr><td>Fecha de solicitud</td><td>{new Date(rfc.fecha_solicitud).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</td></tr>
              <tr><td>Documento generado</td><td>{new Date().toLocaleString('es-ES')}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="rfc-cover-foot">
          Documento controlado — uso interno
        </div>
      </section>

      {/* ─────────── SEC. 1 — DESCRIPCIÓN ─────────── */}
      <section className="rfc-section">
        <h2>1. Descripción del cambio (solicitante)</h2>
        <table className="rfc-kv">
          <tbody>
            <tr><th>Título</th><td>{rfc.titulo}</td></tr>
            <tr><th>Modifica</th><td>
              {rfc.modifica_alcance && '✓ Alcance  '}
              {rfc.modifica_cronograma && '✓ Cronograma  '}
              {rfc.modifica_costos && '✓ Costos  '}
              {rfc.modifica_riesgos && '✓ Riesgos  '}
              {!rfc.modifica_alcance && !rfc.modifica_cronograma && !rfc.modifica_costos && !rfc.modifica_riesgos && '—'}
            </td></tr>
            <tr><th>Descripción resumida</th><td>{rfc.descripcion_resumida || '—'}</td></tr>
            <tr><th>Objetivo / intención</th><td>{rfc.objetivo_intencion || '—'}</td></tr>
            <tr><th>Motivo de negocio</th><td>{rfc.motivo_negocio || '—'}</td></tr>
            <tr><th>Beneficios KPI / marca</th><td>{rfc.beneficios_kpi || '—'}</td></tr>
            <tr><th>Beneficios comerciales</th><td>{rfc.beneficios_comercial || '—'}</td></tr>
            <tr><th>Beneficios operación</th><td>{rfc.beneficios_operacion || '—'}</td></tr>
          </tbody>
        </table>
      </section>

      {/* ─────────── SEC. 2 — ANÁLISIS PM ─────────── */}
      <section className="rfc-section">
        <h2>2. Análisis técnico (Project Manager)</h2>
        {opciones.length > 0 && (
          <>
            <h3>Opciones consideradas</h3>
            <table className="rfc-options">
              <thead>
                <tr><th>Opción</th><th>Descripción</th><th>Costo</th><th>Tiempo</th><th>Riesgos</th></tr>
              </thead>
              <tbody>
                {opciones.map((op: any, i: number) => (
                  <tr key={i}>
                    <td><strong>{op.opcion || '—'}</strong></td>
                    <td>{op.descripcion || '—'}</td>
                    <td>{op.costo || '—'}</td>
                    <td>{op.tiempo || '—'}</td>
                    <td>{op.riesgos || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <h3>Impactos</h3>
        <table className="rfc-kv">
          <tbody>
            <tr><th>Alcance (WBS)</th><td>{rfc.impacto_alcance || '—'}</td></tr>
            <tr><th>Tiempo</th><td>{rfc.impacto_tiempo || '—'}</td></tr>
            <tr><th>Costo</th><td>{rfc.impacto_costo || '—'}</td></tr>
            <tr><th>Riesgos y mitigación</th><td>{rfc.impacto_riesgos || '—'}</td></tr>
          </tbody>
        </table>
        <h3>Recomendación del PM</h3>
        <table className="rfc-kv">
          <tbody>
            <tr><th>Decisión recomendada</th><td>{(rfc.recomendacion_decision || '—').toUpperCase()}</td></tr>
            <tr><th>Justificación</th><td>{rfc.recomendacion_justif || '—'}</td></tr>
          </tbody>
        </table>
        <h3>Plan de implementación</h3>
        <table className="rfc-kv">
          <tbody>
            <tr><th>Alcance / piloto</th><td>{rfc.plan_alcance || '—'}</td></tr>
            <tr><th>Hitos / fechas</th><td>{rfc.plan_hitos || '—'}</td></tr>
            <tr><th>Responsables</th><td>{rfc.plan_responsables || '—'}</td></tr>
          </tbody>
        </table>
        <h3>Línea base de versiones</h3>
        <table className="rfc-kv">
          <tbody>
            <tr><th>Alcance</th><td>{rfc.baseline_alcance || '—'}</td></tr>
            <tr><th>Cronograma</th><td>{rfc.baseline_cronograma || '—'}</td></tr>
            <tr><th>Costos</th><td>{rfc.baseline_costos || '—'}</td></tr>
          </tbody>
        </table>
      </section>

      {/* ─────────── SEC. 3 — CCB ─────────── */}
      <section className="rfc-section rfc-signatures-section">
        <h2>3. Aprobaciones del Comité de Control de Cambios (CCB)</h2>
        <div className="rfc-signatures">
          {rfc.approvals.map((a: any) => (
            <div key={a.id} className="rfc-sig-box">
              <div className="rfc-sig-rol">{ROL_LABELS[a.rol] || a.rol}</div>
              <div className="rfc-sig-canvas">
                {signatures[a.id] ? (
                  <img src={signatures[a.id] as string} alt="Firma" />
                ) : a.decision ? (
                  <span className="rfc-sig-no-graphic">(decisión registrada sin firma gráfica)</span>
                ) : (
                  <span className="rfc-sig-pending">Pendiente</span>
                )}
              </div>
              <div className="rfc-sig-meta">
                <div><strong>{a.user_nombre || '—'}</strong></div>
                <div>{a.user_email || ''}</div>
                <div>{a.firma_at ? new Date(a.firma_at).toLocaleString('es-ES') : '—'}</div>
                {a.decision && <div className="rfc-sig-decision">Decisión: {DECISION_LABELS[a.decision] || a.decision}</div>}
                {a.comentarios && <div className="rfc-sig-coment">"{a.comentarios}"</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="rfc-print-footer">
        Documento generado desde el CRM · {rfc.codigo_rfc} · {new Date().toLocaleString('es-ES')}
      </footer>
    </div>
  );
}
