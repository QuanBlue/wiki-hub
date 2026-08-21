import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { inputClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SelectContextValue = {
  value?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  labels: Record<string, string>;
  registerLabel: (value: string, label: string) => void;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext(component: string) {
  const context = React.useContext(SelectContext);
  if (!context) throw new Error(`${component} must be used inside Select`);
  return context;
}

export function Select({
  value: valueProp,
  defaultValue,
  onValueChange,
  disabled = false,
  children,
}: React.PropsWithChildren<{
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}>) {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
  const [open, setOpen] = React.useState(false);
  const [labels, setLabels] = React.useState<Record<string, string>>({});
  const value = valueProp ?? uncontrolledValue;

  const changeValue = React.useCallback(
    (nextValue: string) => {
      setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    },
    [onValueChange],
  );
  const registerLabel = React.useCallback((itemValue: string, label: string) => {
    setLabels((current) => (current[itemValue] === label ? current : { ...current, [itemValue]: label }));
  }, []);

  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen} modal={false}>
      <SelectContext.Provider value={{ value, disabled, onValueChange: changeValue, labels, registerLabel }}>
        {children}
      </SelectContext.Provider>
    </DropdownMenuPrimitive.Root>
  );
}

export const SelectGroup = React.Fragment;

export function SelectValue({ placeholder = "", children }: { placeholder?: string; children?: React.ReactNode }) {
  const { value, labels } = useSelectContext("SelectValue");
  return <span className={cn("truncate", !value && "text-muted-foreground")}>{children ?? (value ? labels[value] ?? value : placeholder)}</span>;
}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function SelectTrigger({ className, children, disabled, ...props }, ref) {
    const context = useSelectContext("SelectTrigger");
    return (
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          ref={ref}
          type="button"
          disabled={disabled ?? context.disabled}
          className={cn(
            inputClassName,
            "flex cursor-pointer items-center justify-between gap-2 text-left",
            "disabled:pointer-events-none",
            className,
          )}
          {...props}
        >
          {children}
          <ChevronDown aria-hidden className="text-muted-foreground size-4 shrink-0" />
        </button>
      </DropdownMenuPrimitive.Trigger>
    );
  },
);

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(function SelectContent({ className, children, ...props }, ref) {
  const context = useSelectContext("SelectContent");
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        forceMount
        data-radix-scroll-lock-ignore=""
        onWheel={(e) => e.stopPropagation()}
        className={cn(
          "border-border bg-surface text-foreground z-[100] max-h-56 w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto overscroll-contain rounded-lg border p-1 shadow-lg",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        <DropdownMenuPrimitive.RadioGroup
          value={context.value}
          onValueChange={context.onValueChange}
        >
          {children}
        </DropdownMenuPrimitive.RadioGroup>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
});

export const SelectLabel = DropdownMenuPrimitive.Label;

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(function SelectItem({ className, children, value, disabled, ...props }, ref) {
  const context = useSelectContext("SelectItem");
  React.useEffect(() => {
    if (value) context.registerLabel(value, typeof children === "string" ? children : value);
  }, [children, context, value]);

  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      value={value}
      disabled={disabled}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-md py-2 pr-8 pl-2.5 text-sm outline-none transition-colors duration-150",
        "data-[highlighted]:bg-surface-hover data-[highlighted]:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
      <DropdownMenuPrimitive.ItemIndicator className="absolute right-2.5 inline-flex items-center">
        <Check className="text-primary size-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </DropdownMenuPrimitive.RadioItem>
  );
});

export const SelectSeparator = DropdownMenuPrimitive.Separator;
