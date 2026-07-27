import { useState } from 'react';
import { AlertTriangle, Bell } from 'lucide-react';
import { KpiBar } from '~/components/ops-hub/kpi-bar';
import { AtRiskList } from '~/components/ops-hub/at-risk-list';
import { AlertFeed } from '~/components/ops-hub/alert-feed';
import { EscalationModal } from '~/components/ops-hub/escalation-modal';
import { useOpsHubStats, useAtRiskDeliveries } from '~/hooks/use-ops-hub';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '~/components/ui/sheet';
import { Button } from '~/components/ui/button';
import type { Route } from './+types/dashboard';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Ops Hub' }];
}

export default function OpsHub() {
  const { stats, isLoading: statsLoading, error: statsError, lastUpdated } = useOpsHubStats();
  const { atRisk, isLoading: atRiskLoading, error: atRiskError } = useAtRiskDeliveries();
  const [escalatingId, setEscalatingId] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Operations Hub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live delivery command centre — auto-refreshes every 30 s
            {lastUpdated && (
              <span className="ml-2 text-xs text-muted-foreground/70">
                · updated {new Date(lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>

        {/* Alert badge + drawer for sub-xl screens */}
        <div className="xl:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="relative" aria-label="Open alert feed">
                <Bell className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden sm:inline">Alerts</span>
                {stats && stats.atRiskDeliveries > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                    {stats.atRiskDeliveries}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[360px] sm:w-[400px]">
              <SheetHeader>
                <SheetTitle>Alert Feed</SheetTitle>
              </SheetHeader>
              <div className="mt-4 h-[calc(100vh-6rem)] overflow-y-auto">
                <AlertFeed />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <KpiBar stats={stats} isLoading={statsLoading} error={statsError} />

      <div className="flex min-h-0 flex-1 gap-6">
        {/* Left column: at-risk list */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              At-Risk Deliveries
              {atRisk.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  — {atRisk.length} need attention
                </span>
              )}
            </h2>
            {atRiskError && (
              <p className="text-sm text-destructive">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                Failed to load at-risk deliveries: {atRiskError}
              </p>
            )}
            <AtRiskList
              deliveries={atRisk}
              isLoading={atRiskLoading}
              onEscalate={(id) => setEscalatingId(id)}
            />
          </div>
        </div>

        {/* Right column: alert feed (visible only on xl+) */}
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
