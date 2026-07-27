import { Link } from 'react-router';
import { Banknote, Bell, SlidersHorizontal, User } from 'lucide-react';
import type { Route } from './+types/settings';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Settings' }];
}

const SETTINGS_CARDS = [
  {
    to: '/settings/alerts',
    icon: Bell,
    title: 'Alert Settings',
    description: 'Thresholds, Pumble webhook, push routing',
  },
  {
    to: '/settings/fee-settings',
    icon: Banknote,
    title: 'Fee Settings',
    description: 'On-demand rates, commission, vehicle type multipliers',
  },
  {
    to: '/settings/profile',
    icon: User,
    title: 'Profile',
    description: 'Avatar, name, notification preferences',
  },
  {
    to: '/settings/system-config',
    icon: SlidersHorizontal,
    title: 'System Config',
    description: 'Matching engine, routing parameters, operational knobs',
  },
];

export default function Settings() {
  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Platform configuration and admin preferences
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_CARDS.map(({ to, icon: Icon, title, description }) => (
          <Link
            key={to}
            to={to}
            className="flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm"
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
