import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Tiêu đề card — render vào .card-title nếu truyền. */
  title?: ReactNode;
  /** Nút/hành động góc phải tiêu đề. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** Khối nội dung trắng bo góc + bóng nhẹ (class .card). */
export function Card({ title, actions, className, children, ...rest }: CardProps) {
  const classes = ["card"];
  if (className) classes.push(className);
  return (
    <div className={classes.join(" ")} {...rest}>
      {title !== undefined || actions !== undefined ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {title !== undefined ? <div className="card-title">{title}</div> : <div />}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}
