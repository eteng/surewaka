import { KpiCard } from './kpi-card';
import { useAnalyticsOverview } from '~/hooks/use-analytics';
import type { AnalyticsParams } from '~/hooks/use-analytics';

type Props = { params: AnalyticsParams };

export function OverviewTab({ params }: Props) {
  const { data, isLoading, error } = useAnalyticsOverview(params);

  if (error) {
    return <p className="mt-4 text-sm text-destructive">Failed to load overview: {error}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label="On-Time Rate"
        value={data?.onTimeRate}
        unit="%"
        sparkline={data?.onTimeRateSparkline}
        target={90}
        higherIsBetter
        isLoading={isLoading}
      />
      <KpiCard
        label="Fulfillment Rate"
        value={data?.fulfillmentRate}
        unit="%"
        sparkline={data?.fulfillmentRateSparkline}
        target={95}
        higherIsBetter
        isLoading={isLoading}
      />
      <KpiCard
        label="Avg Delivery Time"
        value={data?.avgDeliveryMinutes}
        unit=" min"
        sparkline={data?.avgDeliveryMinutesSparkline}
        higherIsBetter={false}
        isLoading={isLoading}
      />
      <KpiCard
        label="Dispute Rate"
        value={data?.disputeRate}
        unit="%"
        sparkline={data?.disputeRateSparkline}
        target={2}
        higherIsBetter={false}
        isLoading={isLoading}
      />
      <KpiCard
        label="Customer Update Frequency"
        value={data?.customerUpdateFrequency}
        unit=" updates/delivery"
        sparkline={data?.customerUpdateFrequencySparkline}
        target={3}
        higherIsBetter
        isLoading={isLoading}
      />
      <KpiCard
        label="Driver Completion Rate"
        value={data?.driverCompletionRate}
        unit="%"
        sparkline={data?.driverCompletionRateSparkline}
        target={97}
        higherIsBetter
        isLoading={isLoading}
      />
    </div>
  );
}
