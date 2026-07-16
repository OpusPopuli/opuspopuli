import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings, resolving conflicts so the last-wins order is
 * correct (e.g. `cn("px-4", condition && "px-6")` yields `px-6`). Used by the
 * `components/ui/*` primitives and anywhere call sites need to override a
 * primitive's default classes.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
