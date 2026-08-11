import { ChevronDown } from "lucide-react";
import * as React from "react";

import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A styled native `<select>`.
 *
 * Deliberately not Radix Select: this is ~20 lines reusing `inputClassName`,
 * with no portal, no focus-management edge cases, correct behaviour inside a
 * plain form, and the native picker on mobile — which is better than any
 * re-implementation. Reach for Radix only when a filter needs search or
 * multi-select, neither of which the admin filters do.
 */
export type SelectProps = React.ComponentPropsWithoutRef<"select">;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(
            inputClassName,
            "cursor-pointer appearance-none pr-8",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2"
        />
      </div>
    );
  },
);
