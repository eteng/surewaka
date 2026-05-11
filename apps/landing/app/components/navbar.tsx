import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '~/lib/utils';

const navLinks = [
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Benefits', href: '/#benefits' },
  { label: 'Join Waitlist', href: '/#waitlist' },
];

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a
          href="/"
          className="text-xl font-bold text-primary"
          aria-label="SureWaka — go to homepage"
        >
          SureWaka
        </a>

        {/* Desktop navigation */}
        <div className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <a
            href="/#waitlist"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Get Early Access
          </a>
        </div>

        {/* Mobile hamburger button */}
        <button
          type="button"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-foreground md:hidden"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className={cn(
          'overflow-hidden border-t border-border transition-all duration-200 md:hidden',
          mobileMenuOpen ? 'max-h-80' : 'max-h-0 border-t-0',
        )}
      >
        <div className="flex flex-col gap-1 px-6 py-4">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex min-h-[44px] items-center rounded-md px-3 text-base text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <a
            href="/#waitlist"
            className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={() => setMobileMenuOpen(false)}
          >
            Get Early Access
          </a>
        </div>
      </div>
    </nav>
  );
}
