# AmbleBee Intake: Plan

**Repo:** `AmbleBee/amblebee-intake` (new, private)
**Status:** Design agreed 2026-11-12. No code yet.

AmbleBee Intake replaces the Google Forms with a fully branded experience on amblebee.com:

- suggest a mission idea
- build a full mission with guided tips
- contact AmbleBee

Every suggestion gets a private status link so people can follow it from "Awaiting Review" to "Live". Max reviews everything in an admin panel, and approved missions are written straight into the missions repo as drafts.

---

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Why build it | Google Forms look bad and can't be customized. The goal is a fully branded AmbleBee experience. |
| Where the forms live | Static pages on amblebee.com (in `amblebee-missions`, GitHub Pages), styled like the rest of the site |
| Where the backend lives | Docker container(s) on the UGREEN NAS |
| Going public | Tailscale Funnel exposes **only** the public API. Visitors never see its `*.ts.net` address because the forms call it in the background. |
| Admin panel | **Tailnet-only** (Tailscale Serve, never Funnel). Never reachable from the internet. |
| Stack | Python + FastAPI + SQLite, the same language as Mission Management, so it can reuse `amble_checks.py` and `writer.py` |
| Approval | Writes the mission into the repo as `draft: true` for a final check. Max removes the draft line to publish, same as today. |
| Email sender | amblebeehq@gmail.com (Gmail SMTP with an app password). staff@ stays a personal forward and is not part of this system. |
| Email on suggestions | **Optional.** The form explains that the status link always works, but email is the safest way to reach them. |
| Email on contact form | **Required** (a message you can't reply to isn't useful) |
| API down | The forms check `/health` first and show "Currently not accepting suggestions, please try again later" instead of the form |

---

## 2. Architecture

```
 Visitor's browser
   │  amblebee.com/suggest, /suggest/idea, /suggest/mission, /contact, /status/
   │  (static pages on GitHub Pages)
   │
   │  fetch() over HTTPS
   ▼
 Tailscale Funnel  ──  https://amblebee-intake.<tailnet>.ts.net  (public, port 443)
   │
   ▼
 NAS: Docker stack "amblebee-intake"
   ├─ tailscale sidecar   (own node name: amblebee-intake)
   │     • Funnel 443  → public API (port 8000)
   │     • Serve 8443  → admin panel (port 8001), tailnet-only
   ├─ intake app (FastAPI)
   │     • public API: health, schema, submit, status, reply, contact
   │     • admin panel: inbox, edit, status changes, approve
   │     • scheduler: reminders, auto-decline, "is it live yet?" check
   ├─ SQLite db         /volume1/docker/appdata/amblebee-intake/data/intake.db
   └─ missions clone    /volume1/docker/appdata/amblebee-intake/repo/  (amblebee-missions)
         • pushes with a deploy key scoped to this one repo
   │
   ├─ Gmail SMTP (amblebeehq@gmail.com) → submitter emails + admin alerts
   └─ GitHub (amblebee-missions)        → approved drafts land here
```

**Notes**

- Funnel can only listen on ports 443, 8443 and 10000, and it needs MagicDNS, HTTPS certificates and the `funnel` node attribute in the tailnet policy ([Tailscale Funnel docs](https://tailscale.com/docs/features/tailscale-funnel)).
- A sidecar Tailscale container gives the app its own node and name. Its Serve/Funnel setup can be stored as a JSON file through `TS_SERVE_CONFIG` ([Docker parameters](https://tailscale.com/docs/features/containers/docker/docker-params)).
  - **Verify in Phase 0:** that one config can Funnel 443 publicly while serving 8443 tailnet-only.
  - Fallback: run the admin on its own sidecar or node.
- Funnel has bandwidth limits Tailscale doesn't publish. That's fine for form posts, but it's a reason to never serve images or large files through it.
- **Custom domain:** Funnel can't serve `api.amblebee.com`, because it only issues certificates for `ts.net`. If that's ever wanted, the path is Cloudflare Tunnel, which means moving amblebee.com DNS to Cloudflare and replacing Squarespace email forwarding with Cloudflare Email Routing. **Not planned.**
- **CORS:** the public API only accepts browser requests from `https://amblebee.com` (and `http://localhost` while developing).
- **Monitoring:** add an Uptime Kuma monitor on `/health`.

---

## 3. Pages on amblebee.com

All pages share the site's header, footer, fonts and colors.

| Page | What it does |
|---|---|
| `/suggest/` | Choose a path: "Suggest an idea" or "Build a mission". Also shows **Your submissions** (status links saved on this device). |
| `/suggest/idea/` | Route 1: title, idea (paragraph), name for credit, email (optional) |
| `/suggest/mission/` | Route 2: guided mission builder (every public mission field, with hot tips) |
| `/contact/` | Name, email (**required**), message |
| `/status/#<token>` | Status of one submission, any "needs more info" request and reply box, and history |

**Why `#<token>` and not `/status/<token>`:**

- GitHub Pages can't serve made-up paths. Without a 404-page hack, `/status/abc123` would just 404.
- A token after `#` never leaves the browser. It isn't sent to GitHub, isn't logged, and isn't leaked in Referer headers.
- The page reads the token and asks the API for the status.

### Behavior when the API is down

- **On page load:** call `GET /health` with a ~3 second timeout. If there's no answer, hide the form and show *"Currently not accepting suggestions. Please try again later."* (Contact: *"Our contact form is down right now. Please try again later."*)
- **While typing:** autosave the draft to the browser (`localStorage`, wrapped in try/catch). This matters most for the mission builder.
- **On a failed submit:** keep everything, show a friendly error with a **Try again** button, and never clear the form.
- **Status page while down:** *"Status lookup is down right now. Your link still works, so check back later."*

### Keeping the status link from getting lost

This matters most for people who skip email.

- The confirmation screen shows the link big, with **Copy link** and **Save** (adds it to *Your submissions* on this device).
- Wording: *"This link is the only way to check your submission without email. Keep it somewhere safe."*

---

## 4. Public API (Funnel)

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | `{ok: true, accepting: true}`. `accepting` lets Max pause intake from admin without taking the server down. |
| GET | `/schema` | Everything the builder needs: fields, allowed values, gear list, theme chips, packs (only **live** packs: packs with at least one published mission), limits, hot tips. Built from `amble_checks.py` + `tips.yaml`, so new themes or gear show up without touching the site. |
| POST | `/submit/idea` | Route 1. Returns `{token, status_url}`. |
| POST | `/submit/mission` | Route 2. Validated with the same rules as Mission Management (see §8). Returns `{token, status_url}`. |
| POST | `/contact` | Contact message. Stored and forwarded to amblebeehq@gmail.com. |
| GET | `/status/{token}` | Public view: title, kind, current status (public wording), history dates, info request if any, decline reason, live link |
| POST | `/status/{token}/reply` | Answers a "needs more info" request: only the fields Max asked for, plus a message |

**Public responses never include** email, IP, admin notes or other submissions.

---

## 5. Status flow

```
Mission route:  Awaiting Review → In Review → Researching ──────→ Approved → Live
Idea route:     Awaiting Review → In Review → Building mission ─→ Approved → Live

From any stage before Approved:
  → Needs more info  (pauses; answering returns it to the stage it came from)
  → Declined         (final; always has a reason)
```

| Status | Set by | Public meaning |
|---|---|---|
| Awaiting Review | automatic on submit | We got it. It's in line. |
| In Review | Max | We're reading it now. |
| Researching *(missions)* | Max | We're checking the place, hours and pin. |
| Building mission *(ideas)* | Max | We're turning your idea into a full mission. |
| Needs more info | Max | We have a question. Answer below. |
| Approved | automatic when Max approves and the draft is pushed | It's in! We're doing a final check before it goes live. |
| Live | automatic, when the server sees `draft: true` removed | It's live! *[link to the mission]* |
| Declined | Max, or automatic after 30 days without a reply | Not this time. *[reason]* |

**Needs more info, step by step**

1. In admin, Max writes a question and ticks which fields he wants (for example *place → address*, *time_of_day*, or "anything else").
2. The status page shows just those fields plus a message box.
3. Their reply shows up in admin. The submission goes back to the stage it came from, with an "Answered" badge in the inbox.
4. Timers:
   - **Day 14:** reminder email (if they gave an email)
   - **Day 30:** automatically declined with *"We didn't hear back."*, plus the decline email
   - Answering stops both timers.
5. Without an email, the status page shows the question and the deadline clearly. The timer still runs.

**Live detection**

- A background job pulls the missions clone every ~30 minutes.
- For each Approved submission, it checks whether its mission file has lost `draft: true` and has a `checked:` date.
- If so, it marks the submission Live, stores the mission URL, and sends the Live email.
- Mission URL pattern: `https://amblebee.com/missions/<id>/` (the file name, no pack in the path). Example: `https://amblebee.com/missions/mount-st-helens/`.

**Decline reasons**

Presets plus a custom box:

- Already have this one
- Couldn't verify the place
- Not a fit for AmbleBee
- Outside the area we cover right now
- We didn't hear back

---

## 6. Emails

All emails come from amblebeehq@gmail.com, using AmbleBee-branded HTML with a plain-text fallback. Submitter emails go out only if they gave an email.

| Email | To | When |
|---|---|---|
| Received | submitter | on submit, with the status link |
| Needs more info | submitter | when Max asks a question, with the link to answer |
| Reminder | submitter | day 14 with no answer |
| Declined | submitter | declined (by Max or the day-30 timer), with the reason |
| Live | submitter | mission went live, with the link |
| Daily digest | amblebeehq@gmail.com | **5:00 AM Pacific** (America/Los_Angeles, so it follows daylight saving), only if something needs action; no email otherwise |

**What counts as actionable in the digest**

- New submissions (Awaiting Review)
- New replies to "needs more info"
- New contact messages
- Approved drafts still waiting for you to publish
- Problems: failed emails, failed repo pushes, sync errors

**Setup**

- Turn on 2-Step Verification on amblebeehq@gmail.com, then create an app password.
- Store it as a Docker secret or env var, never in the repo.

**Sending**

- Emails go through an **outbox** table with retries, so an SMTP hiccup never loses an email or blocks a submission.

---

## 7. Admin panel (tailnet only)

**Inbox**

- One list with tabs: **Suggested** (ideas + missions), **Needs more info**, **Approved / Live**, **Declined**, **Contact**.
- Filter by kind, status, pack and "answered".

**Submission view**

- Everything they sent, editable.
- **Mission builder:** the same form as the public one, plus admin-only fields: `number`, `checked`, `tags`, `caution_until`.
- **Status buttons:** move along the flow, *Ask for more info*, *Decline* (reason required).
- **Turn into mission** (ideas only): opens the builder filled in with their title and text, keeps their name and credit, and moves the idea to *Building mission*.
- **Approve:**
  1. pick the pack
  2. the server assigns the next free `number` and makes an `id` from the name (checking it's unique)
  3. runs every check
  4. writes the file
  5. pushes
  6. sets Approved
- **Pre-approval check:** shows the same warnings Mission Management would, including duplicates (same place) and pin notes.
- **History log:** every status change, email sent and reply.
- **Admin notes:** private, never shown publicly.

**Contact messages**

- Read and archive them. *Reply* opens your mail app addressed to them.

**Settings**

- Pause intake: makes `/health` report `accepting: false`, and the site shows the "not accepting" message.
- Edit decline-reason presets, see email outbox and failures, see repo sync status.

**Login**

- The tailnet is the main lock, plus a simple admin password, so a shared device on the tailnet doesn't mean open access.

---

## 8. Writing to the missions repo

The goal: an approved mission lands exactly as if Max had made it in Mission Management.

- **Same rules, same formatting.**
  - The server imports `amble_checks.py` and `writer.py` from its own clone of `amblebee-missions` (`tools/mission_management/`), so it always uses the current rules with nothing to keep in sync.
  - At startup and after every pull, it logs `CHECKER_VERSION`. If a pull breaks the import, it keeps the last working copy and shows a warning in admin.
- **Write access:**
  - A GitHub **deploy key** with write access to `amblebee-missions` only. Not a personal token.
  - Commits are authored as "AmbleBee Intake".
- **Approve flow:**
  1. `git pull --rebase`
  2. assign `number` and `id`
  3. render the mission with `writer.dump_mission` and `draft: true`, plus `credit` if they opted in
  4. run the full catalog check
  5. commit (`Add <id> (suggested via intake) — draft`)
  6. push
- **If something fails:**
  - If the push is rejected because someone else pushed, it pulls and retries up to 3 times.
  - If it still fails, or a check fails, nothing is pushed. The submission stays in its current stage and admin shows the error.
- **Why drafts matter:** a bad file on main would break the live site build, so nothing is pushed unless every check passes.
- **Editing safely:** the clone is the server's own. Max keeps editing in vscodium-web and Mission Management as usual, and pull/rebase handles the overlap.

---

## 9. The mission builder (Route 2)

- **Fields come from `/schema`,** not hard-coded. It's a guided, step-by-step form:
  1. **Basics:** name, mode, who
  2. **Place:** name, area, address, website, and a map pin, or "I don't know the exact spot"
  3. **The mission:** short (100 max), description (800 max, aim ~400), steps / photo prompts
  4. **For kids:** only if *who* includes kids
  5. **Details:** duration, effort, cost, setting, season, time of day, travel, gear, check ahead, discounts, caution
  6. **Themes:** up to 6 chips
  7. **About this place:** optional, 1500 max
  8. **You:** name, "credit me", email (optional)
  9. **Preview:** the mission card, then submit
- **Hidden from the public:** `draft`, `checked`, `number`, `tags`, `caution_until`, `about` links between missions.
- **Hot tips** live in `tips.yaml` in this repo, keyed by field. They start from the comments in `_template.yaml`, rewritten for visitors. For example: *"Pin the entrance, dock or trailhead, not the middle of the park"* and *"$ means under $20 for two."*
- **Live checks while typing:** character counters, required fields, and the house-style rules from `amble_checks.py`, like couple-only wording on missions open to others.
- **Mission rule:** every mission must include something to do or photograph. The builder says so up front and requires at least a description that includes a photo or action.
- **Preview** uses the website's own mission-card code if it can be loaded standalone. If not, a close copy.

---

## 10. Data model (SQLite)

**submissions**

| column | notes |
|---|---|
| id | internal integer |
| token_hash | SHA-256 of the status token (the token itself is 128+ bits random, never stored) |
| kind | `idea` / `mission` |
| status | see §5 |
| return_status | stage to go back to after "needs more info" |
| title, body | Route 1 fields (and the name for Route 2) |
| mission | JSON: the submitted mission fields (Route 2, or built from an idea) |
| pack | chosen or assigned pack |
| name, credit_ok, email | submitter (email nullable) |
| info_request | JSON: question + requested fields |
| info_due, reminder_sent | timer state |
| decline_reason | text |
| mission_id, mission_url | set on Approved / Live |
| admin_notes | private |
| created_at, updated_at | |

**events:** `submission_id, at, type (status/email/reply/note), detail JSON`. This is the history log.
**replies:** `submission_id, at, fields JSON, message`.
**contacts:** `id, at, name, email, message, archived`.
**outbox:** `id, to, template, data JSON, attempts, sent_at, last_error`.

**Personal data cleanup**

- 90 days after a submission goes **Live**, a nightly job replaces the submitter's name and email in the intake database with "AmbleBee user".
- The `credit` line in the mission file is **not** touched. If they asked to be credited, that's public and permanent by their choice.
- The status link keeps working after cleanup.

**Backups:** the SQLite file lives in appdata on the RAID 1 pool. Add a nightly `sqlite3 .backup` copy to the HDD array.

---

## 11. Spam and abuse

With email optional, these are **must-haves in Phase 1:**

- **Honeypot field:** hidden, and bots fill it in.
- **Time check:** forms submitted in under ~3 seconds are rejected.
- **Rate limits:** per IP and globally. Example: 5 submissions per IP per hour, 100 per day overall.
  - **Verify in Phase 0** what client-IP information Funnel passes through. If none, rely on global limits and Turnstile.
- **Cloudflare Turnstile:** free, works without moving DNS to Cloudflare. It can start invisible.
- **Length limits** on every field (the mission limits come from `amble_checks.py`).
- **Never render submitted text as HTML,** in admin or on the status page. Links show as plain text.

---

## 12. Privacy note (shown on the forms)

> We only use your email to send updates about this submission, never for marketing, and we never share it. Your name only appears on a mission if you tick "credit me". Your status link is private, so anyone with it can see your submission's status.

Plus a short `/privacy` section on the site covering what's stored and how to ask for deletion (email amblebeehq@gmail.com).

---

## 13. Build phases

**Phase 0: Plumbing**

- [ ] Create `AmbleBee/amblebee-intake` repo, with Docker Compose (app + tailscale sidecar)
- [ ] Enable HTTPS certs + Funnel attribute in the tailnet. Bring up `amblebee-intake` node: Funnel 443 → API, Serve 8443 → admin (verify both work from one config)
- [ ] `GET /health`, CORS for amblebee.com, and check what client IP info arrives through Funnel
- [ ] amblebeehq@gmail.com: 2-Step Verification + app password. Send a test email.
- [ ] Uptime Kuma monitor on `/health`

**Phase 1: Replace the Google Forms**

- [ ] Contact form (page + API + admin Contact tab + forward to amblebeehq@gmail.com)
- [ ] Route 1 (idea): page, API, status token, Received email
- [ ] `/status/` page (read-only for now) + *Your submissions* on the device
- [ ] Admin inbox + submission view + manual status changes + decline with reason
- [ ] Spam protection (honeypot, time check, rate limits, Turnstile)
- [ ] API-down handling on every page
- [ ] Retire the Google Forms: stop them accepting responses at launch, work through anything left in the Sheet, then delete the Sheet

**Phase 2: The full status workflow**

- [ ] Needs more info: admin question + field picker, status-page reply, Answered badge
- [ ] Emails: needs more info, reminder, declined
- [ ] Scheduler: day-14 reminder, day-30 auto-decline
- [ ] History log on admin + public status page

**Phase 3: Mission builder + repo writes**

- [ ] `/schema` route + `tips.yaml`
- [ ] Public mission builder (steps, live checks, preview, draft autosave)
- [ ] Admin builder + **Turn into mission** for ideas
- [ ] Deploy key + server clone + Approve → draft push (with checks, retries, errors)
- [ ] Live detection + Live email

**Phase 4: Polish**

- [ ] Branded HTML email templates
- [ ] Nightly SQLite backup
- [ ] Pause-intake switch, outbox/repo-sync status in admin settings

---

## 14. Still open

1. **Personal data on declined submissions.** Proposed: same cleanup, 90 days after Declined.
2. **Contact messages.** How long to keep them after they're archived. Proposed: 90 days.

### Answered 2026-11-12

- Mission URLs are `https://amblebee.com/missions/<id>/`.
- Any live pack can receive suggestions.
- The old Google Sheet gets deleted after the last entries are worked through.
- Personal data is replaced with "AmbleBee user" 90 days after Live.
- Admin alerts are one daily digest at 5 AM Pacific, only when something needs action.
