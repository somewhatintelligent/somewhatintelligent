import type { Meta, StoryObj } from "@storybook/react";
import { type } from "arktype";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { FieldSeparator } from "@si/ui/components/field";

const meta = {
  title: "Forms/useAppForm",
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// --- Basic Text Input ---

export const TextField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { name: "" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-80 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="name">
          {(field) => <field.TextField label="Full name" placeholder="Evil Rabbit" />}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Save" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Email Field ---

export const EmailField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { email: "" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-80 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="email">
          {(field) => (
            <field.EmailField label="Email address" description="We'll never share your email." />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Subscribe" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Password Field ---

export const PasswordField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { password: "" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-80 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="password">
          {(field) => <field.PasswordField label="Password" autoComplete="new-password" />}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Continue" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Textarea ---

export const TextareaField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { bio: "" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-96 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="bio">
          {(field) => (
            <field.TextareaField
              label="Bio"
              placeholder="Tell us about yourself..."
              description="Max 280 characters."
              rows={4}
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Save" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Select ---

export const SelectField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { role: "" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-80 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="role">
          {(field) => (
            <field.SelectField
              label="Role"
              description="Controls access level."
              options={[
                { value: "admin", label: "Admin" },
                { value: "editor", label: "Editor" },
                { value: "viewer", label: "Viewer" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Assign" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Switch ---

export const SwitchField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { notifications: false, marketing: false },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-96 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="notifications">
          {(field) => (
            <field.SwitchField
              label="Push notifications"
              description="Get notified about account activity."
            />
          )}
        </form.AppField>
        <form.AppField name="marketing">
          {(field) => <field.SwitchField label="Marketing emails" />}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Save preferences" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Checkbox ---

export const CheckboxField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { terms: false },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-96 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="terms">
          {(field) => (
            <field.CheckboxField
              label="I accept the terms and conditions"
              description="You agree to our Terms of Service and Privacy Policy."
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Create account" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Checkbox Group ---

export const CheckboxGroupField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { interests: [] as string[] },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-96 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="interests">
          {(field) => (
            <field.CheckboxGroupField
              legend="Interests"
              description="Select topics you want to follow."
              options={[
                { value: "design", label: "Design" },
                { value: "engineering", label: "Engineering" },
                { value: "product", label: "Product" },
                { value: "research", label: "Research", disabled: true },
              ]}
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Save" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Radio Field ---

export const RadioField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { plan: "free" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-80 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="plan">
          {(field) => (
            <field.RadioField
              legend="Plan"
              description="Choose a billing plan."
              options={[
                { value: "free", label: "Free" },
                { value: "pro", label: "Pro" },
                { value: "enterprise", label: "Enterprise" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Choose plan" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Radio Choice Cards ---

export const RadioChoiceCards: Story = {
  name: "Radio (Choice Cards)",
  render: function Render() {
    const form = useAppForm({
      defaultValues: { plan: "pro" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-96 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="plan">
          {(field) => (
            <field.RadioField
              legend="Plan"
              variant="card"
              options={[
                { value: "free", label: "Free", description: "Basic features, 1 project." },
                {
                  value: "pro",
                  label: "Pro",
                  description: "Unlimited projects, priority support.",
                },
                {
                  value: "enterprise",
                  label: "Enterprise",
                  description: "Custom limits, SSO, SLA.",
                },
              ]}
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Upgrade" />
        </form.AppForm>
      </form>
    );
  },
};

// --- Slider ---

export const SliderField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { volume: 50 },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-80 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="volume">
          {(field) => <field.SliderField label="Volume" description="Notification volume level." />}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Save" />
        </form.AppForm>
      </form>
    );
  },
};

// --- InputGroup (prefix/suffix) ---

export const InputGroupField: Story = {
  render: function Render() {
    const form = useAppForm({
      defaultValues: { website: "", handle: "" },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-96 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="website">
          {(field) => (
            <field.InputGroupField label="Website" placeholder="example.com" prefix="https://" />
          )}
        </form.AppField>
        <form.AppField name="handle">
          {(field) => (
            <field.InputGroupField
              label="Handle"
              placeholder="evil-rabbit"
              prefix="@"
              suffix=".platform.example"
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Save" />
        </form.AppForm>
      </form>
    );
  },
};

// --- With ArkType Validation ---

const profileSchema = type({
  name: "string >= 2",
  email: "string.email",
  bio: "string >= 10",
});

export const WithValidation: Story = {
  name: "With ArkType Validation",
  render: function Render() {
    const form = useAppForm({
      defaultValues: { name: "", email: "", bio: "" },
      validators: { onBlur: profileSchema },
      onSubmit: async ({ value }) => alert(JSON.stringify(value)),
    });

    return (
      <form
        className="flex w-96 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" placeholder="Evil Rabbit" />}
        </form.AppField>
        <form.AppField name="email">{(field) => <field.EmailField label="Email" />}</form.AppField>
        <form.AppField name="bio">
          {(field) => (
            <field.TextareaField label="Bio" placeholder="Tell us about yourself..." rows={3} />
          )}
        </form.AppField>
        <form.AppForm>
          <div className="flex gap-2">
            <form.SubmitButton label="Save" />
            <form.ResetButton />
          </div>
        </form.AppForm>
      </form>
    );
  },
};

// --- Full Kitchen Sink ---

const kitchenSinkSchema = type({
  displayName: "string >= 2",
  email: "string.email",
  password: "string >= 8",
  bio: "string >= 10",
  role: "string >= 1",
  plan: "string >= 1",
  volume: "number",
  newsletter: "boolean",
  twoFactor: "boolean",
  terms: "boolean",
  interests: "string[] >= 1",
  website: "string",
});

export const KitchenSink: Story = {
  name: "Kitchen Sink",
  render: function Render() {
    const form = useAppForm({
      defaultValues: {
        displayName: "",
        email: "",
        password: "",
        bio: "",
        role: "",
        plan: "free",
        volume: 75,
        newsletter: true,
        twoFactor: false,
        terms: false,
        interests: [] as string[],
        website: "",
      },
      validators: { onBlur: kitchenSinkSchema },
      onSubmit: async ({ value }) => alert(JSON.stringify(value, null, 2)),
    });

    return (
      <form
        className="flex w-[28rem] flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {/* Profile */}
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-medium">Profile</h3>
          <form.AppField name="displayName">
            {(field) => <field.TextField label="Display name" placeholder="Evil Rabbit" />}
          </form.AppField>
          <form.AppField name="email">
            {(field) => <field.EmailField label="Email" />}
          </form.AppField>
          <form.AppField name="website">
            {(field) => (
              <field.InputGroupField label="Website" placeholder="example.com" prefix="https://" />
            )}
          </form.AppField>
          <form.AppField name="bio">
            {(field) => (
              <field.TextareaField
                label="Bio"
                placeholder="A few words about yourself..."
                rows={3}
              />
            )}
          </form.AppField>
          <form.AppField name="role">
            {(field) => (
              <field.SelectField
                label="Role"
                options={[
                  { value: "admin", label: "Admin" },
                  { value: "editor", label: "Editor" },
                  { value: "viewer", label: "Viewer" },
                ]}
              />
            )}
          </form.AppField>
        </div>

        <FieldSeparator />

        {/* Security */}
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-medium">Security</h3>
          <form.AppField name="password">
            {(field) => <field.PasswordField label="Password" autoComplete="new-password" />}
          </form.AppField>
          <form.AppField name="twoFactor">
            {(field) => (
              <field.SwitchField
                label="Two-factor authentication"
                description="Add an extra layer of security."
              />
            )}
          </form.AppField>
        </div>

        <FieldSeparator />

        {/* Preferences */}
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-medium">Preferences</h3>
          <form.AppField name="plan">
            {(field) => (
              <field.RadioField
                legend="Plan"
                variant="card"
                options={[
                  { value: "free", label: "Free", description: "Basic features." },
                  { value: "pro", label: "Pro", description: "Unlimited everything." },
                  { value: "enterprise", label: "Enterprise", description: "Custom SLA." },
                ]}
              />
            )}
          </form.AppField>
          <form.AppField name="volume">
            {(field) => <field.SliderField label="Notification volume" />}
          </form.AppField>
          <form.AppField name="newsletter">
            {(field) => <field.SwitchField label="Newsletter" />}
          </form.AppField>
          <form.AppField name="interests">
            {(field) => (
              <field.CheckboxGroupField
                legend="Interests"
                options={[
                  { value: "design", label: "Design" },
                  { value: "engineering", label: "Engineering" },
                  { value: "product", label: "Product" },
                ]}
              />
            )}
          </form.AppField>
        </div>

        <FieldSeparator />

        <form.AppField name="terms">
          {(field) => <field.CheckboxField label="I accept the terms and conditions" />}
        </form.AppField>

        <form.AppForm>
          <div className="flex gap-2">
            <form.SubmitButton label="Create account" />
            <form.ResetButton />
          </div>
        </form.AppForm>
      </form>
    );
  },
};
