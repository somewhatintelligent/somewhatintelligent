import type { Meta, StoryObj } from "@storybook/react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "./field";
import { Input } from "./input";
import { Textarea } from "./textarea";
import { Switch } from "./switch";
import { Checkbox } from "./checkbox";
import { Slider } from "./slider";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "./input-group";
import { EyeIcon, LinkIcon, LockIcon } from "lucide-react";

const meta = {
  title: "UI/Field",
  component: Field,
  tags: ["autodocs"],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

// --- Basic Field with Input ---

export const Default: Story = {
  render: () => (
    <Field className="w-80">
      <FieldLabel htmlFor="name">Full name</FieldLabel>
      <Input id="name" placeholder="Evil Rabbit" autoComplete="off" />
    </Field>
  ),
};

export const WithDescription: Story = {
  render: () => (
    <Field className="w-80">
      <FieldLabel htmlFor="email">Email</FieldLabel>
      <Input id="email" type="email" placeholder="you@example.com" />
      <FieldDescription>We never share your email with anyone.</FieldDescription>
    </Field>
  ),
};

export const WithError: Story = {
  render: () => (
    <Field className="w-80" data-invalid="true">
      <FieldLabel htmlFor="username">Username</FieldLabel>
      <Input id="username" defaultValue="admin" aria-invalid autoComplete="off" />
      <FieldError>That username is already taken.</FieldError>
    </Field>
  ),
};

export const WithErrorArray: Story = {
  name: "With Error Array",
  render: () => (
    <Field className="w-80" data-invalid="true">
      <FieldLabel htmlFor="password">Password</FieldLabel>
      <Input id="password" type="password" aria-invalid />
      <FieldError
        errors={[
          { message: "Must be at least 8 characters." },
          { message: "Must contain a number." },
          { message: "Must contain a special character." },
        ]}
      />
    </Field>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Field className="w-80" data-disabled="true">
      <FieldLabel htmlFor="locked">API Key</FieldLabel>
      <Input id="locked" defaultValue="sk_live_abc123" disabled />
      <FieldDescription>Contact support to rotate your key.</FieldDescription>
    </Field>
  ),
};

// --- Textarea ---

export const TextareaField: Story = {
  name: "Textarea",
  render: () => (
    <Field className="w-96">
      <FieldLabel htmlFor="bio">Bio</FieldLabel>
      <Textarea id="bio" placeholder="Tell us about yourself..." />
      <FieldDescription>Max 280 characters.</FieldDescription>
    </Field>
  ),
};

// --- Select ---

export const SelectField: Story = {
  name: "Select",
  render: () => (
    <Field className="w-80">
      <FieldLabel htmlFor="role">Role</FieldLabel>
      <Select defaultValue="viewer">
        <SelectTrigger id="role" className="w-full">
          <SelectValue placeholder="Select a role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="editor">Editor</SelectItem>
          <SelectItem value="viewer">Viewer</SelectItem>
        </SelectContent>
      </Select>
      <FieldDescription>Controls access level for this user.</FieldDescription>
    </Field>
  ),
};

// --- Slider ---

export const SliderField: Story = {
  name: "Slider",
  render: () => (
    <Field className="w-80">
      <FieldLabel>Volume</FieldLabel>
      <Slider defaultValue={[60]} max={100} step={1} />
      <FieldDescription>Adjust notification volume.</FieldDescription>
    </Field>
  ),
};

// --- Checkbox ---

export const CheckboxField: Story = {
  name: "Checkbox",
  render: () => (
    <Field orientation="horizontal" className="w-80">
      <Checkbox id="terms" />
      <FieldContent>
        <FieldLabel htmlFor="terms">Accept terms and conditions</FieldLabel>
        <FieldDescription>
          You agree to our <a href="#">Terms of Service</a> and <a href="#">Privacy Policy</a>.
        </FieldDescription>
      </FieldContent>
    </Field>
  ),
};

export const CheckboxGroup: Story = {
  name: "Checkbox Group",
  render: () => (
    <FieldSet className="w-96">
      <FieldLegend>Interests</FieldLegend>
      <FieldDescription>Select topics you want to follow.</FieldDescription>
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox id="cb-design" defaultChecked />
          <FieldLabel htmlFor="cb-design">Design</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="cb-eng" />
          <FieldLabel htmlFor="cb-eng">Engineering</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="cb-product" />
          <FieldLabel htmlFor="cb-product">Product</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Checkbox id="cb-research" disabled />
          <FieldLabel htmlFor="cb-research">Research (coming soon)</FieldLabel>
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

// --- Radio ---

export const RadioField: Story = {
  name: "Radio",
  render: () => (
    <FieldSet className="w-80">
      <FieldLegend>Plan</FieldLegend>
      <FieldDescription>Choose a billing plan.</FieldDescription>
      <RadioGroup defaultValue="pro">
        <Field orientation="horizontal">
          <RadioGroupItem value="free" id="r-free" />
          <FieldLabel htmlFor="r-free">Free</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem value="pro" id="r-pro" />
          <FieldLabel htmlFor="r-pro">Pro</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <RadioGroupItem value="enterprise" id="r-ent" />
          <FieldLabel htmlFor="r-ent">Enterprise</FieldLabel>
        </Field>
      </RadioGroup>
    </FieldSet>
  ),
};

// --- Switch ---

export const SwitchField: Story = {
  name: "Switch (horizontal)",
  render: () => (
    <Field orientation="horizontal" className="w-80">
      <Switch id="newsletter" />
      <FieldLabel htmlFor="newsletter">Subscribe to newsletter</FieldLabel>
    </Field>
  ),
};

export const SwitchWithContent: Story = {
  name: "Switch with FieldContent",
  render: () => (
    <Field orientation="horizontal" className="w-96">
      <Switch id="notifications" />
      <FieldContent>
        <FieldLabel htmlFor="notifications">Push notifications</FieldLabel>
        <FieldDescription>Receive alerts about account activity.</FieldDescription>
      </FieldContent>
    </Field>
  ),
};

// --- InputGroup inside Field ---

export const WithInputGroup: Story = {
  name: "With InputGroup",
  render: () => (
    <Field className="w-80">
      <FieldLabel htmlFor="website">Website</FieldLabel>
      <InputGroup>
        <InputGroupInput id="website" placeholder="example.com" />
        <InputGroupAddon align="inline-start">
          <InputGroupText>https://</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <FieldDescription>Your public profile URL.</FieldDescription>
    </Field>
  ),
};

export const InputGroupWithError: Story = {
  name: "InputGroup with Error",
  render: () => (
    <Field className="w-80" data-invalid="true">
      <FieldLabel htmlFor="email-ig">Email</FieldLabel>
      <InputGroup>
        <InputGroupInput id="email-ig" placeholder="you" aria-invalid />
        <InputGroupAddon align="inline-end">
          <InputGroupText>@example.com</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <FieldError>This email is not available.</FieldError>
    </Field>
  ),
};

// --- Orientations ---

export const Vertical: Story = {
  name: "Orientation: vertical (default)",
  render: () => (
    <Field orientation="vertical" className="w-80">
      <FieldLabel htmlFor="v-input">Label</FieldLabel>
      <Input id="v-input" placeholder="Vertical layout" />
      <FieldDescription>Label stacked above the input.</FieldDescription>
    </Field>
  ),
};

export const Horizontal: Story = {
  name: "Orientation: horizontal",
  render: () => (
    <Field orientation="horizontal" className="w-96">
      <FieldLabel htmlFor="h-input" className="w-24">
        Name
      </FieldLabel>
      <FieldContent>
        <Input id="h-input" placeholder="Horizontal layout" />
        <FieldDescription>Label beside the input.</FieldDescription>
      </FieldContent>
    </Field>
  ),
};

// --- FieldSet + FieldGroup ---

export const FieldSetBasic: Story = {
  name: "FieldSet",
  render: () => (
    <FieldSet className="w-96">
      <FieldLegend>Profile</FieldLegend>
      <FieldDescription>This information appears on invoices and emails.</FieldDescription>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="fs-name">Full name</FieldLabel>
          <Input id="fs-name" placeholder="Evil Rabbit" autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor="fs-email">Email</FieldLabel>
          <Input id="fs-email" type="email" placeholder="you@example.com" autoComplete="off" />
          <FieldDescription>We'll send a confirmation to this address.</FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

export const FieldSetWithValidation: Story = {
  name: "FieldSet with Validation",
  render: () => (
    <FieldSet className="w-96">
      <FieldLegend>Account</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="fv-user">Username</FieldLabel>
          <Input id="fv-user" defaultValue="evil_rabbit" autoComplete="off" />
        </Field>
        <Field data-invalid="true">
          <FieldLabel htmlFor="fv-email">Email</FieldLabel>
          <Input id="fv-email" type="email" defaultValue="not-an-email" aria-invalid />
          <FieldError>Enter a valid email address.</FieldError>
        </Field>
        <Field data-invalid="true">
          <FieldLabel htmlFor="fv-pass">Password</FieldLabel>
          <Input id="fv-pass" type="password" aria-invalid />
          <FieldError
            errors={[{ message: "At least 8 characters." }, { message: "Must include a number." }]}
          />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

// --- FieldGroup with Separator ---

export const GroupWithSeparator: Story = {
  name: "FieldGroup with Separator",
  render: () => (
    <FieldSet className="w-96">
      <FieldLegend>Sign Up</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="sep-email">Email</FieldLabel>
          <Input id="sep-email" type="email" placeholder="you@example.com" autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor="sep-pass">Password</FieldLabel>
          <Input id="sep-pass" type="password" placeholder="••••••••" />
        </Field>
        <FieldSeparator>Or continue with</FieldSeparator>
        <Field>
          <FieldLabel htmlFor="sep-invite">Invite code</FieldLabel>
          <Input id="sep-invite" placeholder="XXXX-XXXX" autoComplete="off" />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

// --- Legend Variants ---

export const LegendVariants: Story = {
  name: "FieldLegend Variants",
  render: () => (
    <div className="flex flex-col gap-8 w-96">
      <FieldSet>
        <FieldLegend variant="legend">Legend variant (default)</FieldLegend>
        <FieldDescription>Larger heading for top-level groups.</FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="lv-1">Field</FieldLabel>
            <Input id="lv-1" placeholder="..." autoComplete="off" />
          </Field>
        </FieldGroup>
      </FieldSet>
      <FieldSet>
        <FieldLegend variant="label">Label variant</FieldLegend>
        <FieldDescription>Label-sized heading for nested groups.</FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="lv-2">Field</FieldLabel>
            <Input id="lv-2" placeholder="..." autoComplete="off" />
          </Field>
        </FieldGroup>
      </FieldSet>
    </div>
  ),
};

// --- FieldTitle ---

export const WithFieldTitle: Story = {
  name: "FieldTitle + FieldContent",
  render: () => (
    <Field orientation="horizontal" className="w-96">
      <Switch id="touchid" />
      <FieldContent>
        <FieldTitle>Enable Touch ID</FieldTitle>
        <FieldDescription>
          Unlock your device faster with biometric authentication.
        </FieldDescription>
      </FieldContent>
    </Field>
  ),
};

// --- Choice Card ---

export const ChoiceCard: Story = {
  name: "Choice Card (Radio)",
  render: () => (
    <RadioGroup defaultValue="pro" className="w-96">
      <FieldLabel>
        <Field orientation="horizontal">
          <RadioGroupItem value="free" id="cc-free" />
          <FieldContent>
            <FieldTitle>Free</FieldTitle>
            <FieldDescription>Basic features, 1 project.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldLabel>
      <FieldLabel>
        <Field orientation="horizontal">
          <RadioGroupItem value="pro" id="cc-pro" />
          <FieldContent>
            <FieldTitle>Pro</FieldTitle>
            <FieldDescription>Unlimited projects, priority support.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldLabel>
      <FieldLabel>
        <Field orientation="horizontal">
          <RadioGroupItem value="enterprise" id="cc-ent" />
          <FieldContent>
            <FieldTitle>Enterprise</FieldTitle>
            <FieldDescription>Custom limits, SSO, SLA.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldLabel>
    </RadioGroup>
  ),
};

// --- Switch Group ---

export const SwitchGroup: Story = {
  name: "Switch Group",
  render: () => (
    <FieldSet className="w-96">
      <FieldLegend>Notifications</FieldLegend>
      <FieldDescription>Choose what you want to be notified about.</FieldDescription>
      <FieldGroup>
        <Field orientation="horizontal">
          <Switch id="sg-email" defaultChecked />
          <FieldContent>
            <FieldLabel htmlFor="sg-email">Email notifications</FieldLabel>
            <FieldDescription>Sent to your primary email.</FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Switch id="sg-push" />
          <FieldContent>
            <FieldLabel htmlFor="sg-push">Push notifications</FieldLabel>
            <FieldDescription>Requires the mobile app.</FieldDescription>
          </FieldContent>
        </Field>
        <Field orientation="horizontal">
          <Switch id="sg-sms" disabled />
          <FieldContent>
            <FieldLabel htmlFor="sg-sms">SMS notifications</FieldLabel>
            <FieldDescription>Add a phone number to enable.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};

// --- Composed: Full Form ---

export const FullForm: Story = {
  name: "Full Form Example",
  render: () => (
    <div className="flex flex-col gap-8 w-[28rem]">
      <FieldSet>
        <FieldLegend>Profile</FieldLegend>
        <FieldDescription>Public information visible on your profile page.</FieldDescription>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ff-name">Display name</FieldLabel>
            <Input id="ff-name" placeholder="Evil Rabbit" autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor="ff-handle">Handle</FieldLabel>
            <InputGroup>
              <InputGroupInput id="ff-handle" placeholder="evil-rabbit" />
              <InputGroupAddon align="inline-start">
                <InputGroupText>@</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              <a href="#">platform.example/@handle</a>
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ff-bio">Bio</FieldLabel>
            <Textarea id="ff-bio" placeholder="A few words about yourself..." />
          </Field>
          <Field>
            <FieldLabel htmlFor="ff-website">Website</FieldLabel>
            <InputGroup>
              <InputGroupInput id="ff-website" placeholder="example.com" />
              <InputGroupAddon align="inline-start">
                <LinkIcon />
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="ff-role">Role</FieldLabel>
            <Select defaultValue="editor">
              <SelectTrigger id="ff-role" className="w-full">
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="editor">Editor</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend>Security</FieldLegend>
        <FieldGroup>
          <Field data-invalid="true">
            <FieldLabel htmlFor="ff-pass">New password</FieldLabel>
            <InputGroup>
              <InputGroupInput id="ff-pass" type="password" aria-invalid />
              <InputGroupAddon align="inline-start">
                <LockIcon />
              </InputGroupAddon>
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label="Show password">
                  <EyeIcon />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldError
              errors={[
                { message: "At least 8 characters." },
                { message: "Must include a special character." },
              ]}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch id="ff-2fa" />
            <FieldContent>
              <FieldTitle>Two-factor authentication</FieldTitle>
              <FieldDescription>Add an extra layer of security to your account.</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">Email preferences</FieldLegend>
        <FieldGroup>
          <Field orientation="horizontal">
            <Switch id="ff-marketing" />
            <FieldLabel htmlFor="ff-marketing">Marketing emails</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Switch id="ff-updates" defaultChecked />
            <FieldLabel htmlFor="ff-updates">Product updates</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Switch id="ff-security" defaultChecked />
            <FieldLabel htmlFor="ff-security">Security alerts</FieldLabel>
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <FieldSet>
        <FieldLegend variant="label">Preferences</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel>Notification volume</FieldLabel>
            <Slider defaultValue={[75]} max={100} step={1} />
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="ff-terms" />
            <FieldContent>
              <FieldLabel htmlFor="ff-terms">Accept terms and conditions</FieldLabel>
              <FieldDescription>
                You agree to our <a href="#">Terms of Service</a>.
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
      </FieldSet>
    </div>
  ),
};
