import type { ReactNode } from 'react';

export { avatarColor, getInitials } from '../../lib/leadFormat';

export default function InfoField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="text-[13px] font-medium break-words">{children}</div>
    </div>
  );
}

// La clase común de los campos (#106), una sola en todo el CRM. Se reenvía
// para no tocar a quien ya la importa de aquí.
export { inputClass } from '@/shared/lib/ui';
