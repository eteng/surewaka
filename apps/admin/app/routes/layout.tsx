import { Outlet, useLocation } from 'react-router';
import { AppSidebar } from '~/components/app-sidebar';
import { AuthGuard } from '~/components/auth-guard';
import { HeaderUser } from '~/components/header-user';
import { NotificationBell } from '~/components/notifications/notification-bell';
import { ThemeToggle } from '~/components/theme-toggle';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '~/components/ui/breadcrumb';
import { Separator } from '~/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '~/components/ui/sidebar';

// ─── Route Metadata ────────────────────────────────────────────────────────────

type RouteInfo = {
  title: string;
  parent?: string;
  parentUrl?: string;
};

/**
 * Resolves route metadata from pathname.
 * Handles exact matches first, then dynamic segment patterns.
 */
function resolveRoute(pathname: string): RouteInfo {
  // Exact match lookup
  const exact = ROUTE_MAP[pathname];
  if (exact) return exact;

  // Dynamic segment matching (order matters — most specific first)
  for (const pattern of DYNAMIC_PATTERNS) {
    const match = pathname.match(pattern.regex);
    if (match) return pattern.resolve(match);
  }

  // Fallback: derive title from last segment
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? 'Admin';
  return {
    title: last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, ' '),
  };
}

const ROUTE_MAP: Record<string, RouteInfo> = {
  // Overview
  '/': { title: 'Dashboard', parent: 'Overview' },
  '/analytics': { title: 'Analytics', parent: 'Overview' },

  // Logistics
  '/deliveries': { title: 'Deliveries', parent: 'Logistics' },
  '/disputes': { title: 'Disputes', parent: 'Logistics' },

  // People
  '/customers': { title: 'Customers', parent: 'People' },
  '/drivers': { title: 'Drivers', parent: 'People' },
  '/carriers': { title: 'Carriers', parent: 'People' },
  '/carriers/applications': { title: 'Applications', parent: 'People', parentUrl: '/carriers' },
  '/verifications': { title: 'Verifications', parent: 'People' },

  // Finance
  '/finance': { title: 'Finance Overview', parent: 'Finance' },
  '/payouts': { title: 'Payouts', parent: 'Finance' },

  // Coverage
  '/coverage/zones': { title: 'Zones', parent: 'Coverage' },
  '/coverage/service-areas': { title: 'Service Areas', parent: 'Coverage' },
  '/coverage/pricing-regions': { title: 'Pricing Regions', parent: 'Coverage' },

  // Communications
  '/notifications': { title: 'Notifications', parent: 'Communications' },
  '/notifications/broadcast': { title: 'Broadcast', parent: 'Communications', parentUrl: '/notifications' },

  // Settings
  '/settings': { title: 'Settings' },
  '/settings/system-config': { title: 'System Config', parent: 'Settings', parentUrl: '/settings' },
  '/settings/alerts': { title: 'Alerts', parent: 'Settings', parentUrl: '/settings' },
  '/settings/fee-settings': { title: 'Fee Settings', parent: 'Finance', parentUrl: '/finance' },
  '/settings/profile': { title: 'Profile', parent: 'Settings', parentUrl: '/settings' },
  '/settings/name-changes': { title: 'Name Changes', parent: 'Settings', parentUrl: '/settings' },

  // Admin
  '/users': { title: 'Users', parent: 'Admin' },
  '/waitlist': { title: 'Waitlist', parent: 'Admin' },
};

type DynamicPattern = {
  regex: RegExp;
  resolve: (match: RegExpMatchArray) => RouteInfo;
};

const DYNAMIC_PATTERNS: DynamicPattern[] = [
  {
    regex: /^\/carriers\/applications\/(.+)$/,
    resolve: () => ({
      title: 'Application Details',
      parent: 'Applications',
      parentUrl: '/carriers/applications',
    }),
  },
  {
    regex: /^\/carriers\/(.+)$/,
    resolve: () => ({
      title: 'Carrier Details',
      parent: 'Carriers',
      parentUrl: '/carriers',
    }),
  },
  {
    regex: /^\/drivers\/(.+)$/,
    resolve: () => ({
      title: 'Driver Details',
      parent: 'Drivers',
      parentUrl: '/drivers',
    }),
  },
  {
    regex: /^\/customers\/(.+)$/,
    resolve: () => ({
      title: 'Customer Details',
      parent: 'Customers',
      parentUrl: '/customers',
    }),
  },
  {
    regex: /^\/users\/(.+)$/,
    resolve: () => ({
      title: 'User Details',
      parent: 'Users',
      parentUrl: '/users',
    }),
  },
];

// ─── Layout ────────────────────────────────────────────────────────────────────

export default function AdminLayout() {
  const location = useLocation();
  const route = resolveRoute(location.pathname);

  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  {route.parent && (
                    <>
                      <BreadcrumbItem className="hidden md:block">
                        {route.parentUrl ? (
                          <BreadcrumbLink href={route.parentUrl}>
                            {route.parent}
                          </BreadcrumbLink>
                        ) : (
                          <span className="text-muted-foreground">{route.parent}</span>
                        )}
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className="hidden md:block" />
                    </>
                  )}
                  <BreadcrumbItem>
                    <BreadcrumbPage>{route.title}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <NotificationBell />
              <HeaderUser />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
