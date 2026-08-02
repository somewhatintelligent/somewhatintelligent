import type { Meta, StoryObj } from "@storybook/react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "./accordion";

const meta = {
  title: "UI/Accordion",
  component: Accordion,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Accordion className="w-96">
      <AccordionItem value="item-1">
        <AccordionTrigger>What is Platform?</AccordionTrigger>
        <AccordionContent>
          A publishing and commerce platform for versioned physical goods, software, and writing.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-2">
        <AccordionTrigger>What design system is this?</AccordionTrigger>
        <AccordionContent>
          Cold proof paper, garment black, steel rules, and one scarce signal-pink correction.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="item-3">
        <AccordionTrigger>What fonts are used?</AccordionTrigger>
        <AccordionContent>
          Barlow Condensed for claims, Source Serif 4 for interface and editorial copy, and Iosevka
          for evidence and state.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
