"use client";

import { useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { useFieldContext } from "@si/ui/hooks/form-context";
import { EyeIcon, EyeOffIcon, LockIcon } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@si/ui/components/input-group";
import { Field, FieldDescription, FieldError, FieldLabel } from "@si/ui/components/field";
import type { fieldVariants } from "@si/ui/components/field";

export function PasswordField({
  label,
  description,
  placeholder = "••••••••",
  autoComplete,
  showToggle = true,
  showLockIcon = true,
  orientation,
  className,
  inputClassName,
}: {
  label: string;
  description?: string;
  placeholder?: string;
  autoComplete?: string;
  showToggle?: boolean;
  showLockIcon?: boolean;
  className?: string;
  inputClassName?: string;
} & VariantProps<typeof fieldVariants>) {
  const field = useFieldContext<string>();
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
  const [visible, setVisible] = useState(false);

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
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className={inputClassName}
        />
        {showLockIcon && (
          <InputGroupAddon align="inline-start">
            <LockIcon />
          </InputGroupAddon>
        )}
        {showToggle && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={visible ? "Hide password" : "Show password"}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOffIcon /> : <EyeIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      {description && <FieldDescription>{description}</FieldDescription>}
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  );
}
