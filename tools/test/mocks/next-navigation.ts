/* `next/navigation` stand-in for the shell test. The shell only needs a pathname to highlight the current
 * route and to close the drawer when the route changes; `pathname` is settable so the test can drive it. */
let pathname = '/';

export function usePathname(): string {
  return pathname;
}

export function setPathname(next: string) {
  pathname = next;
}

export function useRouter() {
  return {
    push: (href: string) => {
      pathname = href;
    },
    replace: (href: string) => {
      pathname = href;
    },
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  };
}

export function useSearchParams() {
  return new URLSearchParams();
}
