import { PolicyPage } from "@/components/public/public-shell";
import { SITE } from "@/lib/site";

export const metadata = { title: `Privacy policy · ${SITE.productName}` };

export default function PrivacyPage() {
  return (
    <PolicyPage title="Privacy policy">
      <p>
        This policy explains what {SITE.businessName} (&ldquo;we&rdquo;) collects when you use {SITE.productName}, how
        we use it, and the choices you have.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name and email address, and how you sign in.</li>
        <li><strong>Your content:</strong> the clips, images, voice recordings, captions and notes you upload or write, and the videos made from them.</li>
        <li><strong>Brand details:</strong> what you tell us about each brand, such as its description, audience and voice.</li>
        <li><strong>Connected accounts:</strong> when you connect Instagram or Facebook, the access granted to post and read results for that account. Access keys are stored encrypted.</li>
        <li><strong>Keys you add:</strong> any service keys you add are stored encrypted and never shown again.</li>
        <li><strong>Mobile number:</strong> if you turn on texting, your mobile number and the messages you send and receive.</li>
        <li><strong>Usage:</strong> basic records of what happens in your account, such as posts scheduled and published, and the results Instagram and Facebook report for them.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To run the service for you: edit and render your videos, draft text, publish what you approve, show you results,
        answer your requests by text or in the app, keep your account secure, and fix problems.
      </p>

      <h2>Who we share it with</h2>
      <p>We do not sell your information. We share it only with services that run parts of {SITE.productName} for us, and only as needed to do that:</p>
      <ul>
        <li>hosting, database and file storage providers;</li>
        <li>the AI provider that processes your content to make edits and draft text;</li>
        <li>our texting provider, to send and receive texts if you turn texting on;</li>
        <li>Meta (Instagram and Facebook), to publish what you approve and read its results.</li>
      </ul>
      <p>We may also disclose information when the law requires it.</p>

      <h2>Mobile numbers and texting</h2>
      <p>
        No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.
        Text messaging sign-up data and consent will not be shared with any third parties. We use your number only to
        send the messages described in the texting terms.
      </p>

      <h2>Keeping and deleting it</h2>
      <p>
        We keep your information while your account is open. You can delete content in the app at any time. To close your
        account and delete its data, email <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>

      <h2>Separation between accounts</h2>
      <p>Each account&apos;s brands, content and connections are kept separate; one account cannot see another&apos;s.</p>

      <h2>Changes</h2>
      <p>If we change this policy we will update the date above, and tell you in the app if the change is significant.</p>

      <h2>Contact</h2>
      <p>Questions: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.</p>
    </PolicyPage>
  );
}
