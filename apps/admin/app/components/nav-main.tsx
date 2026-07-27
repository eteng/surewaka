import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '~/components/ui/sidebar';

type NavItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
  items?: { title: string; url: string }[];
};

/**
 * Checks if a pathname matches a nav item URL.
 * Handles exact match and prefix match for nested routes.
 */
function isPathActive(pathname: string, itemUrl: string): boolean {
  if (itemUrl === '/') return pathname === '/';
  // Exact match or starts with the item URL followed by a slash or end
  return pathname === itemUrl || pathname.startsWith(itemUrl + '/');
}

export function NavMain({ items, label }: { items: NavItem[]; label?: string }) {
  const { pathname } = useLocation();

  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarMenu>
        {items.map((item) => {
          // Determine if any sub-item is active — used for auto-open and group highlighting
          const hasActiveChild = item.items?.some((sub) => isPathActive(pathname, sub.url));

          return (
            <Collapsible
              key={item.title}
              asChild
              defaultOpen={hasActiveChild}
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title} isActive={hasActiveChild}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem) => {
                      const active = isPathActive(pathname, subItem.url);
                      return (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton asChild isActive={active}>
                            <Link
                              to={subItem.url}
                              aria-current={active ? 'page' : undefined}
                            >
                              <span>{subItem.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      );
                    })}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
