"use client";

import type { ReactNode } from "react";
import type { VariantProps } from "class-variance-authority";
import { useFieldContext } from "@si/ui/hooks/form-context";
import { MailIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@si/ui/components/input-group";
import { Field, FieldDescription, FieldError, FieldLabel } from "@si/ui/components/field";
import type { fieldVariants } from "@si/ui/components/field";

export function EmailField({
  label,
  description,
  placeholder = "you@example.com",
  suffix,
  orientation,
  className,
  inputClassName,
  autoComplete = "email",
}: {
  label: string;
  description?: string;
  placeholder?: string;
  suffix?: ReactNode;
  className?: string;
  inputClassName?: string;
  autoComplete?: string;
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
          type="email"
          autoComplete={autoComplete}
          spellCheck={false}
          className={inputClassName}
        />
        <InputGroupAddon align="inline-start">
          <MailIcon />
        </InputGroupAddon>
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
