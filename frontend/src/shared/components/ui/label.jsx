import * as React from 'react';
import { cn } from '@/shared/lib/utils';

/**
 * Label — primitiva shadcn estándar. Wrapper sobre <label> con estilos
 * consistentes para asociar con inputs vía htmlFor.
 */
const Label = React.forwardRef(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
      className
    )}
    {...props}
  />
));
Label.displayName = 'Label';

export { Label };
