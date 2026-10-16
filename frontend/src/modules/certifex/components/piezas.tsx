import { useEffect, useState } from 'react';
import { LinkBreak, MagnifyingGlass, Signature } from '@phosphor-icons/react';
import StatusDot from '@/shared/components/ui/StatusDot';
import { cn } from '@/shared/lib/utils';
import { emisionesApi, type CampusCertifex, type Candidato, type ConexionCertifex } from '../api/certifex.api';

/**
 * Piezas de Certifex compartidas entre Emisiones y Diplomas: el logo de cada campus,
 * las etiquetas de estado, las pestañas, el buscador y lo que el CRM sabe del alumno.
 * Salieron de CertifexEmisionesPage tal cual, para no tener dos copias.
 */
/**
 * Logo y tono, por ruta: el mismo logo sale en la tarjeta, en la cabecera y en la
 * ficha, y no hace falta traerlo ni medirlo tres veces. Lo trae el servidor del CRM
 * porque el navegador no deja leer los píxeles de una imagen de otro dominio, y hace
 * falta leerlos para saber si el logo es claro (Academia IA es texto blanco: sin fondo
 * oscuro, no se ve).
 */
const logos = new Map<string, Promise<{ url: string; tono: 'claro' | 'oscuro' }>>();

export function medirTono(img: HTMLImageElement): 'claro' | 'oscuro' {
  try {
    const lado = 32;
    const lienzo = document.createElement('canvas');
    lienzo.width = lado;
    lienzo.height = lado;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'oscuro';
    ctx.drawImage(img, 0, 0, lado, lado);
    const { data } = ctx.getImageData(0, 0, lado, lado);
    let total = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 40) continue;
      total += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
    return n && total / n > 150 ? 'claro' : 'oscuro';
  } catch {
    return 'oscuro';
  }
}

export function cargarLogo(ruta: string) {
  let p = logos.get(ruta);
  if (!p) {
    p = emisionesApi.logo(ruta).then((b) => new Promise<{ url: string; tono: 'claro' | 'oscuro' }>((resolver, fallar) => {
      const url = URL.createObjectURL(b);
      const img = new Image();
      img.onload = () => resolver({ url, tono: medirTono(img) });
      img.onerror = () => fallar(new Error('logo'));
      img.src = url;
    }));
    p.catch(() => logos.delete(ruta));
    logos.set(ruta, p);
  }
  return p;
}

export function LogoCampus({ c, size = 44 }: { c: Pick<CampusCertifex, 'codigo' | 'logo'>; size?: number }) {
  const [logo, setLogo] = useState<{ url: string; tono: 'claro' | 'oscuro' } | null>(null);
  useEffect(() => {
    let vivo = true;
    setLogo(null);
    if (c.logo) cargarLogo(c.logo).then((l) => { if (vivo) setLogo(l); }).catch(() => {});
    return () => { vivo = false; };
  }, [c.logo]);
  if (logo) {
    return (
      <span
        className={cn('grid flex-none place-items-center overflow-hidden rounded-md border border-border p-1.5',
          logo.tono === 'claro' ? 'bg-zinc-800' : 'bg-white')}
        style={{ width: size, height: size }}
      >
        <img src={logo.url} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span className="grid flex-none place-items-center rounded-md bg-primary/10 font-semibold uppercase text-primary"
      style={{ width: size, height: size, fontSize: size / 3.4 }}>
      {c.codigo.slice(0, 2)}
    </span>
  );
}

/** Barra fina de avance, con el color de estado del CRM según lo que falta. */
export function Barra({ valor, tono = 'primary', className }: { valor: number; tono?: 'primary' | 'success' | 'warning' | 'destructive'; className?: string }) {
  const color = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive' }[tono];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(0, Math.min(100, valor))}%` }} />
    </div>
  );
}

export function Avance({ hechas, total }: { hechas: number; total: number }) {
  if (!total) return <span className="text-xs text-muted-foreground" title="Este campus no publica sus actividades">sin actividades</span>;
  const pct = Math.round((Math.min(hechas, total) / total) * 100);
  const tono = hechas >= total ? 'success' : pct >= 50 ? 'warning' : 'destructive';
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`${hechas} de ${total} actividades calificadas`}>
      <Barra valor={pct} tono={tono} className="w-16" />
      <span className={cn('w-9 text-right text-xs tabular-nums', hechas >= total ? 'font-medium text-success-soft-foreground' : 'text-muted-foreground')}>{pct}%</span>
    </span>
  );
}

export function Decision({ c }: { c: Candidato }) {
  if (c.decision?.decision === 'aprobada') return <StatusDot tono="success">Aprobada</StatusDot>;
  if (c.decision?.decision === 'rechazada') return <StatusDot tono="danger">Rechazada</StatusDot>;
  return <StatusDot tono="info">Por decidir</StatusDot>;
}

/** Etiqueta suave con los tokens de estado del CRM. */
export function Etiqueta({ tono, children }: { tono: 'info' | 'success' | 'warning' | 'destructive' | 'neutral'; children: React.ReactNode }) {
  const c = {
    info: 'bg-info-soft text-info-soft-foreground',
    warning: 'bg-warning-soft text-warning-soft-foreground',
    success: 'bg-success-soft text-success-soft-foreground',
    destructive: 'bg-destructive-soft text-destructive-soft-foreground',
    neutral: 'bg-muted text-muted-foreground',
  }[tono];
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', c)}>{children}</span>;
}

export const euros = (n: number) => n.toLocaleString('es', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

/**
 * Lo que dice el CRM de este alumno: si compró y si lo tiene pagado. Es lo que
 * Moodle no sabe y la razón de aprobar desde aquí.
 */
export function EnElCrmEtiqueta({ crm }: { crm: Candidato['crm'] }) {
  if (crm === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  if (crm === null) return <Etiqueta tono="neutral">No está en el CRM</Etiqueta>;
  if (crm.ventas === 0) return <Etiqueta tono="warning">Sin venta</Etiqueta>;
  if (crm.pendiente > 0.05) return <Etiqueta tono="warning">Debe {euros(crm.pendiente)}</Etiqueta>;
  if (crm.pendiente < -0.05) return <Etiqueta tono="info">Cobrado de más</Etiqueta>;
  return <Etiqueta tono="success">Pagado</Etiqueta>;
}

export function Pestana({ activa, onClick, children, cuenta }: { activa: boolean; onClick: () => void; children: React.ReactNode; cuenta?: number }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={cn(
        'h-8 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors',
        activa ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted/60',
      )}
    >
      {children}
      {cuenta !== undefined && (
        <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', activa ? 'bg-background/80 text-foreground' : 'bg-muted text-muted-foreground')}>
          {cuenta}
        </span>
      )}
    </button>
  );
}

export function Buscador({ id, valor, alCambiar, placeholder, autoFocus }: { id: string; valor: string; alCambiar: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        id={id}
        value={valor}
        autoFocus={autoFocus}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

/**
 * Aviso de que los enlaces a Certifex no abrirían desde fuera (Certifex#96): el 12/10, el
 * Certifex de pruebas escuchaba en 127.0.0.1 y «Ver diploma» llevaba a una página que no
 * abre. Ver el PDF sigue funcionando (lo trae el servidor del CRM); lo que no sale es
 * el enlace directo, ni el aviso al alumno, que lo llevaría.
 */
export function AvisoDireccionPublica({ conexion }: { conexion: ConexionCertifex | null }) {
  const d = conexion?.conectado ? conexion.direccionPublica : undefined;
  if (!d || d.ok) return null;
  return (
    <div role="status" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
      <LinkBreak size={18} weight="bold" className="mt-0.5 flex-none" aria-hidden />
      <div>
        <p className="font-medium">Los enlaces a Certifex no abren desde fuera</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs">
          {d.motivos.map((m) => <li key={m}>{m}</li>)}
        </ul>
        <p className="mt-1 text-xs">Mientras tanto no se enseñan enlaces directos ni salen avisos al alumno. «Ver PDF» sí funciona.</p>
      </div>
    </div>
  );
}

/**
 * «Casi listo» (Diego, 16/10, al subir Certificaciones a producción): los diplomas ya se
 * aprueban, emiten y envían de verdad, pero la línea «El interesado» aún no lleva la firma
 * del alumno. La de la institución va impresa en el diseño de cada campus. Se quita este
 * aviso al cerrar #349, cuando el CRM mande a Certifex la firma de la solicitud de admisión.
 */
export function AvisoCasiListo() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
      <Signature size={18} weight="bold" className="mt-0.5 flex-none" aria-hidden />
      <div>
        <p className="font-medium">Casi listo: los diplomas aún salen sin la firma del alumno</p>
        <p className="mt-0.5 text-xs">
          La firma de la institución ya va impresa. La del alumno, la que hace en la solicitud de admisión, la mandará el CRM
          a Certifex y se colocará sola sobre «El interesado». Hasta entonces, en esa línea sale solo su nombre.
        </p>
      </div>
    </div>
  );
}
