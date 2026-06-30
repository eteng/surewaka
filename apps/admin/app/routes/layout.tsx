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

const routeTitles: Record<string, { title: string; parent?: string }> = {
  '/': { title: 'Dashboard', parent: 'Operations' },
  '/deliveries': { title: 'Deliveries', parent: 'Operations' },
  '/customers': { title: 'Customers', parent: 'Operations' },
  '/drivers': { title: 'Drivers', parent: 'Network' },
  '/carriers': { title: 'Carriers', parent: 'Network' },
  '/verifications': { title: 'Verifications', parent: 'Network' },
  '/disputes': { title: 'Disputes', parent: 'Operations' },
  '/analytics': { title: 'Analytics', parent: 'Operations' },
  '/settings': { title: 'Settings' },
};

export default function AdminLayout() {
  const location = useLocation();
  const route = routeTitles[location.pathname] ?? { title: 'Admin' };

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
                        <BreadcrumbLink href="#">{route.parent}</BreadcrumbLink>
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
