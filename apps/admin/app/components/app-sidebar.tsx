import * as React from 'react';
import {
  Bell,
  DollarSign,
  Gauge,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Settings2,
  Truck,
  Users,
} from 'lucide-react';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';

import { NavMain } from '~/components/nav-main';
import { useProfile } from '~/hooks/use-profile';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '~/components/ui/sidebar';

// ─── Brand Header ──────────────────────────────────────────────────────────────

function SidebarBrand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Truck className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">SureWaka</span>
            <span className="truncate text-xs text-muted-foreground">Admin Panel</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

// ─── Navigation Data ───────────────────────────────────────────────────────────

const navMain = [
  {
    title: 'Overview',
    url: '#',
    icon: LayoutDashboard,
    items: [
      { title: 'Dashboard', url: '/' },
      { title: 'Analytics', url: '/analytics' },
    ],
  },
  {
    title: 'Logistics',
    url: '#',
    icon: Truck,
    items: [
      { title: 'Deliveries', url: '/deliveries' },
      { title: 'Disputes', url: '/disputes' },
    ],
  },
  {
    title: 'People',
    url: '#',
    icon: Users,
    items: [
      { title: 'Customers', url: '/customers' },
      { title: 'Drivers', url: '/drivers' },
      { title: 'Carriers', url: '/carriers' },
      { title: 'Applications', url: '/carriers/applications' },
      { title: 'Verifications', url: '/verifications' },
    ],
  },
  {
    title: 'Finance',
    url: '#',
    icon: DollarSign,
    items: [
      { title: 'Overview', url: '/finance' },
      { title: 'Payouts', url: '/payouts' },
      { title: 'Fee Settings', url: '/settings/fee-settings' },
    ],
  },
  {
    title: 'Coverage',
    url: '#',
    icon: MapPin,
    items: [
      { title: 'Zones', url: '/coverage/zones' },
      { title: 'Coverage Map', url: '/coverage/map' },
      { title: 'Coverage Gaps', url: '/coverage/gaps' },
      { title: 'Driver Density', url: '/coverage/density' },
    ],
  },
  {
    title: 'Communications',
    url: '#',
    icon: MessageSquare,
    items: [
      { title: 'Notifications', url: '/notifications' },
      { title: 'Broadcast', url: '/notifications/broadcast' },
    ],
  },
  {
    title: 'Settings',
    url: '#',
    icon: Settings2,
    items: [
      { title: 'System Config', url: '/settings/system-config' },
      { title: 'Queues', url: '/queues' },
      { title: 'Alerts', url: '/settings/alerts' },
      { title: 'Profile', url: '/settings/profile' },
      { title: 'Name Changes', url: '/settings/name-changes' },
    ],
  },
];

const adminNav = [
  {
    title: 'Admin',
    url: '#',
    icon: Gauge,
    items: [
      { title: 'Users', url: '/users' },
      { title: 'Waitlist', url: '/waitlist' },
    ],
  },
];

// ─── Sidebar Component ─────────────────────────────────────────────────────────

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { profile } = useProfile();
  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Admin navigation">
          <NavMain items={navMain} />
          <RoleGate roles={['surewaka_admin']} userRoles={userRoles}>
            <NavMain items={adminNav} label="Administration" />
          </RoleGate>
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
