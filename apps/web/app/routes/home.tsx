import type { Route } from './+types/home';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'SureWaka - Move Goods Across Nigeria' },
    {
      name: 'description',
      content:
        'Connect with verified logistics providers and drivers. Compare rates, book instantly, track in real-time.',
    },
  ];
}

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          SureWaka
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Move goods across Nigeria — reliably, affordably, instantly.
        </p>
        <div className="mt-8 flex gap-4 justify-center">
          <a
            href="/book"
            className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Book a Delivery
          </a>
          <a
            href="/track"
            className="rounded-md border border-border px-6 py-3 text-sm font-semibold text-foreground hover:bg-secondary"
          >
            Track Delivery
          </a>
        </div>
      </div>
    </main>
  );
}
