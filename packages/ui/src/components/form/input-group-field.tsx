"use client";

import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { useFieldContext } from "@si/ui/hooks/form-context";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@si/ui/components/input-group";
import { Field, FieldDescription, FieldError, FieldLabel } from "@si/ui/components/field";
import type { fieldVariants } from "@si/ui/components/field";

export function InputGroupField({
  label,
  description,
  placeholder,
  type = "text",
  autoComplete,
  prefix,
  suffix,
  orientation,
  className,
  inputClassName,
}: {
  label: string;
  description?: string;
  placeholder?: string;
  type?: "text" | "email" | "password" | "url" | "tel" | "search" | "number";
  autoComplete?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
  inputClassName?: string;
} & VariantProps<typeof fieldVariants>) {
  const field = useFieldContext<string>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field data-invalid={isInvalid || undefined} orientation={orientation} className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={field.name}
          name={field.name}
          value={field.state.value}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
          aria-invalid={isInvalid || undefined}
          placeholder={placeholder}
          type={type}
          autoComplete={autoComplete}
          className={inputClassName}
        />
        {prefix && (
          <InputGroupAddon align="inline-start">
            {typeof prefix === "string" ? <InputGroupText>{prefix}</InputGroupText> : prefix}
          </InputGroupAddon>
        )}
        {suffix && (
          <InputGroupAddon align="inline-end">
            {typeof suffix === "string" ? <InputGroupText>{suffix}</InputGroupText> : suffix}
          </InputGroupAddon>
        )}
      </InputGroup>
      {description && <FieldDescription>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
