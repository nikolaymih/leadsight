"use client";

import { Check } from "lucide-react";
import { DropdownMenu as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuLabel = ({ className, ...props }: ComponentProps<typeof Primitive.Label>) => (
  <Primitive.Label
    className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
    {...props}
  />
);
export const DropdownMenuSeparator = ({
  className,
  ...props
}: ComponentProps<typeof Primitive.Separator>) => (
  <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
);

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-[var(--radius)] border border-border bg-card p-1 text-sm shadow-md",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof Primitive.Item> & { destructive?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4",
        destructive && "text-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pr-2 pl-7 outline-none data-[highlighted]:bg-muted",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 inline-flex size-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="size-3.5" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.CheckboxItem>
  );
}
