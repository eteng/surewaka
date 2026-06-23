import { useState } from 'react';
import { useCarrierApplications } from '~/hooks/use-carrier-applications';
import { ApplicationTable } from '~/components/carriers/application-table';
import { ApplicationToolbar } from '~/components/carriers/application-toolbar';
import { CreateStrategicPartnerDialog } from '~/components/carriers/create-strategic-partner-dialog';

export function meta() {
  return [{ title: 'SureWaka Admin - Carrier Applications' }];
}

export default function CarrierApplications() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page] = useState(1);
  const [strategicOpen, setStrategicOpen] = useState(false);

  const { data, meta, isLoading, refetch } = useCarrierApplications({
    search: search || undefined,
    status: (status && status !== 'all' ? status : undefined) as never,
    page,
    pageSize: 20,
    sortBy: 'createdAt',
    sortDir: 'desc',
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Carrier Applications</h1>
          <p className="mt-1 text-muted-foreground">
            {meta ? `${meta.total} application${meta.total !== 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>

      <ApplicationToolbar
        search={search}
        status={status}
        onSearchChange={setSearch}
        onStatusChange={setStatus}
        onCreateStrategicPartner={() => setStrategicOpen(true)}
      />

      <ApplicationTable applications={data} isLoading={isLoading} />

      <CreateStrategicPartnerDialog
        open={strategicOpen}
        onOpenChange={setStrategicOpen}
        onSuccess={refetch}
      />
    </div>
  );
}
