import type { TabCounts } from '@surewaka/shared';
import { cn } from '~/lib/utils';

export type DeliveryTab = 'all' | 'requests' | 'active' | 'completed';

type TabConfig = {
  id: DeliveryTab;
  label: string;
};

const TABS: TabConfig[] = [
  { id: 'all', label: 'All' },
  { id: 'requests', label: 'Requests' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
];

type LifecycleTabBarProps = {
  activeTab: DeliveryTab;
  onTabChange: (tab: DeliveryTab) => void;
  tabCounts: TabCounts | null;
};

function TabCountBadge({ count, tabId }: { count: number; tabId: DeliveryTab }) {
  return (
    <span
      className={cn(
        'ml-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        tabId === 'requests' && count > 0
          ? 'bg-amber-100 text-amber-700'
          : tabId === 'active' && count > 0
            ? 'bg-blue-100 text-blue-700'
            : 'bg-muted text-muted-foreground',
      )}
    >
      {count}
    </span>
  );
}

export function LifecycleTabBar({ activeTab, onTabChange, tabCounts }: LifecycleTabBarProps) {
  return (
    <nav role="tablist" aria-label="Delivery lifecycle tabs" className="flex items-center gap-1 border-b">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={cn(
              'relative cursor-pointer px-4 py-2.5 text-sm font-medium transition-colors duration-200',
              'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              isActive
                ? 'text-green-600'
                : 'text-muted-foreground'
            )}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="flex items-center">
              {tab.label}
              {tabCounts && <TabCountBadge count={tabCounts[tab.id]} tabId={tab.id} />}
            </span>
            {isActive && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-600 rounded-full"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
