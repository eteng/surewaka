import { MapPin, Package, Truck } from 'lucide-react';
import { data } from 'react-router';
import type { Route } from './+types/lagos-launch';
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
      message: "You're on the list! We'll notify you when SureWaka launches in Lagos.",
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
      message: "You're on the list! We'll notify you when SureWaka launches in Lagos.",
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
    { title: 'SureWaka Lagos Launch — Join the Waitlist' },
    {
      name: 'description',
      content:
        'SureWaka is launching in Lagos. Compare rates from verified carriers, get matched with on-demand drivers, and move goods across Lagos faster. Join the waitlist today.',
    },
  ];
}

export default function LagosLaunchPage() {
  return (
    <main className="px-6 py-16">
      {/* Hero */}
      <section className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <MapPin className="h-4 w-4" aria-hidden="true" />
          Lagos, Nigeria
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          SureWaka is launching in Lagos
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Lagos moves fast — your deliveries should too. We're bringing verified carriers and
          on-demand drivers together on one platform, built for the pace of Africa's largest city.
        </p>
      </section>

      {/* Lagos-specific value props */}
      <section className="mx-auto mt-16 max-w-4xl">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Package className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Same-Day Delivery</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Move goods across Lagos in hours, not days.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Truck className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Verified Drivers</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every driver is vetted. Your goods are in safe hands.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Real-Time Tracking</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Know exactly where your package is, from Ikeja to Lekki.
            </p>
          </div>
        </div>
      </section>

      {/* Waitlist Form */}
      <section className="mx-auto mt-16 max-w-md">
        <h2 className="text-center text-2xl font-bold text-foreground">
          Be first in line for Lagos
        </h2>
        <p className="mt-3 text-center text-muted-foreground">
          Sign up now and get early access when we launch in Lagos.
        </p>
        <div className="mt-8">
          <WaitlistForm source="campaign-lagos" />
        </div>
      </section>
    </main>
  );
}
