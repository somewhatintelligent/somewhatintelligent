"use client";

import type { VariantProps } from "class-variance-authority";
import { useFieldContext } from "@si/ui/hooks/form-context";
import { Textarea } from "@si/ui/components/textarea";
import { Field, FieldDescription, FieldError, FieldLabel } from "@si/ui/components/field";
import type { fieldVariants } from "@si/ui/components/field";

export function TextareaField({
  label,
  description,
  placeholder,
  rows,
  orientation,
  className,
  inputClassName,
}: {
  label: string;
  description?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  inputClassName?: string;
} & VariantProps<typeof fieldVariants>) {
  const field = useFieldContext<string>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field data-invalid={isInvalid || undefined} orientation={orientation} className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Textarea
        id={field.name}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid || undefined}
        placeholder={placeholder}
        rows={rows}
        className={inputClassName}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
