import { type ComponentProps } from "react";

interface BrandIconProps extends ComponentProps<"svg"> {
  path: string;
}

export function BrandIcon({ path, className, ...props }: BrandIconProps) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      width={16}
      height={16}
      {...props}
    >
      <path d={path} />
    </svg>
  );
}
