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

export const inputClass = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card placeholder:text-muted-foreground';
