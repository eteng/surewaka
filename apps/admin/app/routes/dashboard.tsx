import { useState } from 'react';
import { KpiBar } from '~/components/ops-hub/kpi-bar';
import { AtRiskList } from '~/components/ops-hub/at-risk-list';
import { AlertFeed } from '~/components/ops-hub/alert-feed';
import { EscalationModal } from '~/components/ops-hub/escalation-modal';
import { DeliveryMap } from '~/components/deliveries/delivery-map';
import { useOpsHubStats, useAtRiskDeliveries } from '~/hooks/use-ops-hub';
import { useDeliveries } from '~/hooks/use-deliveries';
import type { Route } from './+types/dashboard';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Ops Hub' }];
}

export default function OpsHub() {
  const { stats, isLoading: statsLoading, error: statsError } = useOpsHubStats();
  const { atRisk, isLoading: atRiskLoading } = useAtRiskDeliveries();
  const { data: activeDeliveries, isLoading: mapLoading } = useDeliveries({ tab: 'active', pageSize: 100 });
  const [escalatingId, setEscalatingId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Operations Hub</h1>
        <p className="mt-1 text-sm text-muted-foreground">Live delivery command centre — auto-refreshes every 30 s</p>
      </div>

      <KpiBar stats={stats} isLoading={statsLoading} error={statsError} />

      <div className="flex min-h-0 flex-1 gap-6">
        {/* Left column: map + at-risk list */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="h-80 overflow-hidden rounded-lg border border-border">
            <DeliveryMap data={activeDeliveries} isLoading={mapLoading} />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              At-Risk Deliveries
              {atRisk.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  — {atRisk.length} need attention
                </span>
              )}
            </h2>
            <AtRiskList
              deliveries={atRisk}
              isLoading={atRiskLoading}
              onEscalate={(id) => setEscalatingId(id)}
            />
          </div>
        </div>

        {/* Right column: alert feed (hidden below xl breakpoint) */}
        <div className="hidden w-80 shrink-0 xl:block">
          <div className="sticky top-6 rounded-lg border border-border p-4">
            <AlertFeed />
          </div>
        </div>
      </div>

      {escalatingId && (
        <EscalationModal
          deliveryId={escalatingId}
          onClose={() => setEscalatingId(null)}
        />
      )}
    </div>
  );
}
