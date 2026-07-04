import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import type { AnalyticsParams } from '~/hooks/use-analytics';

type Props = {
  value: AnalyticsParams;
  onChange: (p: AnalyticsParams) => void;
};

export function PeriodSelector({ value, onChange }: Props) {
  return (
    <Select
      value={value.period}
      onValueChange={(period) => onChange({ period: period as AnalyticsParams['period'] })}
    >
      <SelectTrigger className="w-[160px]" aria-label="Select time period">
        <SelectValue placeholder="Select period" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="today">Today</SelectItem>
        <SelectItem value="week">This Week</SelectItem>
        <SelectItem value="month">This Month</SelectItem>
        <SelectItem value="custom">Custom</SelectItem>
      </SelectContent>
    </Select>
  );
}
