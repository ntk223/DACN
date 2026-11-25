import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "default" | "primary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  /** Khi đang loading: disabled + spinner nhỏ bên trái. */
  loading?: boolean;
  children?: ReactNode;
}

/** Nút chuẩn — variant map trực tiếp sang class .btn / .btn-primary… */
export function Button({
  variant = "default",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = ["btn"];
  if (variant === "primary") classes.push("btn-primary");
  else if (variant === "danger") classes.push("btn-danger");
  else if (variant === "ghost") classes.push("btn-ghost");
  if (size === "sm") classes.push("btn-sm");
  if (className) classes.push(className);

  return (
    <button
      type="button"
      className={classes.join(" ")}
      disabled={disabled ?? loading}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
