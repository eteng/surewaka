import { Linkedin, Instagram } from 'lucide-react';

// X (formerly Twitter) logo — lucide doesn't have brand icons
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const sectionLinks = [
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Benefits', href: '#benefits' },
  { label: 'Join Waitlist', href: '#waitlist' },
];

const socialLinks = [
  { label: 'X (Twitter)', href: 'https://x.com/surewaka', icon: XIcon },
  { label: 'LinkedIn', href: 'https://linkedin.com/company/surewaka', icon: Linkedin },
  { label: 'Instagram', href: 'https://instagram.com/surewaka_ng', icon: Instagram },
];

const legalLinks = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
];

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background px-6 py-12">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-4">
        {/* Brand */}
        <div className="md:col-span-1">
          <a href="/" className="text-xl font-bold text-primary">
            SureWaka
          </a>
          <p className="mt-2 text-sm text-muted-foreground">
            Connecting senders with verified logistics providers across Nigeria.
          </p>
        </div>

        {/* Section navigation */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Navigate</h3>
          <ul className="flex flex-col gap-2">
            {sectionLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Legal links */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Legal</h3>
          <ul className="flex flex-col gap-2">
            {legalLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Social + contact */}
        <div>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Connect</h3>
          <div className="flex gap-3">
            {socialLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <link.icon className="h-5 w-5" />
              </a>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            <a
              href="mailto:hello@surewaka.com"
              className="transition-colors hover:text-foreground"
            >
              hello@surewaka.com
            </a>
          </p>
        </div>
      </div>

      {/* Copyright */}
      <div className="mx-auto mt-8 max-w-6xl border-t border-border pt-6 text-center">
        <p className="text-xs text-muted-foreground">
          &copy; {currentYear} SureWaka. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
