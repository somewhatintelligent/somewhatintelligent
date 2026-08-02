"use client";

import type { VariantProps } from "class-variance-authority";
import { useFieldContext } from "@si/ui/hooks/form-context";
import { Slider } from "@si/ui/components/slider";
import { Field, FieldDescription, FieldError, FieldLabel } from "@si/ui/components/field";
import type { fieldVariants } from "@si/ui/components/field";

export function SliderField({
  label,
  description,
  min = 0,
  max = 100,
  step = 1,
  orientation,
  className,
  sliderClassName,
}: {
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  sliderClassName?: string;
} & VariantProps<typeof fieldVariants>) {
  const field = useFieldContext<number>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field data-invalid={isInvalid || undefined} orientation={orientation} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Slider
        value={[field.state.value]}
        onValueChange={(value) => {
          const num = Array.isArray(value) ? value[0] : value;
          field.handleChange(num as number);
        }}
        min={min}
        max={max}
        step={step}
        className={sliderClassName}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
