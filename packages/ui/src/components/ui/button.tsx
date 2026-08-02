"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@si/ui/lib/utils";
import { interactiveMaterials } from "@si/ui/lib/materials";

// Buttons are compact proof controls with a quick, crisp press. Transitions
// are 150–200ms ease-out; active state scales to 0.97. Focus is a 2px solid
// ring offset from the control — never a soft glow.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-sm text-sm font-semibold whitespace-nowrap transition-all duration-150 ease-out outline-none select-none active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Default = Primary: solid primary fill + contrasting text. Semantic
        // tokens so a tenant's --color-primary retint reaches every button.
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        // Strong: primary fill + drafted offset — the hero CTA stands proud.
        strong:
          "bg-primary text-primary-foreground shadow-brutal-sm hover:bg-primary-hover hover:shadow-brutal-md",
        // Outline: transparent, heavy 1.5px rule.
        outline:
          "border-[1.5px] border-border-strong bg-transparent text-foreground hover:bg-surface-sunken active:scale-[0.97]",
        // Ghost / text only: recessed surface tint on hover.
        ghost: "bg-transparent text-foreground hover:bg-surface-sunken active:scale-[0.97]",
        // Inverse: fixed dark surface — a deliberately always-dark control.
        inverse: "bg-inverse text-inverse-foreground hover:bg-inverse/90",
        // Destructive — the red pen.
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
        // Link: dotted annotation underline that commits to solid on hover.
        link: "text-foreground underline decoration-dotted underline-offset-4 hover:decoration-solid",

        // === Backwards-compatible / platform variants ===
        // Secondary: quiet dashed-rule surface.
        secondary: `bg-card text-foreground ${interactiveMaterials.soft}`,
        // Neumorphic — chiseled surface.
        neo: `bg-secondary text-foreground ${interactiveMaterials.neo}`,
        // Legacy "glass" — opaque fresh sheet with a solid rule.
        glass: `text-foreground ${interactiveMaterials.glass}`,
        // Success — confirmation state (also carried by copy/icon).
        success: "bg-success text-success-foreground hover:bg-success/90",
      },
      size: {
        // Kit: sm 9×16 / md 13×22 / lg 16×26; font 13/15/17.
        default: "h-11 gap-2 px-[22px] text-[15px]",
        xs: "h-7 gap-1 px-3 text-xs",
        sm: "h-9 gap-1.5 px-4 text-[13px]",
        lg: "h-13 gap-2 px-[26px] text-[17px]",
        xl: "h-14 gap-2 px-8 text-lg",
        icon: "size-11",
        "icon-sm": "size-9",
        "icon-lg": "size-14",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
