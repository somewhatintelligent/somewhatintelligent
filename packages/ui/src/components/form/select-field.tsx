"use client";

import type { ReactNode } from "react";
import { useFieldContext } from "@si/ui/hooks/form-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@si/ui/components/select";
import { Field, FieldDescription, FieldError, FieldLabel } from "@si/ui/components/field";

export function SelectField({
  label,
  description,
  placeholder = "Select...",
  options,
  children,
  triggerSize,
  className,
}: {
  label: string;
  description?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  children?: ReactNode;
  triggerSize?: "sm" | "default";
  className?: string;
}) {
  const field = useFieldContext<string>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;

  return (
    <Field data-invalid={isInvalid || undefined} className={className}>
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Select
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => {
          if (value != null) field.handleChange(value);
        }}
      >
        <SelectTrigger
          id={field.name}
          aria-invalid={isInvalid || undefined}
          size={triggerSize}
          className="w-full"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options
            ? options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </SelectItem>
              ))
            : children}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
