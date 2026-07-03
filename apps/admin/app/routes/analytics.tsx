import { useState } from 'react';
import type { Route } from './+types/analytics';
import { cn } from '~/lib/utils';
import { PeriodSelector } from '~/components/analytics/period-selector';
import { OverviewTab } from '~/components/analytics/overview-tab';
import { DeliveryPerformanceTab } from '~/components/analytics/delivery-performance-tab';
import { DriverPerformanceTab } from '~/components/analytics/driver-performance-tab';
import { CarrierPerformanceTab } from '~/components/analytics/carrier-performance-tab';
import { CustomerExperienceTab } from '~/components/analytics/customer-experience-tab';
import { RootCauseTab } from '~/components/analytics/root-cause-tab';
import type { AnalyticsParams } from '~/hooks/use-analytics';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Analytics' }];
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'delivery', label: 'Delivery Performance' },
  { id: 'drivers', label: 'Driver Performance' },
  { id: 'carriers', label: 'Carrier SLA' },
  { id: 'customer', label: 'Customer Experience' },
  { id: 'rootcause', label: 'Root Cause' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Analytics() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [period, setPeriod] = useState<AnalyticsParams>({ period: 'week' });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="mt-1 text-muted-foreground">Platform performance and delivery intelligence</p>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div
        className="mt-6 flex gap-1 overflow-x-auto border-b border-border pb-0"
        role="tablist"
        aria-label="Analytics sections"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'shrink-0 rounded-t px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.id
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === 'overview' && <OverviewTab params={period} />}
        {activeTab === 'delivery' && <DeliveryPerformanceTab params={period} />}
        {activeTab === 'drivers' && <DriverPerformanceTab params={period} />}
        {activeTab === 'carriers' && <CarrierPerformanceTab params={period} />}
        {activeTab === 'customer' && <CustomerExperienceTab params={period} />}
        {activeTab === 'rootcause' && <RootCauseTab params={period} />}
      </div>
    </div>
  );
}
