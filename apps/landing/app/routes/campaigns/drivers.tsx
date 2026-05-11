import { Clock, Truck, TrendingUp, Wallet } from 'lucide-react';
import { data } from 'react-router';
import type { Route } from './+types/drivers';
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
  if (isRateLimited(request)) {
    return data<ActionData>(
      { success: false, message: 'Too many submissions. Please try again later.' },
      { status: 429 },
    );
  }

  const formData = await request.formData();

  if (isHoneypotFilled(formData)) {
    return data<ActionData>({
      success: true,
      message: "You're on the list! We'll reach out when we start onboarding drivers.",
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
    return data<ActionData>({ success: false, errors: fieldErrors }, { status: 400 });
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
        { success: false, message: 'Something went wrong. Please try again.' },
        { status: 500 },
      );
    }

    return data<ActionData>({
      success: true,
      message: "You're on the list! We'll reach out when we start onboarding drivers.",
    });
  } catch (err) {
    console.error('Waitlist signup failed:', err);
    return data<ActionData>(
      { success: false, message: 'Something went wrong. Please try again.' },
      { status: 500 },
    );
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Drive with SureWaka — Earn More as a Logistics Provider' },
    {
      name: 'description',
      content:
        'Join SureWaka as a driver or logistics provider. Get steady delivery jobs, reliable weekly payments, flexible schedules, and grow your business on your terms.',
    },
  ];
}

export default function DriversPage() {
  return (
    <main className="px-6 py-16">
      {/* Hero */}
      <section className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <Truck className="h-4 w-4" aria-hidden="true" />
          Driver Recruitment
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Earn more as a driver on SureWaka
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Whether you own a bike, car, or truck — SureWaka connects you with delivery jobs that fit
          your schedule. No middlemen, no delays. Just steady work and reliable pay.
        </p>
      </section>

      {/* Driver benefits */}
      <section className="mx-auto mt-16 max-w-4xl">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Truck className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Steady Jobs</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Get matched with deliveries near you — no more waiting around for work.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Wallet className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Reliable Payments</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Get paid weekly, directly to your bank account. No chasing customers for money.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Clock className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Flexible Schedule</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Work when you want. Accept jobs that fit your availability and location.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Grow Your Business</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Build your reputation, earn more over time, and expand your fleet with SureWaka.
            </p>
          </div>
        </div>
      </section>

      {/* Waitlist Form */}
      <section className="mx-auto mt-16 max-w-md">
        <h2 className="text-center text-2xl font-bold text-foreground">
          Join as a driver or logistics provider
        </h2>
        <p className="mt-3 text-center text-muted-foreground">
          Sign up now and be among the first drivers onboarded when we launch.
        </p>
        <div className="mt-8">
          <WaitlistForm source="campaign-drivers" />
        </div>
      </section>
    </main>
  );
}
