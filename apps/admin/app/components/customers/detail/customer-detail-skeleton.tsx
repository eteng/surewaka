import { Skeleton } from '~/components/ui/skeleton';
import { Card, CardHeader, CardContent } from '~/components/ui/card';

export function CustomerDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Skeleton className="h-5 w-36" />

      {/* Profile header */}
      <div className="flex items-start gap-6 rounded-lg border bg-card p-6">
        {/* Avatar circle — 64px */}
        <Skeleton className="h-16 w-16 rounded-full" />

        {/* Info lines */}
        <div className="flex-1 space-y-2">
          {/* Name + badges row */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          {/* Contact row */}
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
          {/* Member since row */}
          <Skeleton className="h-3.5 w-52" />
        </div>
      </div>

      {/* Stat cards — 4 cards in responsive grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-7 w-20" />
              {/* Extra line for health score indicator */}
              {i === 2 && <Skeleton className="mt-1 h-3.5 w-16" />}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tab area */}
      <div className="space-y-4">
        {/* Tab triggers */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>

        {/* Tab content placeholder — table rows */}
        <div className="rounded-lg border">
          {/* Table header */}
          <div className="flex items-center gap-4 border-b px-4 py-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
          {/* Table rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-14" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
