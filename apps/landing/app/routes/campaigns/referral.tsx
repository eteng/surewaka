import { Gift, Heart, Share2, Users } from 'lucide-react';
import { data } from 'react-router';
import type { Route } from './+types/referral';
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
      message: "You're in! Share your link with friends and start earning rewards when we launch.",
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
      message: "You're in! Share your link with friends and start earning rewards when we launch.",
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
    { title: 'Refer Friends to SureWaka — Earn Rewards' },
    {
      name: 'description',
      content:
        'Refer friends to SureWaka and earn delivery credits when they sign up. Help your network save on logistics while growing the community.',
    },
  ];
}

export default function ReferralPage() {
  return (
    <main className="px-6 py-16">
      {/* Hero */}
      <section className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
          <Gift className="h-4 w-4" aria-hidden="true" />
          Referral Program
        </div>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Refer friends, earn rewards
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          Know someone who moves goods regularly? Invite them to SureWaka and you'll both earn
          delivery credits when we launch. The more friends you refer, the more you save.
        </p>
      </section>

      {/* Referral benefits */}
      <section className="mx-auto mt-16 max-w-4xl">
        <div className="grid gap-6 sm:grid-cols-3">
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Gift className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Earn Credits</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Get delivery credits for every friend who joins the waitlist.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Heart className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Help Friends Save</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Your friends get credits too — everyone wins with cheaper deliveries.
            </p>
          </div>
          <div className="flex flex-col items-center rounded-lg bg-secondary p-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
              <Users className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">Grow the Community</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A bigger network means more drivers, better rates, and faster deliveries for all.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto mt-16 max-w-2xl">
        <h2 className="text-center text-2xl font-bold text-foreground">How it works</h2>
        <div className="mt-8 flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              1
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Join the waitlist</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Sign up below to secure your spot and get your referral link.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              2
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Share with friends</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Send your link to anyone who ships or delivers goods in Nigeria.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              3
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Earn rewards at launch</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                When we go live, you and your referrals get delivery credits to use immediately.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Waitlist Form */}
      <section className="mx-auto mt-16 max-w-md">
        <h2 className="text-center text-2xl font-bold text-foreground">
          Start referring today
        </h2>
        <p className="mt-3 text-center text-muted-foreground">
          Join the waitlist and we'll send you a personal referral link to share.
        </p>
        <div className="mt-8">
          <WaitlistForm source="campaign-referral" />
        </div>
      </section>
    </main>
  );
}
