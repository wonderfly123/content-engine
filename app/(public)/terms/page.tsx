import Link from "next/link";
import { PolicyPage } from "@/components/public/public-shell";
import { SITE } from "@/lib/site";

export const metadata = { title: `Terms of service · ${SITE.productName}` };

export default function TermsPage() {
  return (
    <PolicyPage title="Terms of service">
      <p>
        These terms are an agreement between you and {SITE.businessName} (&ldquo;we&rdquo;) for using {SITE.productName}.
        By creating an account you agree to them.
      </p>

      <h2>Your account</h2>
      <p>Keep your sign-in details safe. You are responsible for what happens in your account, including anything done by people you give access to.</p>

      <h2>Your content</h2>
      <p>
        You keep ownership of everything you upload. You give us permission to store, process and edit it, and to publish
        it where you tell us to, only to provide the service to you. You confirm you have the rights to what you upload,
        including permission from anyone who appears in your footage, and to any music you supply.
      </p>

      <h2>Review before posting</h2>
      <p>
        Edits, captions and other text are produced with the help of AI and can contain mistakes. Nothing is posted
        until you approve it, and you are responsible for what you approve.
      </p>

      <h2>Acceptable use</h2>
      <p>Don&apos;t use {SITE.productName} for anything unlawful, to post content you don&apos;t have rights to, to harass or deceive people, or to break the rules of the platforms you publish to.</p>

      <h2>Connected services</h2>
      <p>Publishing depends on Instagram, Facebook and other services we don&apos;t control. Their terms apply to your use of them, and we can&apos;t guarantee they will always be available.</p>

      <h2>Limits</h2>
      <p>Accounts have limits on storage and on the number of videos made each month. We will show you your usage in the app.</p>

      <h2>Texting</h2>
      <p>Text messages are covered by the <Link href="/texting">texting terms</Link>.</p>

      <h2>Ending your account</h2>
      <p>You can stop using the service at any time. We may suspend accounts that break these terms.</p>

      <h2>No warranty</h2>
      <p>The service is provided as it is. To the extent the law allows, we are not liable for indirect losses, or for content lost or not published because of a third-party service.</p>

      <h2>Changes</h2>
      <p>We may update these terms; we will change the date above and tell you in the app if the change is significant.</p>

      <h2>Contact</h2>
      <p>Questions: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.</p>
    </PolicyPage>
  );
}
