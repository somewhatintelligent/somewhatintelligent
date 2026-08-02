"use client";

import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { useFormContext } from "@si/ui/hooks/form-context";
import { Button, buttonVariants } from "@si/ui/components/button";
import { Spinner } from "@si/ui/components/spinner";

export function SubmitButton({
  label = "Submit",
  loadingLabel,
  children,
  variant = "default",
  size = "default",
  className,
}: {
  label?: string;
  loadingLabel?: string;
  children?: ReactNode;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  const form = useFormContext();

  return (
    <form.Subscribe
      selector={(state) => ({
        canSubmit: state.canSubmit,
        isSubmitting: state.isSubmitting,
      })}
    >
      {({ canSubmit, isSubmitting }) => (
        <Button
          type="submit"
          disabled={!canSubmit}
          variant={variant}
          size={size}
          className={className}
        >
          {isSubmitting ? (
            <>
              <Spinner size="xs" />
              {loadingLabel ?? label}
            </>
          ) : (
            (children ?? label)
          )}
        </Button>
      )}
    </form.Subscribe>
  );
}
