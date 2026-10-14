/* `next/link` stand-in for the shell test: an anchor that keeps the props the shell passes to it. */
import type { AnchorHTMLAttributes, ReactNode } from 'react';

export default function Link({
  href,
  children,
  ...rest
}: { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
