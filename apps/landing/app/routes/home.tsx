import type { Route } from './+types/home';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'SureWaka - Move Goods Across Nigeria' },
    {
      name: 'description',
      content:
        "Nigeria's logistics marketplace. Compare rates from verified carriers, book instantly, and track every delivery in real-time.",
    },
  ];
}

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        <h1 className="max-w-4xl text-5xl font-bold tracking-tight text-foreground sm:text-7xl">
          Move goods across Nigeria
        </h1>
        <p className="mt-6 max-w-2xl text-xl text-muted-foreground">
          Compare rates from verified carriers. Book in seconds. Track every delivery in real-time.
        </p>
        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <a
            href="#waitlist"
            className="rounded-md bg-primary px-8 py-4 text-lg font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Join the Waitlist
          </a>
          <a
            href="#how-it-works"
            className="rounded-md border border-border px-8 py-4 text-lg font-semibold text-foreground hover:bg-secondary"
          >
            How It Works
          </a>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-center text-3xl font-bold text-foreground">How SureWaka Works</h2>
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          <Step number="1" title="Tell us what you're sending" description="Enter pickup and delivery details. Get instant quotes from multiple carriers." />
          <Step number="2" title="Compare & book" description="See prices, ratings, and delivery times. Pick the best option for you." />
          <Step number="3" title="Track in real-time" description="Watch your delivery move in real-time. Get notified at every step." />
        </div>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="bg-secondary px-6 py-24">
        <div className="mx-auto max-w-md text-center">
          <h2 className="text-3xl font-bold text-foreground">Get Early Access</h2>
          <p className="mt-4 text-muted-foreground">
            Be the first to know when SureWaka launches in Lagos.
          </p>
          <form method="post" className="mt-8 flex gap-2">
            <input
              type="email"
              name="email"
              placeholder="Enter your email"
              required
              className="flex-1 rounded-md border border-border px-4 py-3 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Join
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

function Step({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
        {number}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-muted-foreground">{description}</p>
    </div>
  );
}
