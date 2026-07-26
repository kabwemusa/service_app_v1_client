<?php

namespace Database\Seeders;

use App\Enums\LegalDocumentType;
use App\Models\LegalDocument;
use Illuminate\Database\Seeder;

/**
 * ============================================================================
 *  DRAFT LEGAL SCAFFOLD — NOT FINAL, NOT LEGAL ADVICE, NOT BINDING TEXT.
 * ============================================================================
 *  Every string below is PLACEHOLDER SCAFFOLD written to give a qualified
 *  Zambian lawyer real headings and structure to complete. It is deliberately
 *  marked "[DRAFT …]" throughout. Do NOT publish (set status=published, remove
 *  draft_mode) until counsel has reviewed and rewritten the wording.
 *
 *  Statutes are referenced BY NAME ONLY (verified list). No section numbers,
 *  no definitive legal guarantees, and no compliance claims are asserted here —
 *  those are for counsel to draft:
 *    • Data Protection Act No. 3 of 2021
 *    • Electronic Communications and Transactions Act No. 4 of 2021
 *    • Cyber Security and Cyber Crimes Act No. 2 of 2021
 *    • Constitution of Zambia — Article 17 (right to privacy)
 *
 *  See LEGAL_REVIEW.md for the section-by-section list counsel must complete.
 * ============================================================================
 */
class LegalDocumentSeeder extends Seeder
{
    /** Bump when the scaffold structure changes so re-consent can be exercised in dev. */
    private const VERSION = '0.1.0-draft';

    public function run(): void
    {
        $this->upsert(LegalDocumentType::TERMS_OF_SERVICE, 'Terms of Service',
            'The agreement between you and Sebenza Technologies Ltd for using the Sebenza marketplace.',
            $this->termsSections());

        $this->upsert(LegalDocumentType::PRIVACY_POLICY, 'Privacy Policy',
            'How Sebenza Technologies Ltd collects, uses, shares and protects your personal data.',
            $this->privacySections());

        $this->upsert(LegalDocumentType::USER_AGREEMENT, 'User Agreement',
            'The electronic agreement you accept to create and use a Sebenza account.',
            $this->userAgreementSections());
    }

    private function upsert(LegalDocumentType $type, string $title, string $summary, array $sections): void
    {
        LegalDocument::updateOrCreate(
            ['type' => $type->value, 'version' => self::VERSION],
            [
                'status'         => 'draft', // NEVER seed as published — publication is a legal sign-off
                'title'          => $title,
                'summary'        => $summary,
                'effective_date' => null,    // set by legal at publication
                'is_material'    => true,
                'content'        => [
                    'intro'    => '**DRAFT — pending legal review.** This is placeholder scaffold text, '
                        . 'not final or binding wording. It must be completed and approved by a qualified '
                        . 'Zambian lawyer before Sebenza launches. Statutes are named for orientation only.',
                    'sections' => $sections,
                ],
            ],
        );
    }

    /** Helper to keep section definitions terse and consistent. */
    private function s(string $id, string $title, string $body, int $level = 2): array
    {
        return ['id' => $id, 'title' => $title, 'level' => $level, 'body' => trim($body)];
    }

    // ── TERMS OF SERVICE ─────────────────────────────────────────────────────
    private function termsSections(): array
    {
        return [
            $this->s('who-we-are', 'Who we are', <<<MD
[DRAFT] Sebenza is operated by **Sebenza Technologies Ltd**, a company registered in Zambia. In these
Terms, "Sebenza", "we", "us" and "our" mean Sebenza Technologies Ltd.

*[FOR LEGAL: insert registered company number, registered office address, and contact details.]*
MD),
            $this->s('the-service', 'The service', <<<MD
[DRAFT] Sebenza is a **marketplace that connects customers with independent service providers**. We
provide the platform; we are not the provider of the underlying services and we are not a party to the
service contract between a customer and a provider.

*[FOR LEGAL: confirm the platform/intermediary characterisation and any consumer-protection wording.]*
MD),
            $this->s('accounts-eligibility', 'Accounts and eligibility', <<<MD
[DRAFT] To use Sebenza you create an account using your mobile phone number and verify it with a
one-time code. You must be old enough to enter a binding contract under Zambian law and must give
accurate information.

*[FOR LEGAL: confirm minimum age, capacity to contract, and one-account-per-person rules.]*
MD),
            $this->s('provider-obligations', 'Provider obligations and verification', <<<MD
[DRAFT] Providers must complete identity verification (which may include submitting a National
Registration Card and a selfie), keep their listings accurate, hold any licences their trade requires,
and perform work to a reasonable standard.

*[FOR LEGAL: set out the verification tiers, licensing responsibilities, and standard-of-care wording.]*
MD),
            $this->s('customer-obligations', 'Customer obligations', <<<MD
[DRAFT] Customers must provide accurate booking details, give safe and lawful access for the work,
and pay the agreed amount through the app.

*[FOR LEGAL: complete acceptable-use and payment-obligation wording.]*
MD),
            $this->s('bookings-pricing', 'Bookings and pricing', <<<MD
[DRAFT] Bookings are made in the app. Sebenza supports four pricing models — a fixed price for a defined
outcome, a price set by the provider after assessing the job, an hourly rate with an agreed cap, and a
quote with a deposit. The applicable model and the total are shown before you confirm.

*[FOR LEGAL: confirm the description of each pricing model and how the contract is formed.]*
MD),
            $this->s('payments-escrow', 'Payments and escrow', <<<MD
[DRAFT] Payments are made through a **licensed third-party payment provider**. Where escrow applies,
the customer's funds are **held by the payment provider and released to the provider on completion** of
the job. Sebenza does not itself hold customer funds.

**⚠ FOR LEGAL — REGULATORY:** confirm the correct description of the payment/escrow arrangement, the
licensed provider's regulatory status, and any Bank of Zambia / payment-systems wording. Do not state
regulatory compliance until confirmed.
MD),
            $this->s('commissions-fees', 'Commissions and fees', <<<MD
[DRAFT] Sebenza charges a commission and/or fees on transactions. The current rates are shown in the app.

*[FOR LEGAL: confirm fee-disclosure and change-of-fee wording.]*
MD),
            $this->s('cancellations-refunds', 'Cancellations and refunds', <<<MD
[DRAFT] Cancellation and refund outcomes depend on when a booking is cancelled and its state. The rules
in force are shown in the app at the time of booking.

*[FOR LEGAL: set the cancellation windows, refund entitlements, and dispute interaction.]*
MD),
            $this->s('ratings-content', 'Ratings, reviews and content', <<<MD
[DRAFT] Customers may rate and review completed jobs. You are responsible for content you submit; it must
be truthful and lawful. We may remove content that breaches these Terms.

*[FOR LEGAL: complete content licence, moderation, and defamation-risk wording.]*
MD),
            $this->s('prohibited-conduct', 'Prohibited conduct', <<<MD
[DRAFT] You must not use Sebenza for anything unlawful, attempt to defraud other users or the platform,
take payments off-platform to avoid fees, or interfere with the service. Misuse may also engage the
**Cyber Security and Cyber Crimes Act No. 2 of 2021**.

*[FOR LEGAL: complete the prohibited-conduct list and off-platform-circumvention wording.]*
MD),
            $this->s('safety', 'Safety', <<<MD
[DRAFT] Sebenza provides in-app safety features. In an emergency, contact the relevant emergency
services first. Safety features do not guarantee your safety.

*[FOR LEGAL: confirm safety disclaimers and any duty-of-care limits.]*
MD),
            $this->s('liability-disclaimers', 'Liability and disclaimers', <<<MD
[DRAFT] The service is provided on an "as is" basis. To the extent permitted by Zambian law, Sebenza is
not liable for the acts or omissions of providers or customers, and our liability is limited.

**⚠ FOR LEGAL:** draft the disclaimer and limitation-of-liability to the extent permitted by Zambian
law — including any non-excludable consumer rights.
MD),
            $this->s('dispute-resolution', 'Governing law and disputes', <<<MD
[DRAFT] These Terms are governed by the **laws of Zambia**. Disputes are subject to the jurisdiction of
the Zambian courts, subject to any in-app dispute process that applies first.

*[FOR LEGAL: confirm governing law, forum, and any arbitration/ADR step.]*
MD),
            $this->s('suspension-termination', 'Suspension and termination', <<<MD
[DRAFT] We may suspend or close an account that breaches these Terms or where required for safety, fraud
or legal reasons. You may close your account at any time.

*[FOR LEGAL: complete grounds, notice, and effect-of-termination wording.]*
MD),
            $this->s('changes', 'Changes to these Terms', <<<MD
[DRAFT] We may update these Terms. When we make a material change we will notify you and, where required,
ask you to review and accept the updated version before you continue.

*[FOR LEGAL: confirm the change-notification mechanism and acceptance requirement.]*
MD),
            $this->s('contact', 'Contact', <<<MD
[DRAFT] Questions about these Terms can be sent to Sebenza Technologies Ltd.

*[FOR LEGAL: insert the contact channel(s).]*
MD),
        ];
    }

    // ── PRIVACY POLICY ───────────────────────────────────────────────────────
    private function privacySections(): array
    {
        return [
            $this->s('controller', 'Who controls your data', <<<MD
[DRAFT] **Sebenza Technologies Ltd** is the **data controller** for the personal data described in this
policy, under the **Data Protection Act No. 3 of 2021**. You can reach our data protection contact using
the details below.

*[FOR LEGAL: insert the controller's registered details, the data protection contact (and DPO if one is
appointed), and confirm registration status with the Office of the Data Protection Commissioner.]*
MD),
            $this->s('what-we-collect', 'What data we collect', <<<MD
[DRAFT] Depending on how you use Sebenza we may collect:

- your **phone number** and **name**;
- your **National Registration Card (NRC)** details and a **selfie / biometric image** for identity
  verification;
- **mobile-money details** used for payment and payout;
- your **location** (a place, not a precise pin shown to others);
- **device and usage** information; and
- your **booking history**.

**⚠ SENSITIVE DATA:** your **NRC** and your **selfie/biometric image** are treated as **sensitive
personal data** under the Data Protection Act No. 3 of 2021 and receive additional protection.
*[FOR LEGAL: confirm the full sensitive-data classification and the lawful conditions relied on.]*
MD),
            $this->s('why-we-use', 'Why we use your data', <<<MD
[DRAFT] We use your data to verify identity, take and manage bookings, process payments, keep the
platform safe, provide support, and — only with your separate consent — send marketing and use
non-essential analytics.

*[FOR LEGAL: map each purpose to its data and confirm it against the collected fields.]*
MD),
            $this->s('legal-basis', 'Our legal basis', <<<MD
[DRAFT] We rely on your **consent** for the processing described here, and on other lawful bases where
they apply, as recognised by the **Data Protection Act No. 3 of 2021**. The core processing needed to
deliver the service (identity verification, booking, payment) is necessary to provide Sebenza to you;
marketing and non-essential analytics are **optional and off by default**.

*[FOR LEGAL: confirm the correct lawful basis for each purpose — consent, contract, legal obligation,
legitimate interest as advised — and the basis for processing sensitive data.]*
MD),
            $this->s('sharing', 'Who we share data with', <<<MD
[DRAFT] We share personal data with the parties that help us run Sebenza, including:

- the **licensed payment provider** (to process payments and payouts);
- **WhatsApp / Meta** (where you interact with Sebenza over WhatsApp);
- our **hosting provider**;
- **SMS and email** delivery providers; and
- Sebenza **administrators** who operate the platform.

We do not sell your personal data.
*[FOR LEGAL: name each third party, its role (processor/controller), and the safeguards in place.]*
MD),
            $this->s('cross-border', 'Cross-border transfer of your data', <<<MD
[DRAFT] Some of the providers above **process or store data outside Zambia** (for example on servers in
the European Union). This means your data may be transferred across borders.

**⚠ FOR LEGAL — HIGH PRIORITY:** cross-border transfer is regulated by the **Data Protection Act No. 3
of 2021**, and the transfer of **sensitive personal data** (your **NRC** and **selfie/biometric image**)
out of Zambia is **restricted** and needs specific safeguards and/or consent. Counsel must confirm the
lawful transfer mechanism, the safeguards, and exactly what consent is required BEFORE any sensitive
data leaves Zambia. Do not assert compliance until this is confirmed.
MD),
            $this->s('retention', 'How long we keep your data', <<<MD
[DRAFT] We keep personal data only for as long as needed for the purpose it was collected for and for a
defined period after, as required by the **Data Protection Act No. 3 of 2021** and other applicable law.

**⚠ FOR LEGAL:** set the specific retention period for each category (especially NRC/biometric and
payment data), and the trigger for deletion.
MD),
            $this->s('security', 'How we protect your data', <<<MD
[DRAFT] We use technical and organisational measures to protect your data, including access controls and
encryption in transit. No system is completely secure.

*[FOR LEGAL: confirm the security representations you are willing to make.]*
MD),
            $this->s('your-rights', 'Your rights', <<<MD
[DRAFT] Under the **Data Protection Act No. 3 of 2021** you have the right to:

- be **informed** about how your data is used;
- **access** your data;
- **rectify** inaccurate data;
- **erase** your data;
- **object** to processing;
- **restrict** processing;
- receive your data in a portable form (**portability**); and
- **withdraw consent** at any time.

You can exercise these rights in the app under **Profile → Privacy & consent**, or by contacting our data
protection contact. *[FOR LEGAL: confirm the rights, any limits, and the response timeframe.]*
MD),
            $this->s('withdraw-consent', 'Withdrawing consent', <<<MD
[DRAFT] You can withdraw consent at any time. Withdrawing consent for **optional** processing (marketing,
non-essential analytics) simply turns it off. Withdrawing consent for the **core** processing needed to
run the service means we can no longer provide Sebenza to you, so your account would move towards closure.

*[FOR LEGAL: confirm the effect of withdrawal and the account-closure interaction.]*
MD),
            $this->s('children', 'Children and vulnerable persons', <<<MD
[DRAFT] Sebenza is not intended for children. We take additional care with the data of vulnerable persons.

*[FOR LEGAL: set the age threshold and any special handling.]*
MD),
            $this->s('complaints', 'Complaints', <<<MD
[DRAFT] If you have a concern, contact our data protection contact first. You also have the right to
complain to the **Office of the Data Protection Commissioner** in Zambia.

*[FOR LEGAL: insert the Commissioner's current contact details and complaint procedure.]*
MD),
            $this->s('changes', 'Changes to this policy', <<<MD
[DRAFT] We may update this policy. Material changes will be notified and, where required, you will be
asked to review the updated version.

*[FOR LEGAL: confirm the change process.]*
MD),
            $this->s('effective-date', 'Effective date', <<<MD
[DRAFT] This policy takes effect on the effective date shown at the top once published.

*[FOR LEGAL: confirm at publication.]*
MD),
        ];
    }

    // ── USER AGREEMENT ───────────────────────────────────────────────────────
    private function userAgreementSections(): array
    {
        return [
            $this->s('what-you-agree', 'What you are agreeing to', <<<MD
[DRAFT] By tapping to accept, you confirm that you have read and agree to the **Terms of Service** and
this **User Agreement**, and that you consent to the **core processing** described in the **Privacy
Policy** that is necessary to provide Sebenza to you (identity verification, booking and payment).

*[FOR LEGAL: confirm the acceptance statement and the bundled/unbundled boundary.]*
MD),
            $this->s('optional-choices', 'Your optional choices', <<<MD
[DRAFT] Marketing messages and non-essential analytics are **optional**. They are **off unless you turn
them on**, and you can change them at any time under **Profile → Privacy & consent**. You can use Sebenza
without them.

*[FOR LEGAL: confirm the optional-processing description.]*
MD),
            $this->s('electronic-agreement', 'This is an electronic agreement', <<<MD
[DRAFT] You are entering this agreement **electronically**. Under the **Electronic Communications and
Transactions Act No. 4 of 2021**, agreeing electronically (by tapping to accept) has legal effect. We
keep a record of your acceptance, including the versions you accepted and when.

*[FOR LEGAL: confirm the electronic-contracting and record-keeping wording.]*
MD),
            $this->s('accept-decline', 'Accepting or declining', <<<MD
[DRAFT] You may **decline**. If you decline, you will not be able to use Sebenza, and we will not onboard
your account. You are welcome to return and accept at any time.

*[FOR LEGAL: confirm the consequence-of-declining wording.]*
MD),
            $this->s('versioning', 'Versions and updates', <<<MD
[DRAFT] Each document has a version and an effective date. If we make a material change, we will ask you
to review and accept the updated version before you continue. We keep the history of what you accepted.

*[FOR LEGAL: confirm the re-acceptance mechanism.]*
MD),
        ];
    }
}
