'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The Munim section, as on the home page; the boilerplate's endpoint pages are "PayPal data".
const LINKS = [
  { href: '/inbox', label: 'Inbox' },
  { href: '/agent', label: 'Agent' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/developer', label: 'Developer' },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-6 text-sm">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={path === l.href || path.startsWith(`${l.href}/`) ? 'font-semibold text-pp-blue' : 'text-pp-muted hover:text-pp-ink'}
        >
          {l.label}
        </Link>
      ))}
      <span className="h-4 w-px bg-pp-border" />
      <Link href="/#paypal-data" className="text-pp-muted hover:text-pp-ink">
        PayPal data
      </Link>
    </nav>
  );
}
