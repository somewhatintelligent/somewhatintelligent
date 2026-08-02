import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@si/ui/lib/utils";
import { compactMaterials } from "@si/ui/lib/materials";

const materialVariants = {
  // Drafted offset (brutal) — solid fill + a hard shadow offset
  "default-brutal": `bg-primary text-primary-foreground ${compactMaterials.brutal}`,
  "destructive-brutal": `bg-destructive text-destructive-foreground ${compactMaterials.brutal}`,
  "success-brutal": `bg-success text-success-foreground ${compactMaterials.brutal}`,
  "warning-brutal": `bg-warning text-warning-foreground ${compactMaterials.brutal}`,
  // Sheet chips (legacy "glass" — opaque sheet + solid rule)
  "default-glass": `${compactMaterials.glass} text-primary`,
  "destructive-glass": `${compactMaterials.glass} text-destructive`,
  "success-glass": `${compactMaterials.glass} text-success`,
  "warning-glass": `${compactMaterials.glass} text-warning`,
} as const;

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden rounded-sm border border-transparent font-body font-semibold leading-none whitespace-nowrap transition-all [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
        success: "bg-success text-success-foreground border-success",
        warning: "bg-warning text-warning-foreground border-warning",
        inverse: "bg-inverse text-inverse-foreground border-inverse",
        ...materialVariants,
      },
      size: {
        sm: "h-5 px-2 gap-1 text-xs [&>svg]:size-3!",
        default: "h-6 px-3 gap-1.5 text-sm [&>svg]:size-3.5!",
        lg: "h-7 px-3.5 gap-2 text-base [&>svg]:size-4!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
