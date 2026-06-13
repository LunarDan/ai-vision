import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export const Alert = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("ui-alert", className)} role="alert" {...props} />
);
