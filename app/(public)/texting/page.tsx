import Link from "next/link";
import { PolicyPage } from "@/components/public/public-shell";
import { SITE } from "@/lib/site";

export const metadata = { title: `Texting terms · ${SITE.productName}` };

export default function TextingTermsPage() {
  return (
    <PolicyPage title="Texting terms">
      <p>
        These terms cover text messages from the {SITE.textingProgram} program, run by {SITE.businessName}
        (&ldquo;we&rdquo;) for people with a {SITE.productName} account.
      </p>

      <h2>What the messages are</h2>
      <p>
        Messages about the videos you make with {SITE.productName}: replies to requests you send us, questions we need
        answered to make your video (for example which brand or format it is for), links to upload clips and to review
        previews, confirmation when you approve a video, and confirmation when a scheduled post is published. We do not
        send marketing or promotional messages through this program.
      </p>

      <h2>How you sign up</h2>
      <p>
        Texting is off until you turn it on. After signing in, open Settings, enter your mobile number, tick the box
        agreeing to receive texts from {SITE.textingProgram}, and enter the 6-digit code we send to that number. Signing
        up is optional and is not a condition of using {SITE.productName} or of any purchase.
      </p>

      <h2>How often</h2>
      <p>Message frequency varies. Most messages are replies to texts you send us or updates on videos you started.</p>

      <h2>Cost</h2>
      <p>Message and data rates may apply, according to your mobile plan.</p>

      <h2>Stopping and help</h2>
      <ul>
        <li>Reply <strong>STOP</strong> at any time to stop all texts. We will send one message confirming you have been unsubscribed, and no more after that.</li>
        <li>Reply <strong>START</strong> to sign up again.</li>
        <li>Reply <strong>HELP</strong> for help, or email <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.</li>
        <li>You can also remove your number in Settings.</li>
      </ul>

      <h2>Carriers</h2>
      <p>Mobile carriers are not liable for delayed or undelivered messages.</p>

      <h2>Privacy</h2>
      <p>
        We use your mobile number only to run this program. No mobile information is shared with third parties or
        affiliates for marketing or promotional purposes, and your texting sign-up and consent are never shared with
        third parties. See the <Link href="/privacy">privacy policy</Link> for the rest.
      </p>
    </PolicyPage>
  );
}
