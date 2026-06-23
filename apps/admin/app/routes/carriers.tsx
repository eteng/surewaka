import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useCarriers } from '~/hooks/use-carrier-applications';
import { Input } from '~/components/ui/input';
import { Badge } from '~/components/ui/badge';
import { Skeleton } from '~/components/ui/skeleton';
import { Search } from 'lucide-react';

export function meta() {
  return [{ title: 'SureWaka Admin - Carriers' }];
}

export default function Carriers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const { data, meta, isLoading } = useCarriers({ search: search || undefined, page: 1, pageSize: 30 });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Carriers</h1>
          <p className="mt-1 text-muted-foreground">
            {meta ? `${meta.total} registered carrier${meta.total !== 1 ? 's' : ''}` : 'Manage registered logistics companies'}
          </p>
        </div>
        <button
          onClick={() => navigate('/carriers/applications')}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          View Applications →
        </button>
      </div>

      <div className="relative max-w-sm mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search carriers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-md" />)}
        </div>
      ) : data.length === 0 ? (
        <p className="text-muted-foreground py-16 text-center">No carriers found.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-3 text-left font-medium">Name</th>
              <th className="py-3 text-left font-medium">Slug</th>
              <th className="py-3 text-left font-medium">Driver Vetting</th>
              <th className="py-3 text-left font-medium">Status</th>
              <th className="py-3 text-left font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {data.map((carrier) => (
              <tr key={carrier.id} className="border-b hover:bg-muted/50">
                <td className="py-3 font-medium">{carrier.name}</td>
                <td className="py-3 text-muted-foreground">{carrier.slug}</td>
                <td className="py-3">
                  <Badge variant={carrier.driverVettingEnabled ? 'default' : 'secondary'}>
                    {carrier.driverVettingEnabled ? 'Enabled' : 'Off'}
                  </Badge>
                </td>
                <td className="py-3">
                  <Badge variant={carrier.isActive ? 'outline' : 'destructive'}>
                    {carrier.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </td>
                <td className="py-3 text-muted-foreground">
                  {new Date(carrier.createdAt).toLocaleDateString('en-NG')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
