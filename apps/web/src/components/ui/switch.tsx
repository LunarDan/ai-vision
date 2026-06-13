import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils.js";

export const Switch = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root className={cn("ui-switch", className)} {...props}>
    <SwitchPrimitive.Thumb className="ui-switch-thumb" />
  </SwitchPrimitive.Root>
);
