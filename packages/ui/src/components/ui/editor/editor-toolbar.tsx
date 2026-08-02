"use client";

import { useCallback } from "react";
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  CodeIcon,
  LinkIcon,
  ImageIcon,
  QuoteIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon,
  SigmaIcon,
  EyeIcon,
  PencilIcon,
  ColumnsIcon,
  ChevronDownIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { InputGroupAddon, InputGroupButton } from "@si/ui/components/input-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@si/ui/components/tooltip";
import { Kbd } from "@si/ui/components/kbd";
import { Separator } from "@si/ui/components/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@si/ui/components/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@si/ui/components/toggle-group";
import { cn } from "@si/ui/lib/utils";
import {
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleInlineCode,
  insertLink,
  insertImage,
  toggleBlockquote,
  toggleUnorderedList,
  toggleOrderedList,
  insertHorizontalRule,
  insertHeading,
  insertMathInline,
  insertMathBlock,
  insertCodeBlock,
} from "./editor-commands";
import { useEditorContext, type EditorMode } from "./editor-context";
import type { EditorView } from "@codemirror/view";

function runCommand(ctx: ReturnType<typeof useEditorContext>, fn: (view: EditorView) => boolean) {
  const view = ctx.viewCurrent;
  if (view) {
    fn(view);
    view.focus();
  }
}

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  action: (view: EditorView) => boolean;
}

function ToolbarButton({ icon, label, shortcut, action }: ToolbarButtonProps) {
  const ctx = useEditorContext();

  const handleClick = useCallback(() => {
    runCommand(ctx, action);
  }, [ctx, action]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={<InputGroupButton size="icon-xs" aria-label={label} onClick={handleClick} />}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut && (
          <>
            {" "}
            <Kbd>{shortcut}</Kbd>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function EditorToolbar({ className }: { className?: string }) {
  const ctx = useEditorContext();

  const handleHeading = useCallback(
    (level: 1 | 2 | 3 | 4) => runCommand(ctx, (v) => insertHeading(v, level)),
    [ctx],
  );

  const handleCodeBlock = useCallback(() => runCommand(ctx, insertCodeBlock), [ctx]);
  const handleMathBlock = useCallback(() => runCommand(ctx, insertMathBlock), [ctx]);

  return (
    <TooltipProvider>
      <InputGroupAddon
        align="block-start"
        className={cn("flex flex-wrap items-center gap-0.5", className)}
      >
        {/* Heading dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <InputGroupButton size="xs" aria-label="Insert heading">
                <Heading1Icon className="size-3.5" />
                <ChevronDownIcon className="size-2.5" />
              </InputGroupButton>
            }
          />
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleHeading(1)}>
              <Heading1Icon className="size-4" /> Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleHeading(2)}>
              <Heading2Icon className="size-4" /> Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleHeading(3)}>
              <Heading3Icon className="size-4" /> Heading 3
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleHeading(4)}>
              <Heading4Icon className="size-4" /> Heading 4
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        {/* Inline formatting */}
        <ToolbarButton icon={<BoldIcon />} label="Bold" shortcut="⌘B" action={toggleBold} />
        <ToolbarButton icon={<ItalicIcon />} label="Italic" shortcut="⌘I" action={toggleItalic} />
        <ToolbarButton
          icon={<StrikethroughIcon />}
          label="Strikethrough"
          shortcut="⌘⇧S"
          action={toggleStrikethrough}
        />
        <ToolbarButton
          icon={<CodeIcon />}
          label="Inline Code"
          shortcut="⌘E"
          action={toggleInlineCode}
        />

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        {/* Block elements */}
        <ToolbarButton icon={<LinkIcon />} label="Link" shortcut="⌘K" action={insertLink} />
        <ToolbarButton icon={<ImageIcon />} label="Image" action={insertImage} />
        <ToolbarButton icon={<QuoteIcon />} label="Blockquote" action={toggleBlockquote} />
        <ToolbarButton icon={<ListIcon />} label="Unordered List" action={toggleUnorderedList} />
        <ToolbarButton icon={<ListOrderedIcon />} label="Ordered List" action={toggleOrderedList} />
        <ToolbarButton icon={<MinusIcon />} label="Horizontal Rule" action={insertHorizontalRule} />

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        {/* Math & code blocks */}
        <ToolbarButton
          icon={<SigmaIcon />}
          label="Inline Math"
          shortcut="⌘⇧M"
          action={insertMathInline}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton size="icon-xs" aria-label="Math Block" onClick={handleMathBlock} />
            }
          >
            <span className="font-mono text-[0.6rem] leading-none">$$</span>
          </TooltipTrigger>
          <TooltipContent>Math Block</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton size="icon-xs" aria-label="Code Block" onClick={handleCodeBlock} />
            }
          >
            <span className="font-mono text-[0.6rem] leading-none">```</span>
          </TooltipTrigger>
          <TooltipContent>
            Code Block <Kbd>⌘⇧K</Kbd>
          </TooltipContent>
        </Tooltip>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Fullscreen toggle */}
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                aria-label={ctx.fullscreen ? "Exit fullscreen" : "Fullscreen"}
                aria-pressed={ctx.fullscreen}
                onClick={() => ctx.setFullscreen(!ctx.fullscreen)}
              />
            }
          >
            {ctx.fullscreen ? (
              <Minimize2Icon className="size-3.5" />
            ) : (
              <Maximize2Icon className="size-3.5" />
            )}
          </TooltipTrigger>
          <TooltipContent>
            {ctx.fullscreen ? "Exit fullscreen" : "Fullscreen"}
            {ctx.fullscreen && (
              <>
                {" "}
                <Kbd>Esc</Kbd>
              </>
            )}
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-0.5 h-5" />

        {/* Mode switcher */}
        <ToggleGroup
          value={[ctx.mode]}
          onValueChange={(value) => {
            const newMode = value[0] as EditorMode | undefined;
            if (newMode) ctx.setMode(newMode);
          }}
          size="sm"
        >
          <ToggleGroupItem value="write" aria-label="Write mode">
            <PencilIcon className="size-3" />
          </ToggleGroupItem>
          <ToggleGroupItem value="split" aria-label="Split view">
            <ColumnsIcon className="size-3" />
          </ToggleGroupItem>
          <ToggleGroupItem value="preview" aria-label="Preview">
            <EyeIcon className="size-3" />
          </ToggleGroupItem>
        </ToggleGroup>
      </InputGroupAddon>
    </TooltipProvider>
  );
}

export { EditorToolbar };
