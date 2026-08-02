# @si/ui

Component library for the platform, built on [Base UI](https://base-ui.com) primitives and styled per the design system in `templates/design/DESIGN_SYSTEM.md`.

## Quick start

```ts
// Import a component
import { Button } from "@si/ui/components/button";

// Import a utility
import { cn } from "@si/ui/lib/utils";

// Import the form hook
import { useAppForm } from "@si/ui/hooks/use-app-form";
```

All components are consumed via the `@si/ui` package alias. The export map supports three entry points:

| Pattern               | Resolves to               | Example                                |
| --------------------- | ------------------------- | -------------------------------------- |
| `@si/ui`              | `src/components/index.ts` | Barrel re-export of core UI primitives |
| `@si/ui/components/*` | `src/components/ui/*.tsx` | `@si/ui/components/button`             |
| `@si/ui/lib/*`        | `src/lib/*.ts`            | `@si/ui/lib/utils`                     |

Form components and hooks are imported directly:

```ts
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { TextField } from "@si/ui/components/form/text-field";
```

## Storybook

Stories live next to their components (`*.stories.tsx`).

---

## Design system

Every component follows the design system defined in `templates/design/DESIGN_SYSTEM.md`. The key principles:

- **Cold paper / garment black** — a near-achromatic system with signal pink reserved for primary action and authorial correction
- **No soft shadows, no blur** — depth is drawn with border treatment and hard-offset lines, never a diffused shadow or `backdrop-filter`
- **Depth is border treatment** — solid / dashed / dotted rules carry emphasis and state; `shadow-brutal-*` adds a hard offset
- **Nearly square** — `rounded-sm` (2px) is the control default and `rounded-xl` tops out at 6px; circles remain circular
- **Three voices** — Barlow Condensed for public claims, Source Serif 4 for interface/editorial copy, and Iosevka for evidence and state

### Materials

Components accept material variants through their existing `variant` props. The shared class strings live in `lib/materials.ts`:

```ts
import { surfaceMaterials, interactiveMaterials } from "@si/ui/lib/materials";
```

| Material | Surface use                                                      | Interactive use                                                  |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `brutal` | Cards, alerts — solid rule + drafted offset (`shadow-brutal-sm`) | Buttons, badges — offset grows on hover, collapses on press      |
| `soft`   | Secondary containers — dashed rule, flat                         | Secondary buttons/badges — dashed rule commits to solid on hover |
| `neo`    | Neumorphic raised/inset                                          | Toggle-like — flips raised to inset                              |
| `glass`  | Legacy name — opaque sheet + solid rule (no blur)                | Legacy name — rule strengthens on hover                          |

---

## Components

### Layout & containers

| Component   | Description                                                         |
| ----------- | ------------------------------------------------------------------- |
| `Card`      | Surface container with `brutal` / `soft` / `neo` / `glass` variants |
| `Separator` | Horizontal/vertical divider                                         |
| `Tabs`      | Tabbed content switcher                                             |
| `Accordion` | Collapsible content sections                                        |

### Navigation

| Component    | Description            |
| ------------ | ---------------------- |
| `Breadcrumb` | Hierarchical page path |

### Actions

| Component     | Description                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`      | Primary action — variants: `default`, `strong`, `secondary`, `outline`, `ghost`, `inverse`, `destructive`, `neo`, `glass`, `success`, `link` |
| `ButtonGroup` | Group buttons with separators                                                                                                                |
| `Toggle`      | Pressable on/off button                                                                                                                      |
| `ToggleGroup` | Exclusive or multi-select toggle set                                                                                                         |

### Overlays

| Component      | Description                            |
| -------------- | -------------------------------------- |
| `Dialog`       | Modal dialog (glass material)          |
| `AlertDialog`  | Confirmation dialog with cancel/action |
| `Sheet`        | Slide-out panel from any edge          |
| `Drawer`       | Bottom drawer (via Vaul)               |
| `Popover`      | Floating content anchored to a trigger |
| `DropdownMenu` | Contextual menu                        |
| `Tooltip`      | Hover/focus hint                       |

### Data display

| Component        | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `Avatar`         | User image with fallback                                     |
| `Badge`          | Status/label indicator with accent color variants            |
| `Kbd`            | Keyboard shortcut display                                    |
| `Item`           | Rich list item with media, content, actions                  |
| `Spinner`        | Pulsing loading indicator                                    |
| `Alert`          | Inline notification with optional action                     |
| `SearchCombobox` | Debounced async search input with keyboard-navigable results |

### Form primitives

| Component                       | Description                                                               |
| ------------------------------- | ------------------------------------------------------------------------- |
| `Input`                         | Text input — `border-2 border-border-strong rounded-sm bg-surface-raised` |
| `Textarea`                      | Multi-line text input                                                     |
| `Label`                         | Accessible label                                                          |
| `Select`                        | Dropdown select with glass popup                                          |
| `Checkbox`                      | Boolean checkbox                                                          |
| `RadioGroup` / `RadioGroupItem` | Single-select option group                                                |
| `Switch`                        | Toggle switch (neumorphic material)                                       |
| `Slider`                        | Range input with brutalist thumb                                          |
| `InputGroup`                    | Compose inputs with icons, text, buttons, kbd shortcuts                   |

### Form layout

| Component          | Description                                                                  |
| ------------------ | ---------------------------------------------------------------------------- |
| `Field`            | Core field wrapper — `orientation`: `vertical` / `horizontal` / `responsive` |
| `FieldLabel`       | Label inside a Field                                                         |
| `FieldDescription` | Helper text                                                                  |
| `FieldError`       | Error display — accepts `errors` array or children                           |
| `FieldContent`     | Flex column grouping label + description (for horizontal layouts)            |
| `FieldTitle`       | Non-label heading inside FieldContent                                        |
| `FieldSet`         | Semantic `<fieldset>` with spacing                                           |
| `FieldLegend`      | Legend with `legend` or `label` variant                                      |
| `FieldGroup`       | Stacks Fields with container queries for responsive layout                   |
| `FieldSeparator`   | Divider between field groups, optional inline text                           |

### Feedback

| Component | Description                      |
| --------- | -------------------------------- |
| `Sonner`  | Toast notifications (via Sonner) |

---

## Forms — `useAppForm`

The form system is built on [TanStack Form](https://tanstack.com/form) with pre-bound field components that wrap the UI primitives above. Validation uses [ArkType](https://arktype.io) via Standard Schema — no adapter required.

### Setup

```ts
// hooks/use-app-form.ts is already configured with all field + form components.
import { useAppForm } from "@si/ui/hooks/use-app-form";
```

### Basic usage

```tsx
import { type } from "arktype";
import { useAppForm } from "@si/ui/hooks/use-app-form";

const schema = type({
  name: "string >= 2",
  email: "string.email",
});

function ProfileForm() {
  const form = useAppForm({
    defaultValues: { name: "", email: "" },
    validators: { onBlur: schema },
    onSubmit: async ({ value }) => {
      await saveProfile(value);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Name" placeholder="Evil Rabbit" />}
      </form.AppField>
      <form.AppField name="email">{(field) => <field.EmailField label="Email" />}</form.AppField>
      <form.AppForm>
        <form.SubmitButton label="Save" />
        <form.ResetButton />
      </form.AppForm>
    </form>
  );
}
```

### Pre-bound field components

Each field component is accessed via `field.<Component>` inside `form.AppField`'s render prop. They handle layout (`Field`, `FieldLabel`, `FieldDescription`, `FieldError`), state binding (`value`, `onChange`, `onBlur`), and validation display automatically.

#### Text inputs

| Component         | Value type | Description                                                    |
| ----------------- | ---------- | -------------------------------------------------------------- |
| `TextField`       | `string`   | Standard text input                                            |
| `TextareaField`   | `string`   | Multi-line text input                                          |
| `EmailField`      | `string`   | Input with mail icon prefix                                    |
| `PasswordField`   | `string`   | Input with lock icon + visibility toggle                       |
| `InputGroupField` | `string`   | Input with arbitrary `prefix` / `suffix` (string or ReactNode) |

```tsx
// TextField
<field.TextField label="Name" placeholder="Evil Rabbit" type="text" />

// TextareaField
<field.TextareaField label="Bio" placeholder="..." rows={4} description="Max 280 chars." />

// EmailField — auto mail icon, type="email", autoComplete="email"
<field.EmailField label="Email" suffix="@example.com" />

// PasswordField — lock icon, eye toggle, password/text type switch
<field.PasswordField label="Password" autoComplete="new-password" showLockIcon showToggle />

// InputGroupField — prefix/suffix as string or ReactNode
<field.InputGroupField label="Website" prefix="https://" placeholder="example.com" />
```

#### Selection

| Component            | Value type | Description                                             |
| -------------------- | ---------- | ------------------------------------------------------- |
| `SelectField`        | `string`   | Dropdown select from `options` array or custom children |
| `RadioField`         | `string`   | Radio group — `variant`: `simple` or `card`             |
| `CheckboxGroupField` | `string[]` | Multi-select checkboxes from `options` array            |

```tsx
// SelectField
<field.SelectField
  label="Role"
  options={[
    { value: "admin", label: "Admin" },
    { value: "editor", label: "Editor" },
  ]}
/>

// RadioField — simple
<field.RadioField
  legend="Plan"
  options={[
    { value: "free", label: "Free" },
    { value: "pro", label: "Pro" },
  ]}
/>

// RadioField — choice cards
<field.RadioField
  legend="Plan"
  variant="card"
  options={[
    { value: "free", label: "Free", description: "Basic features." },
    { value: "pro", label: "Pro", description: "Unlimited everything." },
  ]}
/>

// CheckboxGroupField
<field.CheckboxGroupField
  legend="Interests"
  description="Select topics to follow."
  options={[
    { value: "design", label: "Design" },
    { value: "eng", label: "Engineering" },
  ]}
/>
```

#### Toggles & ranges

| Component       | Value type | Description                                |
| --------------- | ---------- | ------------------------------------------ |
| `CheckboxField` | `boolean`  | Single checkbox with label + description   |
| `SwitchField`   | `boolean`  | Horizontal switch with label + description |
| `SliderField`   | `number`   | Range slider with `min`, `max`, `step`     |

```tsx
// CheckboxField
<field.CheckboxField label="Accept terms" description="You agree to our ToS." />

// SwitchField
<field.SwitchField label="Push notifications" description="Get alerts about activity." />

// SliderField
<field.SliderField label="Volume" min={0} max={100} step={5} />
```

### Pre-bound form components

Form-level components are accessed inside `form.AppForm`:

| Component      | Description                                                            |
| -------------- | ---------------------------------------------------------------------- |
| `SubmitButton` | Reactive submit — disables when invalid, shows spinner when submitting |
| `ResetButton`  | Resets form — disables when pristine                                   |

```tsx
<form.AppForm>
  <form.SubmitButton label="Save" loadingLabel="Saving..." />
  <form.ResetButton label="Discard changes" />
</form.AppForm>
```

### Validation with ArkType

ArkType implements Standard Schema, so schemas pass directly to `validators` — no adapter:

```tsx
import { type } from "arktype";

const form = useAppForm({
  defaultValues: { name: "", age: 0 },
  validators: {
    onBlur: type({ name: "string >= 2", age: "number >= 18" }), // validate on blur
    onChange: type({ name: "string >= 2", age: "number >= 18" }), // validate on change
    onSubmit: type({ name: "string >= 2", age: "number >= 18" }), // validate on submit
  },
});
```

Errors are automatically displayed by each field component when `field.state.meta.isTouched && !field.state.meta.isValid`.

### Breaking forms apart with `withForm`

For large forms, split into sub-components while keeping full type safety:

```tsx
import { useAppForm, withForm } from "@si/ui/hooks/use-app-form";

const SecuritySection = withForm({
  defaultValues: { password: "", twoFactor: false },
  render: function Render({ form }) {
    return (
      <>
        <form.AppField name="password">
          {(field) => <field.PasswordField label="Password" />}
        </form.AppField>
        <form.AppField name="twoFactor">
          {(field) => <field.SwitchField label="Two-factor auth" />}
        </form.AppField>
      </>
    );
  },
});

function SettingsPage() {
  const form = useAppForm({
    defaultValues: { password: "", twoFactor: false },
    onSubmit: async ({ value }) => {
      /* ... */
    },
  });
  return <SecuritySection form={form} />;
}
```

### Reusable field groups with `withFieldGroup`

For field combinations used across multiple forms (e.g., password + confirm):

```tsx
import { withFieldGroup } from "@si/ui/hooks/use-app-form";

const PasswordFields = withFieldGroup({
  defaultValues: { password: "", confirmPassword: "" },
  render: function Render({ group }) {
    return (
      <>
        <group.AppField name="password">
          {(field) => <field.PasswordField label="Password" />}
        </group.AppField>
        <group.AppField
          name="confirmPassword"
          validators={{
            onChangeListenTo: ["password"],
            onChange: ({ value, fieldApi }) => {
              if (value !== group.getFieldValue("password")) {
                return "Passwords do not match";
              }
              return undefined;
            },
          }}
        >
          {(field) => <field.PasswordField label="Confirm password" />}
        </group.AppField>
      </>
    );
  },
});

// Use in any form with matching fields
<PasswordFields form={form} fields="account" />;
```

---

## Lib utilities

| Export                 | Module                 | Description                                                |
| ---------------------- | ---------------------- | ---------------------------------------------------------- |
| `cn(...classes)`       | `@si/ui/lib/utils`     | Merges class names via `clsx` + `tailwind-merge`           |
| `surfaceMaterials`     | `@si/ui/lib/materials` | Static surface class strings (brutal, soft, neo, glass)    |
| `interactiveMaterials` | `@si/ui/lib/materials` | Interactive element class strings with hover/active states |
| `compactMaterials`     | `@si/ui/lib/materials` | Compact element class strings (badges)                     |

---

## Dependencies

| Package                    | Role                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `@base-ui/react`           | Headless UI primitives (Select, Switch, Checkbox, Radio, Slider, etc.) |
| `@tanstack/react-form`     | Form state management, validation, composition                         |
| `arktype`                  | Schema validation via Standard Schema                                  |
| `class-variance-authority` | Variant-based class composition                                        |
| `clsx` + `tailwind-merge`  | Class name merging                                                     |
| `lucide-react`             | Icons                                                                  |
| `motion`                   | Animations                                                             |
| `sonner`                   | Toast notifications                                                    |
| `vaul`                     | Drawer component                                                       |

Peer: `react` ^19, `react-dom` ^19.
