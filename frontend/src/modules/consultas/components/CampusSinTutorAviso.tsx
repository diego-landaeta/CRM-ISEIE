import { Link } from 'react-router-dom';
import { Warning } from '@phosphor-icons/react';
import type { CampusSinTutor } from '../api/consultas.api';

/*
  El aviso de campus con Moodle conectado que no tienen ningún tutor que pueda
  recibir sus consultas (#189), como «Sin tutor» de comisiones. Sin tutor, las
  consultas de ese campus entran sin asignar.
*/

export default function CampusSinTutorAviso({ campus }: { campus: CampusSinTutor[] }) {
  if (!campus.length) return null;
  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-warning bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
      <Warning size={16} weight="bold" className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">
          {campus.length === 1 ? '1 campus conectado no tiene tutor para las consultas' : `${campus.length} campus conectados no tienen tutor para las consultas`}
        </p>
        <p>
          {campus.map((c) => (c.empresa ? `${c.campus} (${c.empresa})` : c.campus)).join(' · ')}.
          {' '}Sus consultas entran sin asignar. Asígnale un tutor, matriculado en el campus y disponible, en{' '}
          <Link to="/tutores" className="underline">Tutores</Link>.
        </p>
      </div>
    </div>
  );
}
