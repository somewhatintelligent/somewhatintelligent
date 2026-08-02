"use client";

import { useFieldContext } from "@si/ui/hooks/form-context";
import { Switch } from "@si/ui/components/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@si/ui/components/field";

export function SwitchField({
  label,
  description,
  size,
  className,
}: {
  label: string;
  description?: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const field = useFieldContext<boolean>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field orientation="horizontal" data-invalid={isInvalid || undefined} className={className}>
      <Switch
        id={field.name}
        name={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
        aria-invalid={isInvalid || undefined}
        size={size}
      />
      <FieldContent>
        <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
        {isInvalid && <FieldError errors={field.state.meta.errors} />}
      </FieldContent>
    </Field>
  );
}
