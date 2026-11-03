import { useEffect, useState } from 'react';
import { CaretDown, Target, Info } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import BaremoDeLaTasa, { CLASE_DEL_TONO } from './BaremoDeLaTasa';
import {
  traerTasaDeCierre, traerDesglose,
  type TasaDeCierre as Tasa, type PersonaDelDesglose, type AmbitoDeLaTasa,
} from '../api/tasaCierre.api';

/**
 * La tasa de cierre, como primer bloque del panel (#39).
 *
 * LO QUE RESUELVE, QUE ES UN PROBLEMA DE CONFIANZA Y NO DE PANTALLA
 *
 * El CRM enseñaba dos porcentajes distintos de «lo mismo»: la tarjeta «Tasa
 * conversión» contaba los leads con `status = 'convertido'` —un campo que
 * alguien pone a mano— y esto cuenta ventas con cobro. Un lead puede estar
 * marcado sin haber pagado, y haber pagado sin que nadie le tocara el estado.
 *
 * El ticket lo dice mejor que yo: «hoy la misma pantalla puede enseñar dos
 * porcentajes distintos de lo mismo. Eso es exactamente lo que hace que no se
 * crea ninguno de los dos».
 *
 * Así que aquí NO se calcula nada: los dos sumandos y el porcentaje salen de
 * `/informes/tasa-cierre`, que es la definición ya verificada. Escribir la
 * división en el navegador sería la tercera fórmula.
 *
 * EL MES EN CURSO NO SE PUNTÚA
 *
 * El backend marca cada mes como maduro o no. El que corre siempre sale bajo
 * —la gente tarda en comprar— así que pintarlo igual que los demás es empezar
 * el mes en rojo por definición. Va en gris y con su aviso.
 */
export default function TasaDeCierre({
  activeProject, activeIssuerId = null, from, to, asesoraId = null,
}: AmbitoDeLaTasa) {
  const ambito: AmbitoDeLaTasa = { activeProject, activeIssuerId, from, to, asesoraId };
  const { user } = useAuth() as { user: { role?: string } | null };
  const puedeCambiarElBaremo = user?.role === 'admin' || user?.role === 'superadmin';
  const [version, setVersion] = useState(0);
  const [tasa, setTasa] = useState<Tasa | null>(null);
  const [fallo, setFallo] = useState(false);
  const [abierto, setAbierto] = useState<null | 'cerrados' | 'todos'>(null);
  const [gente, setGente] = useState<PersonaDelDesglose[]>([]);
  const [cargandoGente, setCargandoGente] = useState(false);

  const clave = [activeProject?.id, activeIssuerId, from, to, asesoraId, version].join('|');

  useEffect(() => {
    let vivo = true;
    setFallo(false);
    setAbierto(null);
    traerTasaDeCierre(ambito)
      .then((t) => { if (vivo) setTasa(t); })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [clave]);

  async function abrir(lado: 'cerrados' | 'todos') {
    if (abierto === lado) { setAbierto(null); return; }
    setAbierto(lado);
    setCargandoGente(true);
    try {
      setGente(await traerDesglose({ ...ambito, lado }));
    } catch {
      setGente([]);
    } finally {
      setCargandoGente(false);
    }
  }

  // Callado si falla. Es un bloque de cabecera y tumbar Reportes entero por no
  // poder contar una tasa sería peor que no enseñarla.
  if (fallo || !tasa) return null;

  const sinMadurar = tasa.meses.filter((m) => !m.madura).length;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-base flex items-center gap-1.5">
            <Target size={16} weight="duotone" /> Tasa de cierre
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">{tasa.definicion}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums">{tasa.tasa}%</div>
          <p className="text-[11px] text-muted-foreground">del periodo</p>
          {/* Qué significa (#39): el tramo del baremo, si lo hay; y, para una gestora, frente al equipo. */}
          {tasa.lectura && (
            <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${CLASE_DEL_TONO[tasa.lectura.tono]}`}>
              {tasa.lectura.etiqueta}
            </span>
          )}
          {tasa.equipo != null && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              frente al <strong className="tabular-nums">{tasa.equipo}%</strong> del equipo
            </p>
          )}
        </div>
      </div>

      {/* Los dos sumandos, pulsables. Es lo que hace el número comprobable:
          se abre la lista y se cuentan las personas que hay detrás. */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        {([
          { lado: 'cerrados' as const, rotulo: 'Han comprado', valor: tasa.cerrados },
          { lado: 'todos' as const, rotulo: 'Entraron', valor: tasa.leads },
        ]).map(({ lado, rotulo, valor }) => (
          <button
            key={lado}
            type="button"
            onClick={() => abrir(lado)}
            aria-expanded={abierto === lado}
            className={`rounded-lg border p-3 text-left transition-colors ${
              abierto === lado ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {rotulo}
              <CaretDown size={11} weight="bold" className={abierto === lado ? 'rotate-180' : ''} />
            </div>
            <div className="text-2xl font-semibold tabular-nums">{valor}</div>
            <div className="text-[11px] text-muted-foreground">¿de dónde sale?</div>
          </button>
        ))}
      </div>

      {abierto && (
        <div className="mt-3 border border-border rounded-lg overflow-hidden">
          {cargandoGente ? (
            <p className="text-xs text-muted-foreground p-3">Cargando…</p>
          ) : gente.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">Nadie en este tramo.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Nombre</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Entró</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Gestora</th>
                    {abierto === 'cerrados' && (
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Compró</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {gente.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="px-3 py-1.5">{p.nombre || <span className="text-muted-foreground">Sin nombre</span>}</td>
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">{(p.entrada || '').slice(0, 10)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{p.gestora || '—'}</td>
                      {abierto === 'cerrados' && (
                        <td className="px-3 py-1.5 tabular-nums">{(p.fecha_venta || '').slice(0, 10) || '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {puedeCambiarElBaremo && (
        <BaremoDeLaTasa
          // Con otro baremo guardado se rehace el editor con los tramos nuevos.
          key={`${tasa.baremo?.ambito}-${(tasa.baremo?.tramos || []).map((t) => `${t.desde_pct}${t.etiqueta}${t.tono}`).join(',')}`}
          baremo={tasa.baremo}
          projectId={activeIssuerId ? null : (activeProject?.id && activeProject.id > 0 ? activeProject.id : null)}
          esSuperadmin={user?.role === 'superadmin'}
          onCambio={() => setVersion((v) => v + 1)}
        />
      )}

      {tasa.meses.length > 1 && (
        <div className="mt-3">
          <div className="flex gap-1 flex-wrap">
            {tasa.meses.map((m) => (
              <div
                key={m.mes}
                title={`${m.mes}: ${m.cerrados} de ${m.leads}${m.madura ? '' : ' — mes sin cerrar, todavía puede subir'}`}
                className={`rounded-md border px-2 py-1 text-[11px] tabular-nums ${
                  m.madura ? 'border-border' : 'border-dashed border-border text-muted-foreground/60'
                }`}
              >
                <span className="text-muted-foreground">{m.mes.slice(5)}/</span>
                <span className="text-muted-foreground">{m.mes.slice(2, 4)} </span>
                <strong>{m.tasa}%</strong>
              </div>
            ))}
          </div>
          {sinMadurar > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
              <Info size={11} /> Los meses de línea discontinua no han cerrado: casi todo el mundo
              compra en el mes de entrar, así que todavía pueden subir. No se puntúan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
