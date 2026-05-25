import * as React from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * @type {React.ForwardRefExoticComponent<
 *   React.HTMLAttributes<HTMLDivElement> & {
 *     value?: number;
 *   } & React.RefAttributes<HTMLDivElement>
 * >}
 */
const Progress = React.forwardRef(({ className, value, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('relative h-4 w-full overflow-hidden rounded-full bg-secondary', className)}
    {...props}
  >
    <div
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </div>
));
Progress.displayName = 'Progress';

export { Progress };
