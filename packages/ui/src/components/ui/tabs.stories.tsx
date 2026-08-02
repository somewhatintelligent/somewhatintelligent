import type { Meta, StoryObj } from "@storybook/react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

const meta = {
  title: "UI/Tabs",
  component: Tabs,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="account" className="w-96">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <p className="text-muted-foreground">
          Manage your account details, display name, and profile information.
        </p>
      </TabsContent>
      <TabsContent value="security">
        <p className="text-muted-foreground">
          Update your password, enable two-factor authentication, and review active sessions.
        </p>
      </TabsContent>
      <TabsContent value="notifications">
        <p className="text-muted-foreground">
          Choose which notifications you receive and how they are delivered.
        </p>
      </TabsContent>
    </Tabs>
  ),
};

export const WithContent: Story = {
  render: () => (
    <Tabs defaultValue="account" className="w-[480px]">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <div className="space-y-3">
          <h3 className="text-base font-semibold">Account Settings</h3>
          <div className="space-y-1">
            <p className="text-sm font-medium">Display Name</p>
            <p className="text-sm text-muted-foreground">Platform User</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Email</p>
            <p className="text-sm text-muted-foreground">user@example.com</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Language</p>
            <p className="text-sm text-muted-foreground">English (Canada)</p>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="security">
        <div className="space-y-3">
          <h3 className="text-base font-semibold">Security Settings</h3>
          <div className="space-y-1">
            <p className="text-sm font-medium">Password</p>
            <p className="text-sm text-muted-foreground">Last changed 30 days ago</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Two-Factor Authentication</p>
            <p className="text-sm text-muted-foreground">Enabled via authenticator app</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Active Sessions</p>
            <p className="text-sm text-muted-foreground">2 devices currently signed in</p>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="notifications">
        <div className="space-y-3">
          <h3 className="text-base font-semibold">Notification Preferences</h3>
          <div className="space-y-1">
            <p className="text-sm font-medium">Email Notifications</p>
            <p className="text-sm text-muted-foreground">
              Receive weekly digest and security alerts
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Push Notifications</p>
            <p className="text-sm text-muted-foreground">
              Enabled for mentions and direct messages
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Marketing</p>
            <p className="text-sm text-muted-foreground">Opted out of promotional emails</p>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  ),
};
