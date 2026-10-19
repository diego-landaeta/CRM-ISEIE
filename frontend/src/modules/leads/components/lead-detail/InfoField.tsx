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

// Era una copia mas, identica de valor. Se reenvia la unica que hay para que
// no vuelva a separarse por el camino (#106, como en MultiCRM).
export { inputClass } from '@/shared/lib/ui';
