import type { HTMLAttributes } from 'react';

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

export declare function Badge(props: BadgeProps): JSX.Element;
