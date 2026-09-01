# ARC-007 — WhatsApp & Meta Integration Architecture

| | |
|---|---|
| **Status** | Draft |
| **Phase** | 3 — Product Implementation, Experience & Delivery |
| **Depends on** | ARC-004.0 (data strategy) — event/notification patterns this doc extends |
| **Date** | 2026-08-18 |

## 0. Read This First: One Finding Needs Action, Not Just Documentation

Before anything else in this document: the current webhook (`POST /whatsapp/webhook`) has **no signature
verification** and treats the message's `from` phone number as proven identity. There is no `X-Hub-Signature-256`
check anywhere in the codebase. Combined, this means anyone who knows the webhook URL can POST a forged payload
with any registered Cadre's phone number in `from` and the system will process it as that Cadre — submit task
progress, register citizens, check into events — with zero authentication. This is exploitable today, in the
code as it currently runs, independent of whether WhatsApp credentials are configured.

Everything else in this document is architecture for where the integration is going. This one is a live gap in
where it already is. I'd recommend fixing it (§12) as its own change, not bundled into a larger Phase 3 build —
say the word and I'll do it directly rather than waiting for the rest of this roadmap.

## 1. Where We Are Today

The Phase 3 brief's target flow is:

```
WhatsApp User → Meta WhatsApp Business Platform → Webhook Gateway → Conversation Engine
              → Intent Detection → Workflow / AI Agent → Business Service
```

What's actually built is narrower — and it's important this document says so plainly rather than describing the
target diagram as if it already exists:

```
WhatsApp User → Meta Graph API → Unauthenticated Webhook → Conversation State Machine
              → Business Service (Tasks / Events / Citizens / Grievances)
```

**There is no "Intent Detection" or "AI Agent" step.** Routing is a `switch` on a literal `WhatsAppSession.state`
string plus numeric-reply matching — entirely deterministic, no NLU, no LLM in the loop. That's a legitimate,
reasonable design for a v1 (cheap, predictable, debuggable) — but it means this document and ARC-009 (AI Agent
Implementation) need a clean seam between them, not an assumption that WhatsApp routing already calls into an
agent. §3 defines that seam.

### 1.1 Capability Inventory

| Capability | Status | Detail |
|---|---|---|
| Freeform text messages (send) | **Built** | `WhatsAppApiService.sendText` — the only outbound message type that exists |
| Image messages (receive) | **Built** | Downloaded via `downloadMedia`, saved to local disk (stand-in for object storage) |
| Voice notes (receive) | **Missing** | `message.audio` is in the payload type but never read anywhere |
| Documents (receive) | **Missing** | Same — type permits it, handler ignores it |
| Location messages | **Missing** | Not modeled in the payload type at all |
| Message templates (approved, for the 24h-window rule) | **Missing** | Every send is `type: "text"` — see §5, this is a real production blocker, not a nice-to-have |
| Interactive messages (buttons/lists) | **Missing** | Menus are numbered text lists; user replies with a digit |
| WhatsApp Flows | **Missing** | Multi-step forms (citizen registration, grievances) are free-text state machines instead |
| Delivery/read receipts | **Missing** | Meta sends a `statuses` array on the webhook; the payload parser only reads `.messages`, `.statuses` is dropped unread |
| Opt-in / consent tracking | **Missing** | No field or table records consent; every Cadre with a phone number receives messages unconditionally |
| Webhook signature verification | **Missing — see §0** | No HMAC check; endpoint is `@Public()` with no other guard |
| Inbound message idempotency | **Missing** | `message.id` is parsed, never stored or checked; a Meta retry reprocesses as new input |
| Retry / backoff on send failure | **Missing** | Fire-and-forget `fetch`, logged-and-dropped on failure, no queue despite BullMQ already being used elsewhere in this codebase |
| Rate limiting | **Missing** | No throttling anywhere in the backend, webhook included |
| Human handoff | **Missing** | No escalation path when the bot can't handle input |
| Citizen registration via WhatsApp | **Built, but dormant** | Fully coded (3-step state flow), but not reachable — main menu never offers it |
| Grievance submission via WhatsApp | **Built, but dormant** | Same — reachable only if a session's `state` were externally set to `GRIEVANCE_CITIZEN_PHONE`, which nothing currently does |

### 1.2 What's Actually Reachable Today

The live main menu offers exactly two things, to Cadre accounts only (Admins/Super Admins use the web portal,
by design):

| Menu option | Flow | States involved |
|---|---|---|
| 1. My Tasks | View open tasks → pick one → submit a photo and/or completion % | `MAIN → TASKS_MENU → TASK_DETAIL` |
| 2. Today's Events | View events in the Cadre's region (and ancestor regions) → check in | `MAIN → EVENTS_MENU` |

Global commands (`MENU`/`HI`/`HELLO`/`START`, and `CANCEL`) work from any state and reset to `MAIN`. Any
unhandled exception mid-flow also resets to `MAIN` with an apology message, rather than leaving a session stuck.

### 1.3 The Notification Mirror Pattern

Every in-app `Notification` created for a Cadre is also pushed to WhatsApp — this is the primary way Cadres learn
about anything (task assigned, event invitation, campaign target allocated, grievance resolved, expense
approved/rejected, deadline reminders, escalations). Admins/Super Admins never get a WhatsApp copy; they see the
web bell icon only. This mirror is unconditional today — no opt-in check, no quiet hours, no digest/batching, no
awareness of the 24-hour window (§5).

OTP codes (phone-number change, forgot-password) are **WhatsApp-only** with no fallback channel — if WhatsApp
isn't configured or a send silently fails, the user has no way to receive their code and the API still reports
success to the frontend.

## 2. Gaps, Ranked by What Actually Breaks First

| # | Gap | What happens without a fix |
|---|---|---|
| 1 | No webhook signature verification (§0, §12) | Full identity spoofing — exploitable now |
| 2 | No template/24h-window handling (§5) | In real Meta production, most notification-mirror sends will simply start failing (Graph API rejects freeform messages outside an active session) — invisible today because failures are swallowed into a log line |
| 3 | No inbound idempotency (§12) | Meta retries reprocess as new input — duplicate progress updates, duplicate citizen records |
| 4 | No retry/queue on send (§11) | Any transient Graph API hiccup silently drops a message, including security-relevant ones (password-change alerts, OTP codes) |
| 5 | No opt-in/consent model (§4) | Meta Business Policy compliance risk once real users are being messaged |
| 6 | No rate limiting (§13) | The forgot-password endpoint can be hammered to spam OTP messages at a phone number (harassment vector), and the webhook itself has no request ceiling |
| 7 | No delivery/read tracking (§10) | No way to know if a "sent" message actually arrived — support/debugging blind spot |

Items 1–4 are what I'd consider blocking for any real deployment; 5–7 matter before onboarding real
organizations at scale but don't cause silent data corruption or security exposure the way 1–4 do.

## 3. Target Architecture

```
WhatsApp User
     │
     ▼
Meta Graph API  ──────────────────────────────────────────────┐
     │                                                         │
     ▼ (webhook, HMAC-verified — §12)                          │ (send, via queue — §11)
Webhook Gateway → Message Log (idempotent on message.id — §12) │
     │                                                         │
     ▼                                                         │
Conversation Engine (session state machine, unchanged shape)   │
     │                                                         │
     ├─▶ deterministic states (Tasks, Events, Citizens, Grievances) — direct to Business Service
     │
     └─▶ "AI_ASSIST" state (new, optional per-message) ──▶ Intent Router ──▶ ARC-009 Agent Runtime
                                                                                    │
                                                                                    ▼
                                                                             Business Service
```

**Decision:** the deterministic state machine stays the primary mechanism for the flows it already handles well
(numbered menus are fast and unambiguous for routine tasks). It is not being replaced by an AI agent. What's new
is a single additional state — `AI_ASSIST` — that a Cadre can reach explicitly (e.g. replying `HELP` or `ASK`)
for anything the fixed menu doesn't cover: free-form questions, ambiguous requests, anything ARC-009's Cadre
Agent is built to handle. This keeps the two documents' scope clean: ARC-007 owns the transport and conversation
*shell*; ARC-009 owns what happens once a message is handed to an agent. Routing between them is one `if`
statement in `handleIncomingMessage`, not a rewrite of the state machine.

## 4. User Opt-In & Consent

**Decision:** add `User.whatsAppOptInAt DateTime?`. Null means never opted in — no WhatsApp send of any kind,
including the notification mirror, goes out. Set on first successful inbound message from that Cadre (implicit
opt-in via first contact, the pattern Meta's own policy treats as acceptable for a business the user is already
a known employee/member of) or explicitly via an Admin action when provisioning the Cadre account.

`STOP`/`UNSUBSCRIBE` as a global command (alongside `MENU`/`CANCEL`) clears `whatsAppOptInAt` and every future
send checks it first. Re-opt-in requires the Cadre to message in again.

Citizens are not WhatsApp users in this system at all — they're data records maintained by Cadres, never message
the bot directly. No citizen-facing opt-in is needed under the current design; if a future phase adds
citizen-facing WhatsApp (the Phase 3 brief mentions this as a possibility), it needs its own consent model,
separate from the Cadre one, since citizens haven't agreed to anything about this platform by default.

## 5. Message Templates & the 24-Hour Session Window

This is the gap most likely to cause silent production failures, so it gets its own section.

Meta's Cloud API rule: a business can send freeform (`type: "text"`) messages only within 24 hours of the last
message *received* from that user. Outside that window, only pre-approved **message templates** are accepted —
freeform sends are rejected outright.

**Decision:**
1. Add `User.lastInboundMessageAt DateTime?`, updated on every `handleIncomingMessage` call.
2. `WhatsAppApiService` gains a `sendTemplate(toPhone, templateName, params)` method alongside `sendText`.
3. A new `NotificationsService`/`OtpService`-facing method, `sendWhatsApp(userId, {textBody, templateName, templateParams})`, checks `lastInboundMessageAt`: inside 24h → `sendText`; outside → `sendTemplate`, falling back to logging a delivery failure (not a silent drop) if no template is registered for that notification type.
4. A small **template registry** (a table or even a static map to start): notification type → approved Meta template name + parameter mapping. Every notification type in §1.3 needs a template submitted to Meta for approval before this works end-to-end — that's an operational task (Meta review, typically 24–48h turnaround), not just code.

Until templates are registered and approved, the honest interim state is: notifications only reliably reach a
Cadre who's messaged the bot in the last 24 hours. That's worth stating plainly to whoever's planning the
Meta onboarding timeline — this isn't a flag-flip, it has an external approval dependency.

## 6. Interactive Messages (Buttons & Lists)

**Decision:** replace numbered-text menus with native Meta interactive messages for the two live flows first
(Main Menu, Task/Event selection), since these are simple enough to map directly:

- Main Menu (2 options today) → an interactive **button** message (Meta supports up to 3 buttons; if voice-note
  intake or a 3rd top-level option is added per §7/§9, still fits).
- Task/Event selection (variable-length list) → an interactive **list** message (Meta supports sections + up to
  10 rows).

This removes the class of bug where a user replies "3" to a 2-item list. `WhatsAppInboundMessage.interactive`
already exists in the payload type (`list_reply`/`button_reply`) — it's declared but never read; wiring it in is
additive, not a rewrite. Free-text fallback should stay for anyone whose WhatsApp client doesn't render
interactive messages well (some low-end Android/KaiOS clients).

## 7. Media: Images, Voice Notes, Documents, Location

- **Voice notes**: `downloadMedia` already handles arbitrary media IDs generically — the gap is purely that
  `handleIncomingMessage` never inspects `message.audio`. Given the Phase 3 vision names a Field Intelligence
  Agent that explicitly processes voice notes, the concrete plan: download the audio the same way images are
  downloaded today, store the URL, and — once ARC-009's transcription/summarization capability exists — feed it
  through that pipeline instead of requiring typed text. Until then, at minimum, a downloaded voice note attached
  to a task progress update (mirroring how a photo attaches today) is a self-contained, useful step that doesn't
  depend on ARC-009 at all.
- **Location**: `ProgressUpdate.gpsLat`/`gpsLng` already exist in the schema but are only ever set from the *web*
  form — WhatsApp task-progress submission never collects location today. Add `location` to the payload type
  (Meta sends `{latitude, longitude, name?, address?}` on a location message) and wire it into `TASK_DETAIL` as
  an optional additional attachment, same shape as the existing optional photo.
- **Documents**: lower priority — no current flow needs document upload. Leave unhandled until a concrete need
  appears (matches the "no speculative building" principle from ARC-004.0).

## 8. WhatsApp Flows

Meta Flows are structured, multi-screen native forms rendered inside WhatsApp — the user fills fields in a proper
form UI instead of a back-and-forth text exchange. **Decision:** adopt Flows for the two dormant multi-step
flows once they're un-dormant — Citizen Registration (name/phone/address) and Grievance Submission
(citizen-or-new/category/description/photos) — rather than for Tasks/Events, which are simpler and work fine as
menus. A Flow here cuts a 3–4 message round-trip down to one form submission and eliminates a whole class of
"user typed something the parser didn't expect" errors. This is meaningful but not urgent: it only matters once
those flows are actually exposed to users (§1.2 — they aren't, currently).

## 9. Human Handoff

**Decision:** two triggers for handoff to a human:
1. **Repeated non-understanding** — if a Cadre's reply doesn't match any expected input for their current state
   3 times in a row, don't keep repeating the same prompt; send "I'm having trouble understanding — reply MENU to
   start over, or HELP to reach your Admin" and, on `HELP`, notify their `parentUserId` Admin directly (reusing
   the existing `NotificationsService.notify` path) with the Cadre's last few messages for context.
2. **Explicit request** — a `HELP`/`SUPPORT` global command, same as `MENU`/`CANCEL`, reachable from any state.

This doesn't require a live chat/agent-takeover UI (out of scope for this version) — it's routing the person to
their existing Admin relationship, which the org hierarchy already models.

## 10. Delivery Status & Message Log

**Decision:** add a `WhatsAppMessage` model:

```
model WhatsAppMessage {
  id            String   @id @default(cuid())
  userId        String?
  direction     String   // "INBOUND" | "OUTBOUND"
  metaMessageId String?  @unique   // dedupe key for inbound (§12) and status-callback matching for outbound
  type          String   // "text" | "template" | "image" | "audio" | "location" | ...
  status        String   @default("SENT")  // SENT | DELIVERED | READ | FAILED
  content       String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

`extractMessages` (payload parser) gains a sibling that reads `.value.statuses[]` and updates the matching row's
`status`/`updatedAt` by `metaMessageId`. This turns "did that message actually arrive" from unanswerable into a
queryable fact, and doubles as the durable inbound-message record `context` (ephemeral, overwritten every state
transition) never provided.

## 11. Retry & Reliability

**Decision:** route every outbound send through the BullMQ queue already used for escalation sweeps
(`backend/src/queue`), instead of the current synchronous inline `fetch`. A `whatsapp-send` job: payload =
`{toPhone, type, body|templateName+params}`, processor calls the Graph API with exponential backoff on failure
(3 attempts), writes/updates the corresponding `WhatsAppMessage` row on each attempt. This decouples request
latency (a Cadre submitting task progress shouldn't wait on a Graph API round-trip) from delivery, and turns
"silently dropped" into "retried, then durably marked FAILED if it never succeeds" — visible in the message log
from §10 rather than only in server logs.

## 12. Security: Signature Verification & Idempotency

Concrete fix for §0:

1. Add `WHATSAPP_APP_SECRET` env var (Meta app secret, distinct from the access token).
2. On `POST /whatsapp/webhook`, compute HMAC-SHA256 of the **raw** request body using `WHATSAPP_APP_SECRET`,
   compare (constant-time) against the `X-Hub-Signature-256` header. Reject with 403 on mismatch, before any
   processing. This requires capturing the raw body before NestJS's JSON parsing normalizes it — a raw-body
   middleware scoped to this one route, not a global change.
3. Idempotency: before calling `conversationService.handleIncomingMessage`, check `WhatsAppMessage` (§10) for an
   existing row with that `metaMessageId`; if found, skip processing and still return 200 (Meta should stop
   retrying, but processing must not repeat).

Together these close the spoofing hole (§0) and the duplicate-processing risk (§2, gap 3) with one shared piece
of new infrastructure (the message log).

## 13. Message Governance & Meta Policy Considerations

- **Rate limiting**: add a per-phone-number limit on the webhook (e.g. 30 messages/minute) and specifically on
  OTP generation (`OtpService` already has a 60-second resend cooldown per purpose+phone — extend that same
  pattern to cap total OTP requests per phone per hour, closing gap 6 from §2).
- **Opt-out compliance**: `STOP` handling (§4) is a Meta policy requirement, not optional polish.
- **Template content review**: since templates (§5) require Meta approval, establish that any template wording
  goes through one designated reviewer before submission — this is a process decision, not a code one, but
  belongs in this doc since it blocks §5 operationally.
- **Political content caution**: per the Phase 3 brief's own framing (ARC-018 will own this in full) — automated
  outbound messages in this system are all operational (task reminders, event notices), never bulk political
  messaging or targeting logic. Nothing in this architecture should be extended to send campaign/persuasion
  content without that going through ARC-018's governance review first.

## 14. Non-Goals for This Version

- **No NLU/intent-detection engine.** The `AI_ASSIST` seam (§3) hands off to ARC-009; this document doesn't
  design what happens inside that handoff.
- **No citizen-facing WhatsApp bot.** Citizens remain data records, not WhatsApp users, under this design.
- **No multi-language/Telugu message content** in this pass — real, and connects to ARC-006's localization
  section, but adding language selection to every flow here would double this document's scope for a concern
  ARC-006 should own coherently across web and WhatsApp together.
- **No live agent takeover UI.** Human handoff (§9) routes to a Cadre's existing Admin via the notification
  system already in place, not a new support-agent console.

## 15. Decision Log

| ID | Decision | Section |
|---|---|---|
| ADR-001 | Deterministic state machine stays primary; a single new `AI_ASSIST` state is the only seam into an AI agent (owned by ARC-009) | §3 |
| ADR-002 | Opt-in tracked via `User.whatsAppOptInAt`, implicit on first inbound contact, cleared by `STOP` | §4 |
| ADR-003 | Template registry + 24h-window check via `User.lastInboundMessageAt`, with templates requiring Meta approval as an external dependency | §5 |
| ADR-004 | Adopt native interactive buttons/lists for Main Menu and Task/Event selection now; Meta Flows for Citizen Registration/Grievances once un-dormant | §6, §8 |
| ADR-005 | New `WhatsAppMessage` log model is the shared foundation for delivery status (§10), retry (§11), and inbound idempotency (§12) | §10–§12 |
| ADR-006 | Outbound sends move from inline `fetch` to the existing BullMQ queue, with backoff retry | §11 |
| ADR-007 | Webhook signature verification via raw-body HMAC check against `WHATSAPP_APP_SECRET` — treated as urgent, independent of the rest of this roadmap | §0, §12 |

## 16. Recommended Next Step

Two tracks, not necessarily sequential:

1. **Now, independent of the rest of Phase 3**: fix §0/§12 (signature verification) and the OTP-only-channel
   fragility (§2 gap 4, at minimum add a synchronous error surfaced to the API caller so a failed OTP send
   doesn't silently report success). Both are small, contained changes to code that already exists.
2. **Next architecture document**: given §3 explicitly hands off to it, ARC-009 (AI Agent Implementation) is the
   natural next doc — it's the piece this one deliberately left a seam for rather than designing itself.

I can start on either. Which do you want first?
