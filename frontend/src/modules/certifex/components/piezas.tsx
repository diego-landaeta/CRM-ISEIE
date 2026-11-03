import { useEffect, useState } from 'react';
import { IdentificationCard, LinkBreak, MagnifyingGlass } from '@phosphor-icons/react';
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

/**
 * Tareas entregadas / totales que manda Certifex (#629): es lo que decide su «terminó», y
 * no tiene por qué coincidir con el % de calificadas de al lado.
 */
export function Entregas({ e }: { e?: Candidato['entregas'] }) {
  if (!e || !e.total) return <span className="text-[11px] text-muted-foreground" title="El campus no ha mandado sus tareas entregadas">sin datos de tareas</span>;
  const todas = e.entregadas >= e.total;
  return (
    <span className={cn('whitespace-nowrap text-[11px] tabular-nums', todas ? 'text-muted-foreground' : 'text-warning-soft-foreground')}
      title={`${e.entregadas} de ${e.total} tareas entregadas, de las que cuenta Moodle: con todas, Certifex lo da por terminado`}>
      {e.entregadas}/{e.total} tareas
    </span>
  );
}

/**
 * ¿Le falta algo para darlo por terminado? (#629 / CRM-ISEIE #356). Misma regla y mismo
 * texto que el backend (`avisoSinTerminar` en certifex.diplomas.js): avance de calificadas
 * por debajo del 100 % o sin nota. Con el campus sin actividades (total 0) el avance no se
 * sabe y no cuenta. null = nada que confirmar.
 */
export function avisoSinTerminar(c: Pick<Candidato, 'notaFinal' | 'actividades' | 'entregas'>): string | null {
  const total = Number(c.actividades?.total) || 0;
  const calificadas = Number(c.actividades?.calificadas) || 0;
  const faltaAvance = total > 0 && calificadas < total;
  const faltaNota = c.notaFinal == null;
  if (!faltaAvance && !faltaNota) return null;
  const e = c.entregas;
  const partes: string[] = [];
  if (e && Number(e.total) > 0) {
    partes.push(`${Number(e.entregadas) < Number(e.total) ? 'Solo ha' : 'Ha'} entregado ${Number(e.entregadas)} de ${Number(e.total)} tareas visibles`);
  } else {
    partes.push('No hay datos de sus tareas entregadas');
  }
  if (faltaAvance) partes.push(`tiene ${calificadas} de ${total} actividades calificadas`);
  if (faltaNota) partes.push('no tiene nota');
  const frase = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0];
  return `${frase}: ¿seguro?`;
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
 * ¿Va la firma del alumno en el diploma? Diego, 20/10/2026: «las firmas no van en los
 * diplomas, solo el DNI». Apagado, el panel no enseña ni sube firmas, y el servidor no las
 * manda a Certifex (FIRMA_EN_DIPLOMA en backend/src/modules/certifex/certifex.emision.js).
 * Para volver a ponerla, true aquí y allí.
 */
export const FIRMA_EN_DIPLOMA = false;

/** ¿Tiene DNI (o NIE o pasaporte)? Es obligatorio para emitir el diploma (Diego, 20/10). */
export const tieneDni = (c: { titular?: { dni?: string | null } | null }) => !!c.titular?.dni?.trim();

/** Lo que se dice junto a un botón de emitir que no se puede pulsar por falta de DNI. */
export const PON_EL_DNI = 'Pon el DNI para poder emitir';
export const TITULO_SIN_DNI = 'Falta el DNI (o NIE o pasaporte) del alumno: es obligatorio en el diploma. Ponlo con «Sin DNI · Poner».';

/**
 * Lo que lleva el diploma, arriba de las dos pantallas que emiten. Como antes de la firma
 * (Diego, 16/10: la de la institución impresa; sobre «El interesado», solo el nombre), y
 * desde el 20/10, el DNI: obligatorio. Con FIRMA_EN_DIPLOMA, dice de dónde sale la firma.
 */
export function AvisoCasiListo() {
  return (
    <div role="note" className="flex items-start gap-3 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground">
      <IdentificationCard size={18} weight="bold" className="mt-0.5 flex-none" aria-hidden />
      <div>
        <p className="font-medium">El DNI del alumno es obligatorio en el diploma</p>
        <p className="mt-0.5 text-xs">
          {FIRMA_EN_DIPLOMA
            ? 'La firma del alumno se coge de su solicitud de admisión o se sube en «Revisar datos antes de aprobar», y se imprime sobre «El interesado». '
            : 'La firma de la institución ya va impresa. La del alumno no va en el diploma: sobre «El interesado» sale solo su nombre. '}
          Junto al nombre se imprime su DNI (o NIE o pasaporte): sin él no se aprueba ni se emite. Si falta, ponlo con «Sin DNI · Poner».
        </p>
      </div>
    </div>
  );
}
