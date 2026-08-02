"use client";

import { useFieldContext } from "@si/ui/hooks/form-context";
import { RadioGroup, RadioGroupItem } from "@si/ui/components/radio-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldTitle,
} from "@si/ui/components/field";

export function RadioField({
  legend,
  description,
  options,
  variant = "simple",
  legendVariant = "label",
  className,
}: {
  legend: string;
  description?: string;
  options: Array<{
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
  }>;
  variant?: "simple" | "card";
  legendVariant?: "legend" | "label";
  className?: string;
}) {
  const field = useFieldContext<string>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <FieldSet className={className}>
      <FieldLegend variant={legendVariant}>{legend}</FieldLegend>
      {description && <FieldDescription>{description}</FieldDescription>}
      <RadioGroup
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => field.handleChange(value)}
      >
        {options.map((opt) =>
          variant === "card" ? (
            <FieldLabel key={opt.value}>
              <Field orientation="horizontal" data-invalid={isInvalid || undefined}>
                <RadioGroupItem
                  value={opt.value}
                  id={`${field.name}-${opt.value}`}
                  aria-invalid={isInvalid || undefined}
                  disabled={opt.disabled}
                />
                <FieldContent>
                  <FieldTitle>{opt.label}</FieldTitle>
                  {opt.description && <FieldDescription>{opt.description}</FieldDescription>}
                </FieldContent>
              </Field>
            </FieldLabel>
          ) : (
            <Field key={opt.value} orientation="horizontal" data-invalid={isInvalid || undefined}>
              <RadioGroupItem
                value={opt.value}
                id={`${field.name}-${opt.value}`}
                aria-invalid={isInvalid || undefined}
                disabled={opt.disabled}
              />
              <FieldLabel htmlFor={`${field.name}-${opt.value}`} className="font-normal">
                {opt.label}
              </FieldLabel>
            </Field>
          ),
        )}
      </RadioGroup>
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </FieldSet>
  );
}
