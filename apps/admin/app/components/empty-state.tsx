type EmptyStateProps = {
  icon: React.ReactNode;
  heading: string;
  body: string;
  action?: { label: string; href: string };
};

export function EmptyState({ icon, heading, body, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <h2 className="mt-4 text-base font-semibold text-foreground">{heading}</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && (
        <a href={action.href} className="mt-6 text-sm font-medium text-primary hover:underline">
          {action.label} →
        </a>
      )}
    </div>
  );
}
