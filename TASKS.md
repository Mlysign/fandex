# Fandex: Task Tracker

> **This file holds only what is still open.** Finished work → [docs/archive/history.md](docs/archive/history.md) (grep it for the "why" behind a past decision; never read it end to end). One-page state → [STATUS.md](STATUS.md).

- **Legend:** ⬜ not started · 🔵 in progress / needs input · ⏸️ blocked · ✅ done
- **Convention:** an entry is 2 to 4 sentences plus a commit hash once done. The full story (root cause, files touched, verification) belongs in the commit message, not here. **When a section is fully done, move it to the archive the same session.** This file blew past its 200-line CI guard twice (441 lines, then 374) from skipping that step.

---

## ⚠️ Needs Nils: this is the whole list

Everything else in this file is either done or a standing constraint.

1. **🔵 Google sign-in: the Google side is DONE. It needs TWO env vars in Railway from you.** (2026-09-01.) The code is live and inert: `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` unset means the button does not render and `/api/auth/google` 404s, so nothing is live for visitors until you set them.

   **✅ Done in your Chrome 2026-09-01:** project **fandex**, OAuth client **"Fandex web"**, consent screen External with app name Fandex, authorised domain fandex.org, and home/privacy/terms pointing at the live legal pages. Redirect URIs registered for prod AND localhost:3000. **Publishing status: In production**, so any Google account can sign in — no verification review was required, because that only applies above 10 domains, with an uploaded logo, or with sensitive scopes, and we have one domain, no logo and openid+profile only. ⚠️ **Do not upload an app logo**: the Branding page states that doing so forces a verification submission.

   **What is left for you, and it is the whole remaining task:** set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in Railway. The id is `776362768799-1844j6ti2udd7aufgpunvqa0ngob2shi.apps.googleusercontent.com`; the secret is the `GOCSPX-…` value shown once in the console, which Claude deliberately did not copy anywhere (entering credentials into fields is off-limits for it). If that dialog is gone, generate a new secret on the same client rather than recreating the client.
