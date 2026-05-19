import * as React from 'react';
import {
  BarChart3,
  Building2,
  ClipboardList,
  LayoutDashboard,
  MessageSquare,
  Package,
  Settings2,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import type { UserRole } from '@surewaka/shared';
import { RoleGate } from '@surewaka/ui';

import { NavMain } from '~/components/nav-main';
import { NavProjects } from '~/components/nav-projects';
import { TeamSwitcher } from '~/components/team-switcher';
import { useProfile } from '~/hooks/use-profile';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from '~/components/ui/sidebar';

const data = {
  teams: [
    {
      name: 'SureWaka',
      logo: Truck,
      plan: 'Admin Panel',
    },
  ],
  navMain: [
    {
      title: 'Operations',
      url: '#',
      icon: LayoutDashboard,
      isActive: true,
      items: [
        { title: 'Dashboard', url: '/' },
        { title: 'Deliveries', url: '/deliveries' },
        { title: 'Analytics', url: '/analytics' },
      ],
    },
    {
      title: 'Fleet',
      url: '#',
      icon: Users,
      items: [
        { title: 'Drivers', url: '/drivers' },
        { title: 'Carriers', url: '/carriers' },
        { title: 'Verifications', url: '/verifications' },
      ],
    },
    {
      title: 'Support',
      url: '#',
      icon: MessageSquare,
      items: [{ title: 'Disputes', url: '/disputes' }],
    },
    {
      title: 'Growth',
      url: '#',
      icon: ClipboardList,
      items: [{ title: 'Waitlist', url: '/waitlist' }],
    },
    {
      title: 'Settings',
      url: '#',
      icon: Settings2,
      items: [
        { title: 'General', url: '/settings' },
        { title: 'Profile', url: '/settings/profile' },
        { title: 'Name Changes', url: '/settings/name-changes' },
      ],
    },
  ],
  adminNav: [
    {
      title: 'User Management',
      url: '#',
      icon: Users,
      items: [{ title: 'Users', url: '/users' }],
    },
  ],
  projects: [
    { name: 'Lagos Operations', url: '#', icon: Package },
    { name: 'Carrier Partners', url: '#', icon: Building2 },
    { name: 'KYC Pipeline', url: '#', icon: ShieldCheck },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { profile } = useProfile();
  const userRoles: UserRole[] = profile?.role ? [profile.role as UserRole] : [];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher teams={data.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <RoleGate roles={['surewaka_admin']} userRoles={userRoles}>
          <NavMain items={data.adminNav} />
        </RoleGate>
        <NavProjects projects={data.projects} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
