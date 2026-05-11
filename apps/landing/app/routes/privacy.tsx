import type { Route } from './+types/privacy';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Privacy Policy — SureWaka' },
    {
      name: 'description',
      content:
        'Learn how SureWaka collects, uses, and protects your personal information in compliance with the Nigeria Data Protection Regulation (NDPR).',
    },
  ];
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: May 2026</p>
      <p className="mt-1 text-xs italic text-muted-foreground">
        DRAFT — Pending legal review
      </p>

      <div className="mt-10 space-y-10 text-base leading-7 text-muted-foreground">
        <section>
          <h2 className="text-xl font-semibold text-foreground">1. Introduction</h2>
          <p className="mt-3">
            SureWaka Technologies Limited (&quot;SureWaka&quot;, &quot;we&quot;, &quot;us&quot;, or
            &quot;our&quot;) is committed to protecting your privacy and personal data. This Privacy
            Policy explains how we collect, use, store, and protect your information when you use
            our website at surewaka.com and related services.
          </p>
          <p className="mt-3">
            This policy is designed in accordance with the Nigeria Data Protection Regulation (NDPR)
            2019 and the Nigeria Data Protection Act (NDPA) 2023. By using our services, you consent
            to the data practices described in this policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">2. Data Controller</h2>
          <p className="mt-3">
            SureWaka Technologies Limited is the data controller responsible for your personal data.
            Our registered address is Lagos, Nigeria. For data protection inquiries, contact us at{' '}
            <a
              href="mailto:privacy@surewaka.com"
              className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
            >
              privacy@surewaka.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">3. Information We Collect</h2>
          <p className="mt-3">We collect the following categories of personal data:</p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-foreground">Waitlist registration data:</strong> Full name,
              email address, and user type (sender, business, or driver/logistics provider) when you
              sign up for our waitlist.
            </li>
            <li>
              <strong className="text-foreground">Source tracking:</strong> Which page or campaign
              you signed up from (e.g., homepage, Lagos launch campaign).
            </li>
            <li>
              <strong className="text-foreground">Technical data:</strong> IP address, browser type,
              device information, and pages visited — collected automatically when you browse our
              site.
            </li>
            <li>
              <strong className="text-foreground">Communication data:</strong> Any messages or
              inquiries you send to us via email.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">4. Legal Basis for Processing</h2>
          <p className="mt-3">We process your personal data based on:</p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-foreground">Consent:</strong> When you voluntarily submit your
              information through our waitlist form.
            </li>
            <li>
              <strong className="text-foreground">Legitimate interest:</strong> To improve our
              services, prevent fraud, and ensure platform security.
            </li>
            <li>
              <strong className="text-foreground">Legal obligation:</strong> When required to comply
              with applicable Nigerian law.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">5. How We Use Your Information</h2>
          <p className="mt-3">We use your personal data to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Process and confirm your waitlist registration</li>
            <li>Notify you when SureWaka launches or when relevant features become available</li>
            <li>Send you updates about our platform (you can opt out at any time)</li>
            <li>Analyze usage patterns to improve our website and services</li>
            <li>Prevent spam, fraud, and abuse of our platform</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">6. Data Sharing and Disclosure</h2>
          <p className="mt-3">
            We do not sell, rent, or trade your personal information. We may share your data with:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-foreground">Service providers:</strong> Third-party services
              that help us operate our platform (e.g., hosting, email delivery, analytics). These
              providers are contractually bound to protect your data.
            </li>
            <li>
              <strong className="text-foreground">Legal authorities:</strong> When required by law,
              court order, or to protect our rights and safety.
            </li>
            <li>
              <strong className="text-foreground">Business transfers:</strong> In the event of a
              merger, acquisition, or sale of assets, your data may be transferred as part of that
              transaction.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">7. Data Storage and Security</h2>
          <p className="mt-3">
            Your data is stored on secure servers provided by Supabase (hosted in the EU). We
            implement appropriate technical and organizational measures to protect your personal data
            against unauthorized access, alteration, disclosure, or destruction. These measures
            include encryption in transit (TLS), access controls, and regular security reviews.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">8. Data Retention</h2>
          <p className="mt-3">
            We retain your waitlist registration data for as long as necessary to fulfill the
            purposes described in this policy, or until you request deletion. If SureWaka does not
            launch within 24 months of your registration, we will delete your data unless you
            consent to continued retention.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">9. Your Rights</h2>
          <p className="mt-3">
            Under the NDPR and NDPA, you have the following rights regarding your personal data:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>
              <strong className="text-foreground">Right of access:</strong> Request a copy of the
              personal data we hold about you.
            </li>
            <li>
              <strong className="text-foreground">Right to rectification:</strong> Request
              correction of inaccurate or incomplete data.
            </li>
            <li>
              <strong className="text-foreground">Right to erasure:</strong> Request deletion of
              your personal data.
            </li>
            <li>
              <strong className="text-foreground">Right to withdraw consent:</strong> Withdraw your
              consent at any time without affecting the lawfulness of prior processing.
            </li>
            <li>
              <strong className="text-foreground">Right to object:</strong> Object to processing of
              your data for direct marketing purposes.
            </li>
            <li>
              <strong className="text-foreground">Right to lodge a complaint:</strong> File a
              complaint with the Nigeria Data Protection Commission (NDPC).
            </li>
          </ul>
          <p className="mt-3">
            To exercise any of these rights, email us at{' '}
            <a
              href="mailto:privacy@surewaka.com"
              className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
            >
              privacy@surewaka.com
            </a>
            . We will respond within 30 days.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">10. Cookies and Tracking</h2>
          <p className="mt-3">
            Our website currently does not use cookies for tracking or advertising purposes. We may
            use essential cookies in the future to maintain session state. If we introduce
            non-essential cookies, we will update this policy and obtain your consent.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">11. Children&apos;s Privacy</h2>
          <p className="mt-3">
            Our services are not directed at individuals under the age of 18. We do not knowingly
            collect personal data from children. If we become aware that we have collected data from
            a child, we will delete it promptly.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">12. Changes to This Policy</h2>
          <p className="mt-3">
            We may update this Privacy Policy from time to time. We will notify you of significant
            changes by email or by posting a notice on our website. Your continued use of our
            services after changes are posted constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">13. Contact Us</h2>
          <p className="mt-3">
            If you have questions about this Privacy Policy or wish to exercise your data rights,
            contact us at:
          </p>
          <ul className="mt-3 space-y-1">
            <li>
              Email:{' '}
              <a
                href="mailto:privacy@surewaka.com"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              >
                privacy@surewaka.com
              </a>
            </li>
            <li>
              General inquiries:{' '}
              <a
                href="mailto:hello@surewaka.com"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              >
                hello@surewaka.com
              </a>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
