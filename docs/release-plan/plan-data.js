// The release plan's lists. index.html draws them; status.json overrides `status`.
// Statuses: todo, doing, done, blocked, waiting, skip. Dates are ISO days.
// An item's `id` is what a comment or a status hangs on, so never rename one.
window.PLAN = {
  updated: '2026-11-22',
  launch: '2027-02-16',
  range: ['2026-11-23', '2027-05-02'],

  phases: [
    { id: 'p1', name: 'Foundations', from: '2026-11-23', to: '2026-12-20', goal: 'Account, name, decisions. Nothing public yet.' },
    { id: 'p2', name: 'Build the assets', from: '2026-12-21', to: '2027-01-24', goal: 'Store page, screenshots, video, the /app page. First bundle on Play.' },
    { id: 'p3', name: 'Play check', from: '2027-01-25', to: '2027-02-15', goal: 'The Play build on your phone and a few friends\'. Sign-ins, first run, widget. The rest is slack.' },
    { id: 'p4', name: 'Launch week', from: '2027-02-16', to: '2027-02-22', goal: 'One post a day, each in a different place. Answer everything.' },
    { id: 'p5', name: 'Sustain', from: '2027-02-23', to: '2027-05-02', goal: 'Two clips a week, the Oscars hook, a review at day 30 and day 60.' },
  ],

  // kind: ride (a hook to use), avoid (do not launch into it), deadline, launch
  hooks: [
    { date: '2026-12-10', label: 'The Game Awards', kind: 'ride' },
    { date: '2026-12-17', to: '2027-01-04', label: 'Steam Winter Sale and the holidays', kind: 'avoid' },
    { date: '2026-12-18', label: 'Avengers: Doomsday in cinemas', kind: 'ride' },
    { date: '2027-01-10', label: 'Golden Globes', kind: 'ride' },
    { date: '2027-01-21', label: 'Oscar nominations', kind: 'ride' },
    { date: '2027-02-01', label: 'Play trader status deadline', kind: 'deadline' },
    { date: '2027-02-12', label: 'Tomb Raider, Narnia', kind: 'ride' },
    { date: '2027-02-14', label: 'Super Bowl', kind: 'avoid' },
    { date: '2027-02-16', label: 'Launch day', kind: 'launch' },
    { date: '2027-02-18', label: 'Persona 4 Revival', kind: 'ride' },
    { date: '2027-02-22', to: '2027-03-01', label: 'Steam Next Fest', kind: 'ride' },
    { date: '2027-02-23', label: 'Fable', kind: 'ride' },
    { date: '2027-03-14', label: 'The Oscars', kind: 'ride' },
    { date: '2027-03-18', to: '2027-03-25', label: 'Steam Spring Sale', kind: 'ride' },
    { date: '2027-04-30', label: 'The Legend of Zelda film', kind: 'ride' },
  ],

  launchWeek: [
    { id: 'lw-tue', day: 'Tue 16 Feb', what: 'Production live in the morning. Launch post on fandex.org. r/SideProject. Press mails, German and English.' },
    { id: 'lw-wed', day: 'Wed 17 Feb', what: 'r/Android, the long text post. Answer every comment the same day.' },
    { id: 'lw-thu', day: 'Thu 18 Feb', what: 'Show HN at about 15:00 our time (9am US East). First clip tied to Persona 4 Revival.' },
    { id: 'lw-fri', day: 'Fri 19 Feb', what: 'r/droidappshowcase and Lemmy. Ship the first fixes from the week\'s feedback.' },
    { id: 'lw-sat', day: 'Weekend', what: 'No posts. Read the numbers, answer reviews, write down what people asked for.' },
    { id: 'lw-mon', day: 'Mon 22 Feb', what: 'Directories. Clip for Fable and Steam Next Fest. Decide on Product Hunt.' },
  ],

  items: [
    // ---------------------------------------------------------------- admin
    { id: 'ad-duns', area: 'admin', group: 'Play account', title: 'Get the D-U-N-S number', note: 'Arrived and listed in D&B\'s public directory. Google accepted it on 22 Nov.', owner: 'Nils', due: '2026-12-15', status: 'done' },
    { id: 'ad-upgrade', area: 'admin', group: 'Play account', title: 'Convert the Play account to an organization', note: 'Done on 22 Nov: D-U-N-S accepted, the form sent, Gewerbeschein and ID uploaded by you. Google is checking and mails you the result, which can take a few days. After the approval, wait 72 hours before submitting anything.', owner: 'Nils', due: '2026-11-29', status: 'waiting' },
    { id: 'ad-trader', area: 'admin', group: 'Play account', title: 'Declare trader status in Play Console: trader', note: 'You decided on 22 Nov: trader. Hard deadline 1 Feb 2027. Do it right after Google approves the organization account, because an organization is asked different questions. A trader\'s address and phone show on the store page from 1 Mar 2027.', owner: 'Nils', due: '2026-12-20', status: 'todo' },
    { id: 'ad-testrule', area: 'admin', group: 'Play account', title: 'Re-read the 12 testers, 14 days rule after the upgrade', note: 'Re-read on 22 Nov. Google\'s pages only say the rule is for personal accounts. They do not say what happens to a converted one. Only Google\'s support can answer, so ask them once the conversion is through.', owner: 'Nils', due: '2026-12-22', status: 'todo' },
    { id: 'ad-key', area: 'admin', group: 'Play account', title: 'Make the upload key', note: 'Made on 22 Nov by a script. The password was never shown on screen. It is in android-package/fandex-app-upload-key-info.txt and in your gradle settings. Put it into your password manager.', owner: 'Claude', due: '2026-12-06', status: 'done' },
    { id: 'ad-entry', area: 'admin', group: 'Play account', title: 'Create the org.fandex.app entry and fill App content', note: 'Every answer for the App content forms is drafted in drafts/play-app-content.md, with the proof for each. Waits for the account conversion.', owner: 'Both', due: '2027-01-10', status: 'todo' },
    { id: 'ad-testtrack', area: 'admin', group: 'Play account', title: 'Upload the first bundle to internal testing', note: 'I build it, you upload it. Play then shows the signing certificate the sign-in work needs.', owner: 'Both', due: '2027-01-12', status: 'todo' },
    { id: 'ad-opentest', area: 'admin', group: 'Play account', title: 'Add a few friends to the test build', note: 'Play\'s internal testing takes up to 100 people by email address. No public beta, no recruiting.', owner: 'Nils', due: '2027-01-25', status: 'todo' },
    { id: 'ad-prod', area: 'admin', group: 'Play account', title: 'Submit for production review', note: 'A week early. A first review can take a week or more, and a first release can\'t be rolled out in stages.', owner: 'Nils', due: '2027-02-08', status: 'todo' },

    { id: 'ad-name', area: 'admin', group: 'Legal and name', title: 'The name: a live US trademark FANDEX exists', note: 'Searched on 22 Nov in TMview. Fandex Inc. (USA) holds the word mark FANDEX in classes 9, 41 and 42, registered 25 Aug 2026, for fantasy sports and prediction market software. An international filing based on it exists (WIPO 1944654, countries unknown). No German mark was found. An older US mark for card decks belongs to someone else. This needs a trademark lawyer\'s view before launch. Details in drafts/lookups.md.', owner: 'Nils', due: '2026-12-06', status: 'doing' },
    { id: 'ad-tm', area: 'admin', group: 'Legal and name', title: 'Decide on registering the word mark', note: 'German office: 290 euros for three classes, ten years. Classes 9 and 42, maybe 41.', owner: 'Nils', due: '2026-12-20', status: 'todo' },
    { id: 'ad-impressum', area: 'admin', group: 'Legal and name', title: 'Add the VAT ID (USt-IdNr) to the Impressum', note: 'The line is drafted in drafts/legal-texts.md, section 1, in both languages, with a placeholder for the number. The law asks for the VAT ID or the W-IdNr, one is enough. Waits for your OK.', owner: 'Both', due: '2026-12-06', status: 'doing' },
    { id: 'ad-privacy', area: 'admin', group: 'Legal and name', title: 'Update the privacy policy for the app', note: 'Drafted in drafts/legal-texts.md: a full new \'Usage statistics\' section for the counters, plus every spot that is out of date (the \'hobby project\' wording, the follows, Steam, the provider list). Both languages. Waits for your OK.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'ad-notices', area: 'admin', group: 'Legal and name', title: 'Put the provider notices where their terms want them', note: 'The required wording per provider is in drafts/legal-texts.md, section 5, with its source. TMDB\'s logo is required and shown nowhere today. Trakt\'s and four other providers\' terms could not be opened and are marked \'not verified\'. Where the notices go in the app is one of the five mockups.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'ad-delurl', area: 'admin', group: 'Legal and name', title: 'A public web page for deleting an account', note: 'Live at fandex.org/delete-account since 22 Nov, hidden from search until launch. It says how to delete, what goes and what is kept.', owner: 'Claude', due: '2027-01-10', status: 'done' },

    { id: 'ad-reddit', area: 'admin', group: 'Accounts and money', title: 'Warm up the Reddit account that will post', note: 'Start commenting in the target subs now. A fresh account with one link gets removed.', owner: 'Nils', due: '2026-12-01', status: 'todo' },
    { id: 'ad-handles', area: 'admin', group: 'Accounts and money', title: 'Reserve the name where we will post', note: 'Checked on 22 Nov: @fandex is taken on YouTube, TikTok and Instagram. fandex.bsky.social looks free. fandexapp looks free on YouTube, TikTok, Instagram and Bluesky. Reddit could not be checked. Creating the accounts is yours.', owner: 'Nils', due: '2026-12-06', status: 'todo' },
    { id: 'ad-budget', area: 'admin', group: 'Accounts and money', title: 'Set the budget', note: 'Needed: nothing. Sensible: Workers Paid and the trademark. Skip paid directory slots and ads.', owner: 'Nils', due: '2026-12-06', status: 'todo' },
    { id: 'ad-mail', area: 'admin', group: 'Accounts and money', title: 'A public contact address, hello@fandex.org', note: 'Checked on 22 Nov: hello@fandex.org exists since 15 July 2026 and forwards to your Gmail.', owner: 'Both', due: '2026-12-13', status: 'done' },
    { id: 'ad-phone', area: 'admin', group: 'Accounts and money', title: 'A phone number you are fine with being public', note: 'Needed now that you chose trader: Google Play shows a trader\'s phone number and address on the store page from 1 March 2027.', owner: 'Nils', due: '2026-12-20', status: 'todo' },
    { id: 'ad-workers', area: 'admin', group: 'Accounts and money', title: 'Move the API to Workers Paid before launch', note: 'Your call, 22 Nov: no extra cost. The launch runs on the free plan. The runbook is rewritten for it: 100,000 requests a day is the first limit a busy launch day reaches.', owner: 'Nils', due: '2027-02-01', status: 'skip' },

    { id: 'ad-testers', area: 'admin', group: 'People', title: 'Testers, only if Google asks for them', note: 'An organization account is not asked for any. If the account stays personal, Google wants 12 people for 14 days, and the Bubblewrap testers cover that. No recruiting either way (your call, 22 Nov).', owner: 'Nils', due: '2026-12-22', status: 'waiting' },
    { id: 'ad-reviews', area: 'admin', group: 'People', title: 'Agree who answers reviews and mail', note: 'Every Play review answered within a day during launch month. I can draft, you send.', owner: 'Both', due: '2027-02-08', status: 'todo' },
    { id: 'ad-rule', area: 'admin', group: 'People', title: 'Decide what replaces "push to prod freely" after launch', note: 'That standing rule ends at launch. Likely: the test track first, production a day later.', owner: 'Nils', due: '2027-02-08', status: 'todo' },

    // -------------------------------------------------------------- product
    { id: 'pr-firstrun', area: 'product', group: 'Before the Play check', title: 'Run the first-run flow on a phone with a brand-new account', note: 'Never done on a real phone. It is the first thing every new user sees.', owner: 'Nils', due: '2026-12-13', status: 'todo' },
    { id: 'pr-aab', area: 'product', group: 'Before the Play check', title: 'Build the signed release bundle', note: 'Built on 22 Nov: version 0.3.64, all four phone types, 80 MB, signed with the upload key (checked against its fingerprint). The file is android-package/fandex-0.3.64-play.aab. It is uploaded once the Play entry for org.fandex.app exists.', owner: 'Claude', due: '2027-01-11', status: 'done' },
    { id: 'pr-links', area: 'product', group: 'Before the Play check', title: 'App Links, the https Trakt redirect, Google sign-in on Android', note: 'All need Play\'s signing certificate, so they follow the first upload.', owner: 'Claude', due: '2027-01-20', status: 'todo' },
    { id: 'pr-feedback', area: 'product', group: 'Before the Play check', title: 'A "Send feedback" row in the app', note: 'Opens a mail to hello@fandex.org with the version filled in.', owner: 'Claude', due: '2027-01-20', status: 'todo' },
    { id: 'pr-vitals', area: 'product', group: 'Before the Play check', title: 'Watch crashes in Play\'s Android vitals', note: 'Built into Play Console. No extra SDK, nothing for the privacy policy.', owner: 'Both', due: '2027-01-25', status: 'todo' },

    { id: 'pr-crosswhy', area: 'product', group: 'Before launch day', title: 'The Why sheet names the media behind a score', note: '"Learned from 30 shows, 9 films, 2 games." It puts story one on screen. Screenshot 1 and a clip need it. Needs your yes on the wording first.', owner: 'Both', due: '2027-01-17', status: 'todo' },
    { id: 'pr-secaudit', area: 'product', group: 'Before launch day', title: 'Security audit of the whole Fandex setup', note: 'Run on 22 Nov, four parts on Claude Fable 5.2. No way to take over an account from outside was found. About 40 findings, most about the free plan\'s daily limits. 15 fixed and live, 3 half fixed, 11 open on my side, 8 yours. Details stay on your disk in private/security-audit-2026-11-22.md, because this repository is public. A short second pass follows the sign-in changes that need Google Play\'s certificate.', owner: 'Claude', due: '2027-01-31', status: 'doing' },
    { id: 'pr-perfaudit', area: 'product', group: 'Before launch day', title: 'Performance and hardening audit', note: 'Started 22 Nov. The report goes to drafts/performance-audit.md: what a launch day costs on the free plan, which limit breaks first, launch values for the caps, how to roll back the website.', owner: 'Claude', due: '2027-01-31', status: 'doing' },
    { id: 'pr-steam', area: 'product', group: 'Before launch day', title: 'New users can connect Steam', note: 'Built on 22 Nov and live on the server and the website. In the Android app from the next build. Needs one real try with your Steam account: Settings, Connected accounts, Steam, Connect.', owner: 'Claude', due: '2026-12-20', status: 'doing' },
    { id: 'pr-importtest', area: 'product', group: 'Before the Play check', title: 'Test importing a list file on your phone', note: 'A note from 15 October says choosing a file needs a newer app version. Nothing says it was tried since. The store text promises list import.', owner: 'Nils', due: '2026-12-20', status: 'todo' },
    { id: 'pr-review', area: 'product', group: 'Before launch day', title: 'Ask for a Play rating at a good moment', note: 'Play\'s own review sheet, after a tenth rating or so. No "do you like it?" question first: Play forbids it.', owner: 'Claude', due: '2027-02-01', status: 'todo' },
    { id: 'pr-share', area: 'product', group: 'Before launch day', title: 'Share a title from the app', note: 'Found on 22 Nov: already built. The title page has had a share button beside Back since the item page was ported.', owner: 'Claude', due: '2027-02-01', status: 'done' },
    { id: 'pr-load', area: 'product', group: 'Before launch day', title: 'A load rehearsal against the API', note: 'Replay a busy launch hour and see which limit breaks first.', owner: 'Claude', due: '2027-02-01', status: 'todo' },
    { id: 'pr-getapp', area: 'product', group: 'Before launch day', title: 'A "Get the app" link on fandex.org', note: 'Built 22 Nov, hidden until the store address is set in one constant. How it should look on the home page is one of the five mockups.', owner: 'Claude', due: '2027-02-08', status: 'doing' },
    { id: 'pr-ios', area: 'product', group: 'Before launch day', title: 'A straight answer for iPhone users', note: 'On fandex.org/app since 22 Nov: no iPhone app yet, the website works in Safari and can go on the home screen, reminders are Android only.', owner: 'Claude', due: '2027-02-08', status: 'done' },
    { id: 'pr-runbook', area: 'product', group: 'Before launch day', title: 'A launch-day runbook', note: 'Draft in drafts/launch-runbook.md, checked claim by claim on 22 Nov and rewritten for the free plan. Still to try: the emergency switches on the live server.', owner: 'Claude', due: '2027-02-08', status: 'doing' },
    { id: 'pr-bgg', area: 'product', group: 'Before launch day', title: 'Board games, if BoardGameGeek approves the token', note: 'Applied 17 Oct, still pending. Not a blocker: launch without them.', owner: 'Nils', due: '', status: 'waiting' },

    // ------------------------------------------------------------ telemetry
    { id: 'pr-track', area: 'telemetry', group: 'To build', title: 'Agree the list of signals', note: 'Agreed on 22 Nov: the sixteen signals as listed.', owner: 'Nils', due: '2026-12-13', status: 'done' },
    { id: 'tm-switch', area: 'telemetry', group: 'To build', title: 'Decide: a Settings switch, or ask on first start', note: 'Agreed on 22 Nov: a switch in Settings, on by default.', owner: 'Nils', due: '2026-12-13', status: 'done' },
    { id: 'tm-server', area: 'telemetry', group: 'To build', title: 'Server counters: activity, retention, media mix', note: 'Built 22 Nov and live, switched off. It counts totals per day: active accounts, returning accounts per signup week, signups, requests per kind, failures. No user id anywhere. Switched on together with the privacy text.', owner: 'Claude', due: '2027-01-10', status: 'done' },
    { id: 'tm-app', area: 'telemetry', group: 'To build', title: 'App totals, sent once a session', note: 'Built 22 Nov, switched off in the app\'s code. One batch when the app goes to the background, at most 20 a day, without the account\'s token. A Settings switch, on by default. Not built: \'reminder arrived\', which an app cannot see while it is closed.', owner: 'Claude', due: '2027-01-17', status: 'done' },
    { id: 'tm-admin', area: 'telemetry', group: 'To build', title: 'Expand the telemetry page the admin area already has', note: 'A new Usage page in the admin area, beside Traffic: the three messages, do people stay, what people use, the server. It shows \'no data yet\' until counting is switched on.', owner: 'Claude', due: '2027-01-24', status: 'done' },
    { id: 'tm-read', area: 'telemetry', group: 'To build', title: 'Read the first week of numbers together', note: 'What surprised us, what to change, what to stop counting.', owner: 'Both', due: '2027-02-23', status: 'todo' },

    // --------------------------------------------------------------- assets
    { id: 'as-title', area: 'assets', group: 'Store listing', title: 'App title', note: '30 characters. Options in drafts/store-listing.md, checked against the code on 22 Nov. Pick one per language.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'as-short', area: 'assets', group: 'Store listing', title: 'Short description', note: '80 characters. Options in drafts/store-listing.md. Pick one per language.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'as-full', area: 'assets', group: 'Store listing', title: 'Full description, English and German', note: 'Drafts in English and German in drafts/store-listing.md, checked claim by claim on 22 Nov. Two wrong claims were fixed: the contact route and what the score is built from.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'as-icon', area: 'assets', group: 'Store listing', title: 'Icon, 512 x 512', note: 'Checked on 22 Nov: 512 x 512, PNG with transparency, 12 KB. It meets Google Play\'s rules.', owner: 'Claude', due: '2026-12-20', status: 'done' },
    { id: 'as-art', area: 'assets', group: 'Store listing', title: 'A set of covers we are allowed to show', note: 'Public-domain films and books, plus games whose makers say yes. Play\'s copyright rule names cover art.', owner: 'Both', due: '2027-01-03', status: 'todo' },
    { id: 'as-demo', area: 'assets', group: 'Store listing', title: 'A demo account with a tidy library', note: 'Signed in, so the score, Up next and Insights show, filled with the cleared titles.', owner: 'Claude', due: '2027-01-10', status: 'todo' },
    { id: 'as-refs', area: 'assets', group: 'Store listing', title: 'Collect the competitors\' store pages as references', note: '48 screenshots of six competitors\' Google Play pages are in the refs folder, with notes.', owner: 'Claude', due: '2027-01-05', status: 'done' },
    { id: 'as-design', area: 'assets', group: 'Store listing', title: 'Design the store images and banners in a Claude design session', note: 'The canvas is set up (22 Nov): eight store images in style C, three feature graphics, and six boards with the competitors\' store pages. Four store images are placeholders until signed-in captures exist. The final calls are yours, on the canvas.', owner: 'Both', due: '2027-01-12', status: 'doing' },
    { id: 'as-shots', area: 'assets', group: 'Store listing', title: 'Eight phone screenshots, 1080 x 1920', note: 'One short line over each screen. The storyboard is above.', owner: 'Both', due: '2027-01-17', status: 'todo' },
    { id: 'as-feature', area: 'assets', group: 'Store listing', title: 'Feature graphic, 1024 x 500', note: 'No transparency, no badge, no device frame. The logo, "Everything you\'re waiting for, on one calendar." (your pick, 22 Nov), a strip of the calendar.', owner: 'Both', due: '2027-01-17', status: 'todo' },
    { id: 'as-video', area: 'assets', group: 'Store listing', title: 'Store video, 30 seconds', note: 'A YouTube link, landscape, monetization off. The first 30 seconds autoplay, so calendar and score go first.', owner: 'Both', due: '2027-01-24', status: 'todo' },

    { id: 'as-landing', area: 'assets', group: 'Website', title: 'The fandex.org/app page', note: 'Live at fandex.org/app since 22 Nov, hidden until launch. The Play button appears once the store address is set. Three clip slots are empty.', owner: 'Claude', due: '2027-01-24', status: 'done' },
    { id: 'as-og', area: 'assets', group: 'Website', title: 'Pictures for pasted links', note: 'Done 22 Nov for the home page and a default for every other page. A picture per title is not built: it would add about 4,700 files to every build.', owner: 'Claude', due: '2027-01-24', status: 'done' },
    { id: 'as-blog', area: 'assets', group: 'Website', title: 'Launch post: why I built Fandex', note: 'Draft in drafts/blog-post.md, about 680 words. Five places marked [Nils: ...] need your own story.', owner: 'Both', due: '2027-02-08', status: 'doing' },
    { id: 'as-score', area: 'assets', group: 'Website', title: 'The "How the score works" page', note: 'Live at fandex.org/score. The proof link for every claim about the score.', owner: 'Claude', due: '2026-11-22', status: 'done' },
    { id: 'as-changelog', area: 'assets', group: 'Website', title: 'A public "What\'s new" page', note: 'Live at fandex.org/whats-new since 22 Nov, hidden until launch. Eight versions, in plain words.', owner: 'Claude', due: '2027-02-08', status: 'done' },

    { id: 'as-clips', area: 'assets', group: 'Video and images', title: 'Six short vertical clips', note: '15 to 25 seconds, two per story: taste that travels, one calendar, a score you can read.', owner: 'Both', due: '2027-02-08', status: 'todo' },
    { id: 'as-gifs', area: 'assets', group: 'Video and images', title: 'Three GIFs for posts', note: 'A calendar swipe, a rating with the Why sheet, the widget tick.', owner: 'Claude', due: '2027-02-08', status: 'todo' },
    { id: 'as-stills', area: 'assets', group: 'Video and images', title: 'Four stills for posts', note: '1600 x 900, the real app, one line each. They double as ad images later.', owner: 'Claude', due: '2027-02-08', status: 'todo' },

    { id: 'as-kit', area: 'assets', group: 'Press kit', title: 'Press kit page at fandex.org/press', note: 'Live at fandex.org/press since 22 Nov, hidden until launch: facts, icon and logo, contact. Screenshots show up once files are in public/press/screenshots.', owner: 'Claude', due: '2027-02-08', status: 'doing' },
    { id: 'as-facts', area: 'assets', group: 'Press kit', title: 'Facts sheet', note: 'Draft in drafts/facts-sheet.md, checked on 22 Nov. A few placeholders are yours to fill.', owner: 'Both', due: '2027-02-08', status: 'doing' },
    { id: 'as-pitch', area: 'assets', group: 'Press kit', title: 'Press mail, German and English', note: 'Drafts in drafts/press-mails.md, German and English. They mention your day job and offer a test login. Cut either if you do not want it.', owner: 'Both', due: '2027-02-08', status: 'doing' },

    // ------------------------------------------------------------- channels
    { id: 'ch-niche', area: 'channels', group: 'Now', title: 'Read the sidebars of the niche subs by hand', rule: 'r/trakt, r/letterboxd, r/television, r/patientgamers, r/52book. Tried again on 22 Nov: Reddit refuses my browser tools too, so this stays with you. The post drafts mark every choice that depends on a rule.', format: 'Comment first. Post only where the rules allow it.', owner: 'Nils', due: '2026-12-13', status: 'todo' },
    { id: 'ch-altto', area: 'channels', group: 'Before launch', title: 'AlternativeTo', rule: 'Free listing. Paid only speeds up the review.', format: 'Listed as an alternative to TV Time, Trakt, Letterboxd, Goodreads and Backloggd.', owner: 'Claude', due: '2027-01-25', status: 'todo' },
    { id: 'ch-clips', area: 'channels', group: 'Before launch', title: 'TikTok, Reels and Shorts', rule: 'A median TikTok post gets about 490 views. Volume and patience, not one hit.', format: 'Two clips a week, the same clip on all three. Problem in one line of text over a screen recording.', owner: 'Both', due: '2027-01-25', status: 'todo' },
    { id: 'ch-side', area: 'channels', group: 'Launch week', title: 'r/SideProject', rule: 'Launch posts welcome. Title: "Name - short description".', format: '"I made this" with a 30 second recording.', owner: 'Nils', due: '2027-02-16', status: 'todo' },
    { id: 'ch-press-de', area: 'channels', group: 'Launch week', title: 'German press: mobiFlip, Caschys Blog, SmartDroid', rule: 'Each has a tip form or address. mobiFlip has run reader app tips.', format: 'Five lines in German, the press kit link.', owner: 'Nils', due: '2027-02-16', status: 'todo' },
    { id: 'ch-press-en', area: 'channels', group: 'Launch week', title: 'Android Authority, 9to5Google', rule: 'Tip addresses exist. One developer mailed 30 sites and got 2 replies, so expect little.', format: 'Five lines in English, the press kit link.', owner: 'Nils', due: '2027-02-16', status: 'todo' },
    { id: 'ch-android', area: 'channels', group: 'Launch week', title: 'r/Android', rule: 'A detailed text post from an account at least 3 months old with history there. Mods filter every self post.', format: 'Long text post. Answer every comment.', owner: 'Nils', due: '2027-02-17', status: 'todo' },
    { id: 'ch-hn', area: 'channels', group: 'Launch week', title: 'Show HN', rule: 'Must be usable without signing up, which fandex.org is. Never ask for votes. 2.3% of Show HNs reach the front page.', format: 'A link to fandex.org and a first comment with the story.', owner: 'Nils', due: '2027-02-18', status: 'todo' },
    { id: 'ch-showcase', area: 'channels', group: 'Launch week', title: 'r/droidappshowcase', rule: 'One app post a week. Where r/androidapps now sends launch posts.', format: 'Showcase post with the stills.', owner: 'Nils', due: '2027-02-19', status: 'todo' },
    { id: 'ch-lemmy', area: 'channels', group: 'Launch week', title: 'Lemmy: !android@lemdro.id', rule: 'Active members may post their app. No links to your own site or blog.', format: 'Store link only.', owner: 'Nils', due: '2027-02-19', status: 'todo' },
    { id: 'ch-dirs', area: 'channels', group: 'After', title: 'Free directories', rule: 'SaaSHub, Peerlist, AppBrain, makers.page. Free ones only.', format: 'One afternoon, same text.', owner: 'Claude', due: '2027-02-22', status: 'todo' },
    { id: 'ch-indie', area: 'channels', group: 'After', title: 'r/indiehackers', rule: 'One product, Self Promotion flair, framed as asking for feedback.', format: 'A "what the launch taught me" post with real numbers.', owner: 'Nils', due: '2027-02-25', status: 'todo' },
    { id: 'ch-ph', area: 'channels', group: 'After', title: 'Product Hunt (optional)', rule: 'The median indie launch gets 3 upvotes. Starts at 12:01am Pacific.', format: 'Only if the week left energy. A weekday brings more traffic.', owner: 'Nils', due: '2027-02-25', status: 'todo' },
    { id: 'ch-oscars', area: 'channels', group: 'After', title: 'The Oscars week', rule: 'Sunday 14 March. A ready-made reason to post again.', format: 'A clip and a post: every nominee in one list, with your score for each.', owner: 'Both', due: '2027-03-08', status: 'todo' },
  ],
};
