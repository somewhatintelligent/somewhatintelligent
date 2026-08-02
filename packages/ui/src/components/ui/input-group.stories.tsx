import type { Meta, StoryObj } from "@storybook/react";
import {
  MailIcon,
  SearchIcon,
  EyeIcon,
  CopyIcon,
  DollarSignIcon,
  SendIcon,
  LinkIcon,
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ChevronDownIcon,
  XIcon,
  LockIcon,
  TagIcon,
  AtSignIcon,
} from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group";
import { Kbd } from "./kbd";
import { Spinner } from "./spinner";

const meta = {
  title: "UI/InputGroup",
  component: InputGroup,
  tags: ["autodocs"],
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Type something..." />
    </InputGroup>
  ),
};

// --- Inline Alignment ---

export const InlineStart: Story = {
  name: "Align: inline-start",
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Search..." />
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const InlineEnd: Story = {
  name: "Align: inline-end",
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Enter email" />
      <InputGroupAddon align="inline-end">
        <MailIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const InlineStartAndEnd: Story = {
  name: "Align: inline-start + inline-end",
  render: () => (
    <InputGroup className="w-80">
      <InputGroupInput placeholder="Search commands..." />
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Clear">
          <XIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Block Alignment (Textarea) ---

export const BlockStart: Story = {
  name: "Align: block-start (textarea)",
  render: () => (
    <InputGroup className="w-80">
      <InputGroupTextarea placeholder="Write your message..." rows={4} />
      <InputGroupAddon align="block-start">
        <InputGroupButton size="icon-xs" aria-label="Bold">
          <BoldIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Italic">
          <ItalicIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="List">
          <ListIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const BlockEnd: Story = {
  name: "Align: block-end (textarea)",
  render: () => (
    <InputGroup className="w-80">
      <InputGroupTextarea placeholder="Type a message..." rows={3} />
      <InputGroupAddon align="block-end">
        <InputGroupButton size="icon-xs" aria-label="Attach">
          <LinkIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Mention">
          <AtSignIcon />
        </InputGroupButton>
        <div className="flex-1" />
        <InputGroupButton size="xs">
          <SendIcon />
          Send
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const BlockStartAndEnd: Story = {
  name: "Align: block-start + block-end (textarea)",
  render: () => (
    <InputGroup className="w-80">
      <InputGroupTextarea placeholder="Compose..." rows={4} />
      <InputGroupAddon align="block-start">
        <InputGroupButton size="icon-xs" aria-label="Bold">
          <BoldIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Italic">
          <ItalicIcon />
        </InputGroupButton>
      </InputGroupAddon>
      <InputGroupAddon align="block-end">
        <InputGroupText className="text-xs">Markdown supported</InputGroupText>
        <div className="flex-1" />
        <InputGroupButton size="xs">Send</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Icon Examples ---

export const WithIconPrefix: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Search..." />
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithIconSuffix: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Enter email" />
      <InputGroupAddon align="inline-end">
        <MailIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Text Addons ---

export const WithTextPrefix: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="example.com" />
      <InputGroupAddon align="inline-start">
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithTextSuffix: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="username" />
      <InputGroupAddon align="inline-end">
        <InputGroupText>@example.com</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithCurrencyPrefix: Story = {
  render: () => (
    <InputGroup className="w-48">
      <InputGroupInput placeholder="0.00" type="number" />
      <InputGroupAddon align="inline-start">
        <InputGroupText>
          <DollarSignIcon />
        </InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Button Examples ---

export const WithButtonSuffix: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Enter password" type="password" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Toggle visibility">
          <EyeIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithCopyButton: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupInput defaultValue="npm install @si/ui" readOnly className="font-mono" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Copy">
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const MultipleButtons: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupInput placeholder="Tag name" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Add tag">
          <TagIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Clear">
          <XIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Kbd ---

export const WithKbd: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupInput placeholder="Search..." />
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <Kbd>⌘K</Kbd>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Spinner ---

export const WithSpinner: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <InputGroup className="w-72">
        <InputGroupInput placeholder="Searching..." />
        <InputGroupAddon align="inline-start">
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <Spinner size="xs" />
        </InputGroupAddon>
      </InputGroup>
      <InputGroup className="w-72">
        <InputGroupInput placeholder="Validating..." />
        <InputGroupAddon align="inline-end">
          <Spinner size="xs" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

// --- Dropdown ---

export const WithDropdown: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupInput placeholder="Search..." />
      <InputGroupAddon align="inline-start">
        <InputGroupButton size="xs">
          All
          <ChevronDownIcon className="size-3" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Button Sizes ---

export const ButtonSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <InputGroup className="w-80">
        <InputGroupInput placeholder="size=xs (default)" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs">Submit</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup className="w-80">
        <InputGroupInput placeholder="size=icon-xs" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Copy">
            <CopyIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup className="w-80">
        <InputGroupInput placeholder="size=icon-sm" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm" aria-label="Copy">
            <CopyIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

// --- Button Variants ---

export const ButtonVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <InputGroup className="w-80">
        <InputGroupInput placeholder="variant=ghost (default)" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="ghost" size="xs">
            Ghost
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup className="w-80">
        <InputGroupInput placeholder="variant=default" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="default" size="xs">
            Default
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup className="w-80">
        <InputGroupInput placeholder="variant=outline" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="outline" size="xs">
            Outline
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup className="w-80">
        <InputGroupInput placeholder="variant=secondary" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="secondary" size="xs">
            Secondary
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <InputGroup className="w-80">
        <InputGroupInput placeholder="variant=destructive" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton variant="destructive" size="xs">
            Delete
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  ),
};

// --- Textarea ---

export const Textarea: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupTextarea placeholder="Write a message..." rows={4} />
      <InputGroupAddon align="block-end">
        <div className="flex-1" />
        <InputGroupButton size="xs">
          <SendIcon />
          Send
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- States ---

export const Disabled: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Disabled input" disabled />
      <InputGroupAddon align="inline-start">
        <MailIcon />
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const ReadOnly: Story = {
  render: () => (
    <InputGroup className="w-80">
      <InputGroupInput defaultValue="api_key_1234567890" readOnly className="font-mono text-xs" />
      <InputGroupAddon align="inline-start">
        <LockIcon />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Copy">
          <CopyIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

// --- Composed Examples ---

export const SearchWithKbdAndClear: Story = {
  name: "Search with Kbd + Clear",
  render: () => (
    <InputGroup className="w-96">
      <InputGroupInput placeholder="Search everything..." defaultValue="input group" />
      <InputGroupAddon align="inline-start">
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Clear search">
          <XIcon />
        </InputGroupButton>
        <Kbd>⌘K</Kbd>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const PasswordWithToggle: Story = {
  render: () => (
    <InputGroup className="w-72">
      <InputGroupInput placeholder="Enter password" type="password" />
      <InputGroupAddon align="inline-start">
        <LockIcon />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" aria-label="Show password">
          <EyeIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const ChatComposer: Story = {
  render: () => (
    <InputGroup className="w-96">
      <InputGroupTextarea placeholder="Type a message..." rows={3} />
      <InputGroupAddon align="block-start">
        <InputGroupButton size="icon-xs" aria-label="Bold">
          <BoldIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Italic">
          <ItalicIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="List">
          <ListIcon />
        </InputGroupButton>
      </InputGroupAddon>
      <InputGroupAddon align="block-end">
        <InputGroupButton size="icon-xs" aria-label="Attach link">
          <LinkIcon />
        </InputGroupButton>
        <InputGroupButton size="icon-xs" aria-label="Mention">
          <AtSignIcon />
        </InputGroupButton>
        <div className="flex-1" />
        <Kbd>⌘↵</Kbd>
        <InputGroupButton size="xs" variant="default">
          <SendIcon />
          Send
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};
