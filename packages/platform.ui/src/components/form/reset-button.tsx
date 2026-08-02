"use client";

import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { useFormContext } from "platform.ui/hooks/form-context";
import { Button, buttonVariants } from "platform.ui/components/button";

export function ResetButton({
  label = "Reset",
  children,
  variant = "outline",
  size = "default",
  className,
}: {
  label?: string;
  children?: ReactNode;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.isPristine}>
      {(isPristine) => (
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={isPristine}
          onClick={() => form.reset()}
          className={className}
        >
          {children ?? label}
        </Button>
      )}
    </form.Subscribe>
  );
}
