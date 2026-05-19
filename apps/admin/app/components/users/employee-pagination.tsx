import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '~/components/ui/button';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

type EmployeePaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

export function EmployeePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: EmployeePaginationProps) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {total === 0 ? 'No results' : `Showing ${start}\u2013${end} of ${total}`}
      </p>

      <div className="flex items-center gap-4">
        {/* Page size selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="employee-page-size" className="text-sm text-muted-foreground">
            Rows per page
          </label>
          <select
            id="employee-page-size"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        {/* Page indicator */}
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages || 1}
        </span>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
