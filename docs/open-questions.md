# Open questions

Things still to figure out. Add new ones at the top of their section; when one is settled, write the answer under it and move it to "Settled" at the bottom.

## Product

### Storage: keep everything, or only until it posts?
Raised 2026-11-14.

Idea: by default, storage is temporary. Raw clips are kept only while a video is being made, and deleted once it is posted. Keeping everything (raw clips and finished videos, browsable in Assets) would be an upgrade, with an "Upgrade to store assets" button.

To decide:
- Is Assets hidden without the upgrade, or visible but read-only?
- Are finished videos kept on the free plan, while only raw clips are deleted?
- How long after posting are raw clips deleted: immediately, or after a grace period (for example 7 days, in case a re-edit is wanted)?
- What happens to a video that is never posted? Delete it after N days of no activity?
- Does anyone get a warning before deletion?
- Price and limits of the upgrade. The earlier plan suggested an included allowance plus paid add-on packs.

Today: every workspace has a 5 GB allowance and nothing is deleted automatically.

### Getting footage in from a drive or folder
Raised 2026-11-14. Options, from smallest to largest:
- **Pick a whole folder in the browser:** upload every video in a chosen folder or external drive. Works in modern browsers with no install, but only when the user picks it each time.
- **Connect Google Drive or Dropbox:** sign in once, then pick clips from there, or watch a folder. The database already has fields reserved for Drive and Dropbox assets.
- **A small desktop helper** that watches a local folder or external drive and uploads new clips automatically, like Jordan's local workflow today. The most convenient, but it's a separate app to build and install.

To decide: which ones, and in what order. The app would show a short "how to connect" guide for each.

### Music and audio
Raised 2026-11-14. Options:
- **Upload your own tracks:** a music library per workspace, for tracks the user has the rights to.
- **Epidemic Sound:** a normal subscription covers the subscriber's own channels, not a platform serving other people. Either Nekter signs Epidemic's partner API deal, or each user links their own Epidemic account. Confirm with Epidemic before selling it.
- **YouTube Audio Library:** free tracks from YouTube Studio that are licensed for use in videos. Users download them and upload them here.
- **No music in the file:** the user adds a sound in the Instagram app instead. Instagram restricts business accounts to its own licensed sound collection, and can mute commercial music in uploaded videos.

Not doing: downloading audio from YouTube links. It breaks YouTube's terms, and most of that music is copyrighted.

### Who pays for AI?
The cloud editor runs on the top Claude models. Options:
- Each workspace brings its own Anthropic key (built: Settings > Connections).
- The platform pays and caps videos per workspace.

To be decided once real per-video costs are measured on Jordan's test jobs.

### Video cap per workspace
The placeholder is 30 videos a month, and AI change requests per video are capped. Set real numbers once costs are measured.

## Texting

### Which Twilio registration route?
There is no legal entity, so it's probably Sole Proprietor 10DLC (one number, low volume), with toll-free verification as the fallback. Confirm the requirements in the Twilio console.

### Someone in more than one workspace
Texts go to their oldest workspace. Is that fine, or should a text let them pick?

### Disabled accounts can still text
Account status lives in Supabase and the webhook can't see it. Decide whether texting should check it.

## Setup still to do

- support@nekter.io can't receive mail. Set up forwarding, then add its MX records to nekter.io's DNS in Vercel.
- Meta app: add `https://app.nekter.io/api/oauth/meta/callback` to Valid OAuth Redirect URIs, then switch the app's Meta redirect setting.
- Have the policy pages (privacy, terms, texting terms) reviewed; they are drafts.
- A demo video for the landing page, to replace the mock preview.

## CSM Dashboard (separate product)

- Its Supabase project (address starting `xwuletbupaxgvfuqbxjq`) no longer resolves; restore it before the demo login can work.
- No real email sender: set one once it has its own domain.
- The Slack app's redirect still points at nekter.io.

## Settled

- **Name and domains:** the product is Nekter. nekter.io is the website and app.nekter.io the app (2026-11-14).
- **Cloud editor:** headless Claude Code driven by skills and subagents, on the top models, with real costs recorded per job (2026-11-14).
- **Starting a video:** by text ("new reel" / "new story") or by the dashboard buttons. Both start the same conversation (2026-11-14).
