import type { Route } from './+types/terms';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Terms of Service — SureWaka' },
    {
      name: 'description',
      content:
        'Read the Terms of Service for SureWaka. Understand the rules and guidelines for using our logistics platform in Nigeria.',
    },
  ];
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Terms of Service
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: May 2026</p>
      <p className="mt-1 text-xs italic text-muted-foreground">
        DRAFT — Pending legal review
      </p>

      <div className="mt-10 space-y-10 text-base leading-7 text-muted-foreground">
        <section>
          <h2 className="text-xl font-semibold text-foreground">1. Introduction</h2>
          <p className="mt-3">
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of the SureWaka
            website at surewaka.com and any related services provided by SureWaka Technologies
            Limited (&quot;SureWaka&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), a
            company registered in Nigeria.
          </p>
          <p className="mt-3">
            By accessing or using our services, you agree to be bound by these Terms. If you do not
            agree, please do not use our services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">2. Eligibility</h2>
          <p className="mt-3">
            You must be at least 18 years old to use our services. By using SureWaka, you represent
            and warrant that you meet this age requirement and have the legal capacity to enter into
            these Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">3. Description of Service</h2>
          <p className="mt-3">
            SureWaka is a logistics marketplace that connects senders (individuals and businesses)
            with verified carriers and independent drivers in Nigeria. Our platform offers:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Carrier aggregation — compare rates from multiple verified logistics providers</li>
            <li>On-demand matching — real-time driver matching for last-mile delivery</li>
            <li>Delivery tracking — real-time visibility from pickup to drop-off</li>
          </ul>
          <p className="mt-3">
            Currently, we are in a pre-launch phase. The waitlist registration allows you to express
            interest and receive notifications when the platform becomes available.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">4. Waitlist Registration</h2>
          <p className="mt-3">
            By joining our waitlist, you agree to provide accurate and complete information
            (including your name, email address, and user type). Waitlist registration does not
            guarantee access to the platform, priority placement, or any specific launch date.
          </p>
          <p className="mt-3">
            We reserve the right to remove any registration that contains false, misleading, or
            inappropriate information.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">5. User Conduct</h2>
          <p className="mt-3">When using our services, you agree not to:</p>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>Provide false or misleading information</li>
            <li>Use automated systems (bots) to submit forms or interact with our platform</li>
            <li>Attempt to gain unauthorized access to our systems or data</li>
            <li>Use our services for any unlawful purpose</li>
            <li>Interfere with or disrupt the operation of our website</li>
            <li>Impersonate another person or entity</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">6. Intellectual Property</h2>
          <p className="mt-3">
            All content on surewaka.com — including text, graphics, logos, icons, images, and
            software — is the property of SureWaka Technologies Limited or its licensors and is
            protected by Nigerian and international copyright laws. You may not reproduce,
            distribute, or create derivative works from our content without prior written consent.
          </p>
          <p className="mt-3">
            The SureWaka name, logo, and all related marks are trademarks of SureWaka Technologies
            Limited.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">7. Communications</h2>
          <p className="mt-3">
            By joining our waitlist, you consent to receive electronic communications from us,
            including launch announcements, product updates, and promotional messages. You may
            unsubscribe from marketing communications at any time by clicking the unsubscribe link
            in any email or by contacting us directly.
          </p>
          <p className="mt-3">
            Transactional communications (e.g., confirmation of your waitlist registration) are not
            subject to unsubscribe requests.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">8. Disclaimer of Warranties</h2>
          <p className="mt-3">
            Our services are provided &quot;as is&quot; and &quot;as available&quot; without
            warranties of any kind, whether express or implied. We do not guarantee that our website
            will be uninterrupted, error-free, or free of harmful components.
          </p>
          <p className="mt-3">
            We make no representations about the accuracy, reliability, or completeness of any
            content on our website.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">9. Limitation of Liability</h2>
          <p className="mt-3">
            To the maximum extent permitted by Nigerian law, SureWaka Technologies Limited shall not
            be liable for any indirect, incidental, special, consequential, or punitive damages
            arising from your use of or inability to use our services.
          </p>
          <p className="mt-3">
            Our total liability for any claim arising from these Terms or your use of our services
            shall not exceed the amount you have paid to us (if any) in the twelve (12) months
            preceding the claim.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">10. Indemnification</h2>
          <p className="mt-3">
            You agree to indemnify and hold harmless SureWaka Technologies Limited, its officers,
            directors, employees, and agents from any claims, damages, losses, or expenses
            (including legal fees) arising from your violation of these Terms or your use of our
            services.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">11. Modifications to Terms</h2>
          <p className="mt-3">
            We reserve the right to modify these Terms at any time. We will notify you of material
            changes by posting the updated Terms on our website with a new &quot;Last updated&quot;
            date. Your continued use of our services after changes are posted constitutes acceptance
            of the revised Terms.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">12. Termination</h2>
          <p className="mt-3">
            We may terminate or suspend your access to our services at any time, without prior
            notice, for conduct that we believe violates these Terms or is harmful to other users,
            us, or third parties. Upon termination, your right to use our services ceases
            immediately.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">13. Governing Law</h2>
          <p className="mt-3">
            These Terms are governed by and construed in accordance with the laws of the Federal
            Republic of Nigeria. Any disputes arising from these Terms shall be subject to the
            exclusive jurisdiction of the courts of Lagos State, Nigeria.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">14. Severability</h2>
          <p className="mt-3">
            If any provision of these Terms is found to be unenforceable or invalid, that provision
            shall be limited or eliminated to the minimum extent necessary, and the remaining
            provisions shall remain in full force and effect.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground">15. Contact Us</h2>
          <p className="mt-3">
            If you have questions about these Terms of Service, please contact us at:
          </p>
          <ul className="mt-3 space-y-1">
            <li>
              Email:{' '}
              <a
                href="mailto:hello@surewaka.com"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              >
                hello@surewaka.com
              </a>
            </li>
            <li>
              Legal inquiries:{' '}
              <a
                href="mailto:legal@surewaka.com"
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
              >
                legal@surewaka.com
              </a>
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
