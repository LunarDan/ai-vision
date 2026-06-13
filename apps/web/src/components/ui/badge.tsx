import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning" | "danger" | "muted";
};

export const Badge = ({ className, variant = "default", ...props }: BadgeProps) => (
  <span className={cn("ui-badge", `ui-badge-${variant}`, className)} {...props} />
);
