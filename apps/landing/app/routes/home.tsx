import { BarChart3, MapPin, MapPinned, Package, ShieldCheck, Truck, Users } from 'lucide-react';
import { data } from 'react-router';
import type { Route } from './+types/home';
import { WaitlistForm } from '~/components/waitlist-form';
import { getSupabaseAdmin } from '~/lib/supabase.server';
import { isHoneypotFilled, isRateLimited } from '~/lib/anti-spam.server';
import { waitlistSignupSchema } from '@surewaka/shared';

type ActionData = {
  success: boolean;
  errors?: Record<string, string[]>;
  message?: string;
};

export async function action({ request }: Route.ActionArgs) {
  // Rate limiting — block excessive submissions from same IP
  if (isRateLimited(request)) {
    return data<ActionData>(
      { success: false, message: 'Too many submissions. Please try again later.' },
      { status: 429 },
    );
  }

  const formData = await request.formData();

  // Honeypot — silently reject bot submissions
  if (isHoneypotFilled(formData)) {
    // Return fake success so bots think it worked
    return data<ActionData>({
      success: true,
      message: "You're on the list! We'll notify you when SureWaka launches.",
    });
  }

  const rawData = {
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    userType: formData.get('userType'),
    source: formData.get('source'),
  };

  const result = waitlistSignupSchema.safeParse(rawData);

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as string;
      if (!fieldErrors[field]) {
        fieldErrors[field] = [];
      }
      fieldErrors[field].push(issue.message);
    }
    return data<ActionData>(
      { success: false, errors: fieldErrors },
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('waitlist_signups').insert({
      full_name: result.data.fullName,
      email: result.data.email,
      user_type: result.data.userType,
      source: result.data.source,
    });

    if (error) {
      // Handle duplicate email (Postgres unique constraint violation)
      if (error.code === '23505') {
        return data<ActionData>(
          {
            success: false,
            errors: { email: ['This email is already on the waitlist'] },
            message: 'This email is already on the waitlist',
          },
          { status: 409 },
        );
      }

      console.error('Supabase insert error:', error);
      return data<ActionData>(
        {
          success: false,
          message: 'Something went wrong. Please try again.',
        },
        { status: 500 },
      );
    }

    return data<ActionData>({
      success: true,
      message: "You're on the list! We'll notify you when SureWaka launches.",
    });
  } catch (err) {
    console.error('Waitlist signup failed:', err);
    return data<ActionData>(
      {
        success: false,
        message: 'Something went wrong. Please try again.',
      },
      { status: 500 },
    );
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'SureWaka — Connect with Verified Logistics Providers in Nigeria' },
    {
      name: 'description',
      content:
        "Nigeria's logistics marketplace. Compare rates from verified carriers or get matched with on-demand drivers. Book instantly and track every delivery in real-time.",
    },
    { property: 'og:title', content: 'SureWaka — Connect with Verified Logistics Providers in Nigeria' },
    {
      property: 'og:description',
      content:
        "Nigeria's logistics marketplace. Compare rates from verified carriers or get matched with on-demand drivers. Book instantly and track every delivery in real-time.",
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: 'https://surewaka.com' },
    { property: 'og:site_name', content: 'SureWaka' },
  ];
}

export default function HomePage() {
  return (
    <main>
      {/* Hero Section */}
      <section className="flex min-h-[80vh] flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
          Connect with verified logistics providers across Nigeria
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
          Compare rates from trusted carriers or get matched with on-demand drivers — one platform
          for all your delivery needs.
        </p>
        <div className="mt-10 flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
          <a
            href="#waitlist"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 sm:w-auto"
          >
            Join the Waitlist
          </a>
          <a
            href="#how-it-works"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md border border-border px-8 py-3.5 text-base font-semibold text-foreground transition-colors hover:bg-secondary sm:w-auto"
          >
            See How It Works
          </a>
        </div>
      </section>

      {/* Value Proposition Section */}
      <section id="benefits" className="border-t border-border bg-secondary px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Why choose SureWaka?
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Everything you need to move goods across Nigeria — faster, cheaper, and with full
            visibility.
          </p>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg bg-background p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <BarChart3 className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Compare Prices Instantly</h3>
              <p className="mt-2 text-muted-foreground">
                Get quotes from multiple verified carriers side by side. Pick the best rate for your
                budget and timeline.
              </p>
            </div>
            <div className="rounded-lg bg-background p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <MapPin className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Real-Time Tracking</h3>
              <p className="mt-2 text-muted-foreground">
                Know exactly where your package is at every step. Get live updates from pickup to
                delivery.
              </p>
            </div>
            <div className="rounded-lg bg-background p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Verified Providers</h3>
              <p className="mt-2 text-muted-foreground">
                Every carrier and driver on our platform is vetted and verified. Your goods are in
                safe hands.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            How it works
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Get your goods moving in three simple steps.
          </p>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                1
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Request a Delivery</h3>
              <p className="mt-2 text-muted-foreground">
                Tell us where your package is going, its size, and when you need it delivered.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                2
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Compare Options</h3>
              <p className="mt-2 text-muted-foreground">
                Instantly see quotes from verified carriers and available drivers. Pick the best fit
                for your budget and timeline.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                3
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Track in Real-Time</h3>
              <p className="mt-2 text-muted-foreground">
                Follow your delivery live from pickup to drop-off. Get updates at every step of the
                journey.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Audience Segments Section */}
      <section className="border-t border-border bg-secondary px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Built for everyone in the logistics chain
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Whether you're sending packages or delivering them, SureWaka has you covered.
          </p>
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            {/* Senders & Businesses */}
            <div className="flex flex-col rounded-lg bg-background p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <Package className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-foreground">
                Senders &amp; Businesses
              </h3>
              <p className="mt-3 flex-1 text-muted-foreground">
                Stop overpaying for deliveries. Compare rates from multiple verified carriers
                instantly, book in seconds, and track every package in real-time. Perfect for
                e-commerce sellers and businesses shipping across Nigeria.
              </p>
              <a
                href="#waitlist"
                className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Join as a Sender
              </a>
            </div>

            {/* Drivers & Logistics Providers */}
            <div className="flex flex-col rounded-lg bg-background p-8 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <Truck className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-foreground">
                Drivers &amp; Logistics Providers
              </h3>
              <p className="mt-3 flex-1 text-muted-foreground">
                Fill your empty trucks and grow your delivery business. Get matched with senders who
                need your services, manage jobs from one dashboard, and get paid reliably. Join a
                network of verified providers across Nigeria.
              </p>
              <a
                href="#waitlist"
                className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Join as a Driver
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Trust / Social Proof Section */}
      <section id="trust" className="px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Built by people who understand Nigerian logistics
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            We've experienced the pain of unreliable deliveries firsthand. That's why we're building
            SureWaka.
          </p>

          {/* Founding Team */}
          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <div className="flex flex-col items-center rounded-lg bg-secondary p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <span className="text-2xl font-bold text-primary">E</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Et</h3>
              <p className="mt-1 text-sm font-medium text-primary">Co-Founder</p>
              <p className="mt-3 text-muted-foreground">
                Product and technology leader with experience building digital platforms across West
                Africa. Passionate about using tech to solve everyday logistics challenges.
              </p>
            </div>
            <div className="flex flex-col items-center rounded-lg bg-secondary p-8 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <span className="text-2xl font-bold text-primary">Y</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-foreground">Yobo</h3>
              <p className="mt-1 text-sm font-medium text-primary">Co-Founder</p>
              <p className="mt-3 text-muted-foreground">
                Operations and logistics expert with deep knowledge of Nigeria's supply chain
                landscape. Focused on building reliable carrier networks and driver partnerships.
              </p>
            </div>
          </div>

          {/* Trust Indicators */}
          <div className="mt-16 grid gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <Users className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <p className="mt-3 text-3xl font-bold text-foreground">500+</p>
              <p className="mt-1 text-sm text-muted-foreground">People on the waitlist</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <MapPinned className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <p className="mt-3 text-3xl font-bold text-foreground">3</p>
              <p className="mt-1 text-sm text-muted-foreground">Cities at launch</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10">
                <Truck className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <p className="mt-3 text-3xl font-bold text-foreground">20+</p>
              <p className="mt-1 text-sm text-muted-foreground">Verified logistics partners</p>
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist Section */}
      <section id="waitlist" className="border-t border-border bg-secondary px-6 py-20">
        <div className="mx-auto max-w-xl">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Join the waitlist
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-center text-muted-foreground">
            Be the first to know when SureWaka launches. Sign up now and get early access.
          </p>
          <div className="mt-10">
            <WaitlistForm source="home" />
          </div>
        </div>
      </section>
    </main>
  );
}
