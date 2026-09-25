/** Inline SVG icons from the mockups. All decorative (aria-hidden); colors come from `className` via currentColor. */

type IconProps = { className?: string; size?: number };

export function DiamondIcon({ className, size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 12L12 4L20 12L12 20L4 12Z" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function HouseIcon({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M3 10L12 4L21 10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 10V19H19V10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 19V14H15V19" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function TrendIcon({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 17L10 11L14 15L20 8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 8H20V14" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function StackIcon({ className }: IconProps) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="4" y="4" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M5 12H19" stroke="currentColor" strokeWidth="1.8" />
      <path d="M13 6L19 12L13 18" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ChevronIcon({ direction, className }: IconProps & { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d={direction === "left" ? "M15 6L9 12L15 18" : "M9 6L15 12L9 18"} stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function RingIcon({ className }: IconProps) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function MenuIcon({ open, className }: IconProps & { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      {open ? (
        <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" />
      ) : (
        <path d="M4 7H20M4 12H20M4 17H20" stroke="currentColor" strokeWidth="1.8" />
      )}
    </svg>
  );
}
