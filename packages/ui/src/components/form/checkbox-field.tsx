"use client";

import { useFieldContext } from "@si/ui/hooks/form-context";
import { Checkbox } from "@si/ui/components/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@si/ui/components/field";

export function CheckboxField({
  label,
  description,
  className,
  checkboxClassName,
}: {
  label: string;
  description?: string;
  className?: string;
  checkboxClassName?: string;
}) {
  const field = useFieldContext<boolean>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field orientation="horizontal" data-invalid={isInvalid || undefined} className={className}>
      <Checkbox
        id={field.name}
        name={field.name}
        checked={field.state.value}
        onCheckedChange={(checked) => field.handleChange(checked)}
        aria-invalid={isInvalid || undefined}
        className={checkboxClassName}
      />
      <FieldContent>
        <FieldLabel htmlFor={field.name} className="font-normal">
          {label}
        </FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
        {isInvalid && <FieldError errors={field.state.meta.errors} />}
      </FieldContent>
    </Field>
  );
}
