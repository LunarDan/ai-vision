import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils.js";

export const ScrollArea = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) => (
  <ScrollAreaPrimitive.Root className={cn("ui-scroll-area", className)}>
    <ScrollAreaPrimitive.Viewport className="ui-scroll-viewport" {...props} />
    <ScrollAreaPrimitive.Scrollbar
      className="ui-scrollbar"
      orientation="vertical"
    >
      <ScrollAreaPrimitive.Thumb className="ui-scrollbar-thumb" />
    </ScrollAreaPrimitive.Scrollbar>
  </ScrollAreaPrimitive.Root>
);
