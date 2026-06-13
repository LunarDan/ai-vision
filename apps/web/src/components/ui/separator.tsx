import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils.js";

export const Separator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) => (
  <SeparatorPrimitive.Root className={cn("ui-separator", className)} {...props} />
);
