import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * Verified/machine data — every number, price, rate, hash and wallet address — renders in
 * JetBrains Mono. Serif (the body default) is reserved for interpreted, human language.
 */
export function Mono<T extends ElementType = "span">({
  as,
  className = "",
  ...props
}: { as?: T } & ComponentPropsWithoutRef<T>) {
  const Tag = (as ?? "span") as ElementType;
  return <Tag className={`font-mono ${className}`} {...props} />;
}
