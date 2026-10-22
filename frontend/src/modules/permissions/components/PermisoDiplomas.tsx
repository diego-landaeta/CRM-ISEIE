import { useCallback, useEffect, useState } from 'react';
import { SealCheck } from '@phosphor-icons/react';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';
import * as api from '../api/permissions.api';
import type { PersonaConClave } from '../api/permissions.api';

/**
 * «Diplomas (Certifex) · Ver» y «Diplomas (Certifex) · Emitir», por rol y por persona.
 *
 * Ver (#223). Diego: «Adriana, Daniela, Yosbely, Dayana, Mireia y Ana deben de tener
 * para ver los de Certifex». Da la pantalla Diplomas en SOLO LECTURA y solo con los
 * campus de cada uno.
 *
 * Emitir (Diego, 22/10/2026: «que Dayana pueda emitir, no la dejan; puede hacerlo»).
 * Revisar los datos, pasar a Pendientes, aprobar y emitir y enviar el diploma al
 * alumno, también solo en sus campus. Quien emite también ve. Rechazar, corregir y
 * revocar siguen siendo de administración.
 *
 * El rol entero lo cambia el superadmin (un rol es de todas las empresas); a una
 * persona se lo dan el superadmin y el admin (este, a gente de sus campus). Se
 * guarda al cambiar: cada persona lo tiene al volver a cargar el CRM.
 */

export type ClaveDiplomas = 'diplomas.view' | 'diplomas.emit';

/** Lo que dice cada bloque, desde el lado de quien lo da. */
const TEXTOS: Record<ClaveDiplomas, {
  titulo: string; explicacion: string; si: string; no: string; tiene: string; noTiene: string;
  conRol: (rol: string) => string; sinRol: (rol: string) => string; persona: (nombre: string, puede: boolean) => string;
  descripcion: string;
}> = {
  'diplomas.view': {
    titulo: 'Diplomas (Certifex) · Ver',
    explicacion: 'La pantalla Diplomas en solo lectura, con sus campus. Aprobar, emitir, enviar, corregir y revocar sigue siendo de administración (o de quien tenga «Emitir»).',
    si: 'Sí, la ve',
    no: 'No la ve',
    tiene: 'la ve',
    noTiene: 'no la ve',
    conRol: (rol) => `Todo el rol ${rol} ve Diplomas`,
    sinRol: (rol) => `El rol ${rol} ya no ve Diplomas`,
    persona: (nombre, puede) => (puede ? `${nombre} ve Diplomas` : `${nombre} no ve Diplomas`),
    descripcion: 'En solo lectura y con sus campus. Cada persona lo tiene al volver a cargar el CRM.',
  },
  'diplomas.emit': {
    titulo: 'Diplomas (Certifex) · Emitir',
    explicacion: 'Revisar los datos (nombre, DNI, formación y programa), pasar a Pendientes, aprobar y emitir, y enviar el diploma al alumno, con sus campus. Quien emite también ve. Rechazar, corregir, revocar y el PDF de imprenta siguen siendo de administración.',
    si: 'Sí, emite',
    no: 'No emite',
    tiene: 'emite',
    noTiene: 'no emite',
    conRol: (rol) => `Todo el rol ${rol} emite diplomas`,
    sinRol: (rol) => `El rol ${rol} ya no emite diplomas`,
    persona: (nombre, puede) => (puede ? `${nombre} emite diplomas` : `${nombre} no emite diplomas`),
    descripcion: 'Solo en sus campus. Cada persona lo tiene al volver a cargar el CRM.',
  },
};

type Valor = 'rol' | 'si' | 'no';
const deExcepcion = (e: boolean | null): Valor => (e === true ? 'si' : e === false ? 'no' : 'rol');
const aExcepcion = (v: Valor): boolean | null => (v === 'si' ? true : v === 'no' ? false : null);

interface Props {
  /** Qué se da: ver Diplomas o emitirlos. Sin decirlo, ver (como hasta el 22/10). */
  clave?: ClaveDiplomas;
  roleKey: string;
  rolLabel: string;
  /** Solo el superadmin cambia el rol entero. */
  puedeCambiarRol: boolean;
  onGuardado?: () => void;
}

export default function PermisoDiplomas({ clave = 'diplomas.view', roleKey, rolLabel, puedeCambiarRol, onGuardado }: Props) {
  const t = TEXTOS[clave];
  const [delRol, setDelRol] = useState<boolean | null>(null);
  const [personas, setPersonas] = useState<PersonaConClave[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [r, p] = await Promise.all([
        api.getClaveDeRol(clave, roleKey),
        api.personasDeLaClave(clave, roleKey),
      ]);
      setDelRol(r);
      setPersonas(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    }
  }, [clave, roleKey]);

  useEffect(() => { setDelRol(null); setPersonas(null); cargar(); }, [cargar]);

  async function cambiarRol(permitido: boolean) {
    setGuardando('rol');
    try {
      setDelRol(await api.setClaveDeRol(clave, roleKey, permitido));
      toast({
        title: permitido ? t.conRol(rolLabel) : t.sinRol(rolLabel),
        description: t.descripcion,
      });
      await cargar();
      onGuardado?.();
    } catch (err) {
      toast({ title: 'No se pudo guardar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally { setGuardando(null); }
  }

  async function cambiarPersona(p: PersonaConClave, v: Valor) {
    setGuardando(`p${p.id}`);
    try {
      const r = await api.setClaveDePersona(clave, p.id, aExcepcion(v));
      setPersonas((xs) => (xs || []).map((x) => (x.id === p.id ? { ...x, excepcion: r.excepcion, puede: r.puede } : x)));
      toast({
        title: t.persona(p.nombre, r.puede),
        description: 'Lo tendrá al volver a cargar el CRM.',
      });
    } catch (err) {
      toast({ title: 'No se pudo guardar', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally { setGuardando(null); }
  }

  const opciones = [
    { value: 'rol' as Valor, label: `Como su rol (${delRol ? 'sí' : 'no'})` },
    { value: 'si' as Valor, label: t.si },
    { value: 'no' as Valor, label: t.no },
  ];
  const id = `${clave.replace('.', '-')}-${roleKey}`;

  return (
    <section className="rounded-xl border border-border p-3 space-y-3" aria-labelledby={id}>
      <header>
        <h3 id={id} className="text-sm font-bold flex items-center gap-1.5">
          <SealCheck size={15} weight="bold" /> {t.titulo}
        </h3>
        <p className="text-[11px] text-muted-foreground">{t.explicacion}</p>
      </header>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : delRol === null || personas === null ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : (
        <>
          <label className={`flex items-start gap-2 text-sm ${puedeCambiarRol ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
            <input
              type="checkbox"
              checked={delRol}
              disabled={!puedeCambiarRol || guardando !== null}
              onChange={(e) => cambiarRol(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-border accent-primary"
            />
            <span>
              Todo el rol {rolLabel}
              <span className="block text-[11px] text-muted-foreground">
                {puedeCambiarRol ? 'Para todas las personas con este rol.' : 'Un rol entero lo cambia el superadmin; tú puedes dárselo a una persona.'}
              </span>
            </span>
          </label>

          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Por persona</p>
            {personas.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nadie con este rol{puedeCambiarRol ? '' : ' en tus campus'}.</p>
            ) : (
              <ul className="divide-y divide-border">
                {personas.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{p.nombre}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{p.email} · {p.puede ? t.tiene : t.noTiene}</p>
                    </div>
                    <Select<Valor>
                      value={deExcepcion(p.excepcion)}
                      onChange={(v) => cambiarPersona(p, v)}
                      options={opciones}
                      size="sm"
                      ariaLabel={`${t.titulo} para ${p.nombre}`}
                      disabled={guardando !== null}
                      className="w-48"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
