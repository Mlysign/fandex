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
    { id: 'ad-upgrade', area: 'admin', group: 'Play account', title: 'Convert the Play account to an organization', note: 'Started 22 Nov: D-U-N-S accepted, the organisation payments profile is linked, the form is sent. Google now asks for two things only you can give: the Gewerbeschein file and your ID. After Google approves, wait 72 hours before submitting anything. One way only.', owner: 'Nils', due: '2026-11-29', status: 'doing' },
    { id: 'ad-trader', area: 'admin', group: 'Play account', title: 'Declare trader status in Play Console: trader', note: 'You decided on 22 Nov: trader. Hard deadline 1 Feb 2027. Same sitting as the upgrade. A trader\'s address and phone show on the store page from 1 Mar 2027.', owner: 'Nils', due: '2026-12-20', status: 'todo' },
    { id: 'ad-testrule', area: 'admin', group: 'Play account', title: 'Re-read the 12 testers, 14 days rule after the upgrade', note: 'Re-read on 22 Nov. Google\'s pages only say the rule is for personal accounts. They do not say what happens to a converted one. Only Google\'s support can answer, so ask them once the conversion is through.', owner: 'Nils', due: '2026-12-22', status: 'todo' },
    { id: 'ad-key', area: 'admin', group: 'Play account', title: 'Make the upload key', note: 'Made on 22 Nov by a script. The password was never shown on screen. It is in android-package/fandex-app-upload-key-info.txt and in your gradle settings. Put it into your password manager.', owner: 'Claude', due: '2026-12-06', status: 'done' },
    { id: 'ad-entry', area: 'admin', group: 'Play account', title: 'Create the org.fandex.app entry and fill App content', note: 'Every answer for the App content forms is drafted in drafts/play-app-content.md, with the proof for each. Waits for the account conversion.', owner: 'Both', due: '2027-01-10', status: 'todo' },
    { id: 'ad-testtrack', area: 'admin', group: 'Play account', title: 'Upload the first bundle to internal testing', note: 'I build it, you upload it. Play then shows the signing certificate the sign-in work needs.', owner: 'Both', due: '2027-01-12', status: 'todo' },
    { id: 'ad-opentest', area: 'admin', group: 'Play account', title: 'Add a few friends to the test build', note: 'Play\'s internal testing takes up to 100 people by email address. No public beta, no recruiting.', owner: 'Nils', due: '2027-01-25', status: 'todo' },
    { id: 'ad-prod', area: 'admin', group: 'Play account', title: 'Submit for production review', note: 'A week early. A first review can take a week or more, and a first release can\'t be rolled out in stages.', owner: 'Nils', due: '2027-02-08', status: 'todo' },

    { id: 'ad-name', area: 'admin', group: 'Legal and name', title: 'The name: a live US trademark FANDEX exists', note: 'Searched on 22 Nov in TMview. Fandex Inc. (USA) holds the word mark FANDEX in classes 9, 41 and 42, registered 25 Aug 2026, for fantasy sports and prediction market software. An international filing based on it exists (WIPO 1944654, countries unknown). No German mark was found. An older US mark for card decks belongs to someone else. This needs a trademark lawyer\'s view before launch. Details in drafts/lookups.md.', owner: 'Nils', due: '2026-12-06', status: 'doing' },
    { id: 'ad-tm', area: 'admin', group: 'Legal and name', title: 'Decide on registering the word mark', note: 'German office: 290 euros for three classes, ten years. Classes 9 and 42, maybe 41.', owner: 'Nils', due: '2026-12-20', status: 'todo' },
    { id: 'ad-impressum', area: 'admin', group: 'Legal and name', title: 'Add the VAT ID (USt-IdNr) to the Impressum', note: 'Checked on 22 Nov: it is missing. The law requires it once the number is issued. I draft the line, you approve it, because it is legal text.', owner: 'Both', due: '2026-12-06', status: 'doing' },
    { id: 'ad-privacy', area: 'admin', group: 'Legal and name', title: 'Update the privacy policy for the app', note: 'The usage counters, and the countries where Steam data is stored (Steam\'s terms ask for that). Text before code, both languages.', owner: 'Both', due: '2027-01-10', status: 'todo' },
    { id: 'ad-notices', area: 'admin', group: 'Legal and name', title: 'Put the provider notices where their terms want them', note: 'Checked on 22 Nov: neither notice is in the app yet. Trakt\'s line goes in About and in the store description. TMDB\'s logo and line in the app.', owner: 'Claude', due: '2027-01-10', status: 'todo' },
    { id: 'ad-delurl', area: 'admin', group: 'Legal and name', title: 'A public web page for deleting an account', note: 'Play wants a link that works without the app installed.', owner: 'Claude', due: '2027-01-10', status: 'todo' },

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
    { id: 'pr-aab', area: 'product', group: 'Before the Play check', title: 'Build the signed release bundle', note: 'Waits for the upload key.', owner: 'Claude', due: '2027-01-11', status: 'blocked' },
    { id: 'pr-links', area: 'product', group: 'Before the Play check', title: 'App Links, the https Trakt redirect, Google sign-in on Android', note: 'All need Play\'s signing certificate, so they follow the first upload.', owner: 'Claude', due: '2027-01-20', status: 'todo' },
    { id: 'pr-feedback', area: 'product', group: 'Before the Play check', title: 'A "Send feedback" row in the app', note: 'Opens a mail to hello@fandex.org with the version filled in.', owner: 'Claude', due: '2027-01-20', status: 'todo' },
    { id: 'pr-vitals', area: 'product', group: 'Before the Play check', title: 'Watch crashes in Play\'s Android vitals', note: 'Built into Play Console. No extra SDK, nothing for the privacy policy.', owner: 'Both', due: '2027-01-25', status: 'todo' },

    { id: 'pr-crosswhy', area: 'product', group: 'Before launch day', title: 'The Why sheet names the media behind a score', note: '"Learned from 30 shows, 9 films, 2 games." It puts story one on screen. Screenshot 1 and a clip need it. Needs your yes on the wording first.', owner: 'Both', due: '2027-01-17', status: 'todo' },
    { id: 'pr-secaudit', area: 'product', group: 'Before launch day', title: 'Security audit of the whole Fandex setup', note: 'Your request, 22 Nov. Done with Claude Fable 5.2: the server, the database, sign-in, the website, the app and the Cloudflare settings. Runs after the telemetry and sign-in changes, so it covers the code that launches. Findings are fixed before launch day.', owner: 'Claude', due: '2027-01-31', status: 'todo' },
    { id: 'pr-perfaudit', area: 'product', group: 'Before launch day', title: 'Performance and hardening audit', note: 'Your request, 22 Nov. What breaks first under load, and what a mistake or an attacker could switch off. Includes the load rehearsal. Known starting points from the runbook draft: the daily save limit (40,000 rows for all accounts, 15,000 for one), the 4,000 catalog pages a day, and the missing way to roll the website back.', owner: 'Claude', due: '2027-01-31', status: 'todo' },
    { id: 'pr-steam', area: 'product', group: 'Before launch day', title: 'New users can connect Steam', note: 'Your call, 22 Nov: build it. The sync behind it exists, only the connect step is missing.', owner: 'Claude', due: '2026-12-20', status: 'doing' },
    { id: 'pr-importtest', area: 'product', group: 'Before the Play check', title: 'Test importing a list file on your phone', note: 'A note from 15 October says choosing a file needs a newer app version. Nothing says it was tried since. The store text promises list import.', owner: 'Nils', due: '2026-12-20', status: 'todo' },
    { id: 'pr-review', area: 'product', group: 'Before launch day', title: 'Ask for a Play rating at a good moment', note: 'Play\'s own review sheet, after a tenth rating or so. No "do you like it?" question first: Play forbids it.', owner: 'Claude', due: '2027-02-01', status: 'todo' },
    { id: 'pr-share', area: 'product', group: 'Before launch day', title: 'Share a title from the app', note: 'Found on 22 Nov: already built. The title page has had a share button beside Back since the item page was ported.', owner: 'Claude', due: '2027-02-01', status: 'done' },
    { id: 'pr-load', area: 'product', group: 'Before launch day', title: 'A load rehearsal against the API', note: 'Replay a busy launch hour and see which limit breaks first.', owner: 'Claude', due: '2027-02-01', status: 'todo' },
    { id: 'pr-getapp', area: 'product', group: 'Before launch day', title: 'A "Get the app" link on fandex.org', note: 'The Play badge for Android visitors on the home page.', owner: 'Claude', due: '2027-02-08', status: 'todo' },
    { id: 'pr-ios', area: 'product', group: 'Before launch day', title: 'A straight answer for iPhone users', note: 'The website works on an iPhone and can sit on the home screen. Say so on /app. A native iOS app waits for traction.', owner: 'Claude', due: '2027-02-08', status: 'todo' },
    { id: 'pr-runbook', area: 'product', group: 'Before launch day', title: 'A launch-day runbook', note: 'Draft in drafts/launch-runbook.md, checked claim by claim on 22 Nov and rewritten for the free plan. Still to try: the emergency switches on the live server.', owner: 'Claude', due: '2027-02-08', status: 'doing' },
    { id: 'pr-bgg', area: 'product', group: 'Before launch day', title: 'Board games, if BoardGameGeek approves the token', note: 'Applied 17 Oct, still pending. Not a blocker: launch without them.', owner: 'Nils', due: '', status: 'waiting' },

    // ------------------------------------------------------------ telemetry
    { id: 'pr-track', area: 'telemetry', group: 'To build', title: 'Agree the list of signals', note: 'Agreed on 22 Nov: the sixteen signals as listed.', owner: 'Nils', due: '2026-12-13', status: 'done' },
    { id: 'tm-switch', area: 'telemetry', group: 'To build', title: 'Decide: a Settings switch, or ask on first start', note: 'Agreed on 22 Nov: a switch in Settings, on by default.', owner: 'Nils', due: '2026-12-13', status: 'done' },
    { id: 'tm-server', area: 'telemetry', group: 'To build', title: 'Server counters: activity, retention, media mix', note: 'Day counters and a count per signup week. No row per person, so erasure and export stay as they are.', owner: 'Claude', due: '2027-01-10', status: 'todo' },
    { id: 'tm-app', area: 'telemetry', group: 'To build', title: 'App totals, sent once a session', note: 'Counted in memory, sent as one small batch when the app goes to the background, capped per day.', owner: 'Claude', due: '2027-01-17', status: 'todo' },
    { id: 'tm-admin', area: 'telemetry', group: 'To build', title: 'Expand the telemetry page the admin area already has', note: 'Your decision, 22 Nov: your own tool, no outside service. The existing page gains the numbers listed above: one per message, then the health numbers, then what people use.', owner: 'Claude', due: '2027-01-24', status: 'todo' },
    { id: 'tm-read', area: 'telemetry', group: 'To build', title: 'Read the first week of numbers together', note: 'What surprised us, what to change, what to stop counting.', owner: 'Both', due: '2027-02-23', status: 'todo' },

    // --------------------------------------------------------------- assets
    { id: 'as-title', area: 'assets', group: 'Store listing', title: 'App title', note: '30 characters. Options in drafts/store-listing.md, checked against the code on 22 Nov. Pick one per language.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'as-short', area: 'assets', group: 'Store listing', title: 'Short description', note: '80 characters. Options in drafts/store-listing.md. Pick one per language.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'as-full', area: 'assets', group: 'Store listing', title: 'Full description, English and German', note: 'Drafts in English and German in drafts/store-listing.md, checked claim by claim on 22 Nov. Two wrong claims were fixed: the contact route and what the score is built from.', owner: 'Both', due: '2027-01-10', status: 'doing' },
    { id: 'as-icon', area: 'assets', group: 'Store listing', title: 'Icon, 512 x 512', note: 'Checked on 22 Nov: 512 x 512, PNG with transparency, 12 KB. It meets Google Play\'s rules.', owner: 'Claude', due: '2026-12-20', status: 'done' },
    { id: 'as-art', area: 'assets', group: 'Store listing', title: 'A set of covers we are allowed to show', note: 'Public-domain films and books, plus games whose makers say yes. Play\'s copyright rule names cover art.', owner: 'Both', due: '2027-01-03', status: 'todo' },
    { id: 'as-demo', area: 'assets', group: 'Store listing', title: 'A demo account with a tidy library', note: 'Signed in, so the score, Up next and Insights show, filled with the cleared titles.', owner: 'Claude', due: '2027-01-10', status: 'todo' },
    { id: 'as-refs', area: 'assets', group: 'Store listing', title: 'Collect the competitors\' store pages as references', note: '48 screenshots of six competitors\' Google Play pages are in the refs folder, with notes.', owner: 'Claude', due: '2027-01-05', status: 'done' },
    { id: 'as-design', area: 'assets', group: 'Store listing', title: 'Design the store images and banners in a Claude design session', note: 'Brings in the real Fandex logo, and one banner per message. Style C is the starting point. Fine-tune there and make the final calls, with the references beside it. Your request, 22 Nov.', owner: 'Both', due: '2027-01-12', status: 'todo' },
    { id: 'as-shots', area: 'assets', group: 'Store listing', title: 'Eight phone screenshots, 1080 x 1920', note: 'One short line over each screen. The storyboard is above.', owner: 'Both', due: '2027-01-17', status: 'todo' },
    { id: 'as-feature', area: 'assets', group: 'Store listing', title: 'Feature graphic, 1024 x 500', note: 'No transparency, no badge, no device frame. The logo, "Everything you\'re waiting for, on one calendar." (your pick, 22 Nov), a strip of the calendar.', owner: 'Both', due: '2027-01-17', status: 'todo' },
    { id: 'as-video', area: 'assets', group: 'Store listing', title: 'Store video, 30 seconds', note: 'A YouTube link, landscape, monetization off. The first 30 seconds autoplay, so calendar and score go first.', owner: 'Both', due: '2027-01-24', status: 'todo' },

    { id: 'as-landing', area: 'assets', group: 'Website', title: 'The fandex.org/app page', note: 'The pitch on one screen, the Play badge, three clips. Posts link here or to the store.', owner: 'Claude', due: '2027-01-24', status: 'todo' },
    { id: 'as-og', area: 'assets', group: 'Website', title: 'Pictures for pasted links', note: '1200 x 630 for the home page and title pages, so a link in a chat or post shows an image.', owner: 'Claude', due: '2027-01-24', status: 'todo' },
    { id: 'as-blog', area: 'assets', group: 'Website', title: 'Launch post: why I built Fandex', note: 'Draft in drafts/blog-post.md, about 680 words. Five places marked [Nils: ...] need your own story.', owner: 'Both', due: '2027-02-08', status: 'doing' },
    { id: 'as-score', area: 'assets', group: 'Website', title: 'The "How the score works" page', note: 'Live at fandex.org/score. The proof link for every claim about the score.', owner: 'Claude', due: '2026-11-22', status: 'done' },
    { id: 'as-changelog', area: 'assets', group: 'Website', title: 'A public "What\'s new" page', note: 'Shows the app is alive. Feeds the Play release notes.', owner: 'Claude', due: '2027-02-08', status: 'todo' },

    { id: 'as-clips', area: 'assets', group: 'Video and images', title: 'Six short vertical clips', note: '15 to 25 seconds, two per story: taste that travels, one calendar, a score you can read.', owner: 'Both', due: '2027-02-08', status: 'todo' },
    { id: 'as-gifs', area: 'assets', group: 'Video and images', title: 'Three GIFs for posts', note: 'A calendar swipe, a rating with the Why sheet, the widget tick.', owner: 'Claude', due: '2027-02-08', status: 'todo' },
    { id: 'as-stills', area: 'assets', group: 'Video and images', title: 'Four stills for posts', note: '1600 x 900, the real app, one line each. They double as ad images later.', owner: 'Claude', due: '2027-02-08', status: 'todo' },

    { id: 'as-kit', area: 'assets', group: 'Press kit', title: 'Press kit page at fandex.org/press', note: 'Icon, logo, screenshots, the video, the facts sheet, a contact. Every pitch links it.', owner: 'Claude', due: '2027-02-08', status: 'todo' },
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
