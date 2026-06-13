import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils.js";

export const Tabs = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Root>) => (
  <TabsPrimitive.Root className={cn("ui-tabs", className)} {...props} />
);

export const TabsList = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn("ui-tabs-list", className)} {...props} />
);

export const TabsTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn("ui-tabs-trigger", className)}
    {...props}
  />
);

export const TabsContent = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content
    className={cn("ui-tabs-content", className)}
    {...props}
  />
);
