import { Suspense, lazy, type ComponentProps, type ComponentType } from "react";
import { createFormHook } from "@tanstack/react-form";
import { fieldContext, formContext } from "./form-context";

// Each field is a chunk-split point so importing useAppForm doesn't drag the
// whole form kit (sliders, base-ui select, etc.) into every route that only
// uses, say, an email + password pair.
//
// CRITICAL: every lazy field carries its OWN <Suspense> boundary. Without it,
// the first render of an unloaded field suspends to the closest ancestor
// boundary — in TanStack Router that's the ROUTE-level one — and React hides
// the ENTIRE committed route subtree (`display:none !important`) while the
// chunk loads. That collapsed the document, so the browser clamped scroll to
// the top: the "first product click scrolls to top" bug (the review composer's
// textarea was the suspending chunk), and the same full-page blink on first
// open of any admin form dialog. A local boundary keeps the loading blip
// scoped to the field itself.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic component bound
function lazyField<C extends ComponentType<any>>(load: () => Promise<{ default: C }>): C {
  const Lazy = lazy(load);
  function FieldWithBoundary(props: ComponentProps<C>) {
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return FieldWithBoundary as unknown as C;
}

const TextField = lazyField(() =>
  import("@si/ui/components/form/text-field").then((m) => ({ default: m.TextField })),
);
const TextareaField = lazyField(() =>
  import("@si/ui/components/form/textarea-field").then((m) => ({
    default: m.TextareaField,
  })),
);
const SelectField = lazyField(() =>
  import("@si/ui/components/form/select-field").then((m) => ({ default: m.SelectField })),
);
const CheckboxField = lazyField(() =>
  import("@si/ui/components/form/checkbox-field").then((m) => ({
    default: m.CheckboxField,
  })),
);
const CheckboxGroupField = lazyField(() =>
  import("@si/ui/components/form/checkbox-group-field").then((m) => ({
    default: m.CheckboxGroupField,
  })),
);
const RadioField = lazyField(() =>
  import("@si/ui/components/form/radio-field").then((m) => ({ default: m.RadioField })),
);
const SwitchField = lazyField(() =>
  import("@si/ui/components/form/switch-field").then((m) => ({ default: m.SwitchField })),
);
const SliderField = lazyField(() =>
  import("@si/ui/components/form/slider-field").then((m) => ({ default: m.SliderField })),
);
const PasswordField = lazyField(() =>
  import("@si/ui/components/form/password-field").then((m) => ({
    default: m.PasswordField,
  })),
);
const EmailField = lazyField(() =>
  import("@si/ui/components/form/email-field").then((m) => ({ default: m.EmailField })),
);
const InputGroupField = lazyField(() =>
  import("@si/ui/components/form/input-group-field").then((m) => ({
    default: m.InputGroupField,
  })),
);
const SubmitButton = lazyField(() =>
  import("@si/ui/components/form/submit-button").then((m) => ({ default: m.SubmitButton })),
);
const ResetButton = lazyField(() =>
  import("@si/ui/components/form/reset-button").then((m) => ({ default: m.ResetButton })),
);

export const { useAppForm, withForm, withFieldGroup } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    SelectField,
    CheckboxField,
    CheckboxGroupField,
    RadioField,
    SwitchField,
    SliderField,
    PasswordField,
    EmailField,
    InputGroupField,
  },
  formComponents: {
    SubmitButton,
    ResetButton,
  },
});
