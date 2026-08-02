"use client";

import { useFieldContext } from "@si/ui/hooks/form-context";
import { Checkbox } from "@si/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@si/ui/components/field";

export function CheckboxGroupField({
  legend,
  description,
  options,
  legendVariant = "label",
  className,
}: {
  legend: string;
  description?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  legendVariant?: "legend" | "label";
  className?: string;
}) {
  const field = useFieldContext<string[]>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <FieldSet className={className}>
      <FieldLegend variant={legendVariant}>{legend}</FieldLegend>
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldGroup data-slot="checkbox-group">
        {options.map((opt) => (
          <Field key={opt.value} orientation="horizontal" data-invalid={isInvalid || undefined}>
            <Checkbox
              id={`${field.name}-${opt.value}`}
              aria-invalid={isInvalid || undefined}
              checked={field.state.value.includes(opt.value)}
              disabled={opt.disabled}
              onCheckedChange={(checked) => {
                if (checked) {
                  field.handleChange([...field.state.value, opt.value]);
                } else {
                  field.handleChange(field.state.value.filter((v) => v !== opt.value));
                }
              }}
            />
            <FieldLabel htmlFor={`${field.name}-${opt.value}`} className="font-normal">
              {opt.label}
            </FieldLabel>
          </Field>
        ))}
      </FieldGroup>
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </FieldSet>
  );
}
