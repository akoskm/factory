import { ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Button } from "@/components/ui/button";

const menuContentClass =
  "z-50 min-w-44 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md";
const menuItemClass =
  "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

export function QueueActions({
  disabled,
  onQueue,
  onQueueAndStart,
  onSchedule,
  size = "sm",
}: {
  disabled?: boolean;
  onQueue: () => void;
  onQueueAndStart: () => void;
  onSchedule: () => void;
  size?: "sm" | "default";
}) {
  return (
    <div className="inline-flex">
      <Button
        size={size}
        disabled={disabled}
        className="rounded-r-none"
        onClick={onQueue}
      >
        Queue
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            size={size}
            disabled={disabled}
            className="rounded-l-none border-l-0 px-2"
            aria-label="More queue options"
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClass}>
            <DropdownMenu.Item className={menuItemClass} onSelect={onQueueAndStart}>
              Queue and start
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItemClass} onSelect={onSchedule}>
              Schedule…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
