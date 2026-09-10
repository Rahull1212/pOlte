// Fyxo Connect WhatsApp templates used by the Cadre agent layer. Names/
// languages here are what this app requests when calling
// FyxoWhatsAppService.sendTemplateMessage() — getting these actually
// approved in Fyxo's template console is an operational step outside this
// codebase, not something this file can verify.
//
// TASK_ASSIGNED is the one real, Meta-approved template in production use:
//   Name: "polios", language: "en"
//   Body: "Hi {{1}}, we have assigned a task to you please check"
//   Button: "Task Details" — baked into the approved template itself (a
//   quick-reply/interactive button component), NOT a body variable, so it's
//   never part of the `variables` array sent with the message.
// It takes exactly ONE body variable: the Cadre's name.
//
// TASK_COMPLETION_CHECK is awaiting approval — submitted for review as:
//   Name: "task_completion_check", language: "en"
//   Body: "Hi {{1}}, checking in on your task. Have you completed it?"
//   Buttons: "Yes" / "No" — must be Quick Reply buttons, not Website/URL
//   ones (a URL button can't send a reply at all — see TASK_ASSIGNED's
//   "Task Details" button, which hit exactly this question). ONE body
//   variable: the Cadre's name, same convention as TASK_ASSIGNED.
// If the real approved name/language ends up different, update the entry
// below — see TasksService.sendCompletionCheck for the one place that uses it.
//
// POLL is awaiting approval — submitted for review as:
//   Name: "polios_poll", language: "en"
//   Body: "Hi {{1}}, you've got a poll:\n{{2}}\n\nA) {{3}}\nB) {{4}}\nC) {{5}}"
//   Buttons: "Option A" / "Option B" / "Option C" — Quick Reply, not URL.
// This is deliberately GENERIC: Meta template button *labels* are fixed at
// approval time, so they can't say the real option text for whatever poll
// an Admin creates later — only the message *body* can carry that (as
// variables), which is why the body spells out what A/B/C actually mean
// and the buttons stay generic slots. A poll with fewer than 3 options
// still uses this same template — PollsService fills unused slots with an
// em dash and its reply-handling treats a tap on an unused slot as invalid.
// Five body variables: [Cadre name, question, option A text, option B
// text, option C text].
//
// Template names CAN be synced from Fyxo: GET /v1/templates returns them
// (name, language, category, status, variables, quickReplies), even though
// it isn't in the published API doc — see TemplateSyncService, which is what
// the Super Admin's "Sync templates" button calls. It does not return body
// copy, only the variable count, so approved wording is still recorded by
// hand where it's wanted for the message log.
//
// Careful: that endpoint answered 401 UNAUTHORIZED for a while on
// 2026-09-10 with a key that was working on other routes, then began
// returning data unchanged. A 401 from Fyxo is therefore not proof a route
// doesn't exist — retry before concluding anything, and don't rotate the API
// key over it.
//
// The other entries below are unapproved placeholders — nothing in this
// codebase requests them yet — kept only so future work has a name to grow
// into. Do not wire a new send to one of these until it's actually approved
// in Fyxo and its real variable count/order is confirmed the same way
// TASK_ASSIGNED's was (never guessed).
export const FYXO_TEMPLATES = {
  // `body` is the exact approved copy (or submitted-for-review copy),
  // {{n}} placeholders included — the single source of truth backing both
  // the doc comment above and renderFyxoBody() below, instead of the
  // wording only living in a comment nobody re-derives from code.
  TASK_ASSIGNED: { name: "polios", language: "en", body: "Hi {{1}}, we have assigned a task to you please check" },
  TASK_COMPLETION_CHECK: {
    name: "task_completion_check",
    language: "en",
    body: "Hi {{1}}, checking in on your task. Have you completed it?",
  },
  POLL: { name: "polios_poll", language: "en", body: "Hi {{1}}, you've got a poll:\n{{2}}\n\nA) {{3}}\nB) {{4}}\nC) {{5}}" },
  TASK_REMINDER: { name: "task_reminder", language: "en" },
  TASK_STARTED: { name: "task_started", language: "en" },
  TASK_SUBMITTED: { name: "task_submitted", language: "en" },
  TASK_VERIFIED: { name: "task_verified", language: "en" },
} as const;

/**
 * Fills a template's {{n}} placeholders with real values — used to log a
 * human-readable rendering of what was actually sent (see
 * GoogleSheetsService's task-message log) without needing a second,
 * separately-maintained copy of each template's wording. Falls back to a
 * generic "[template: name] var1, var2, ..." form for a template with no
 * `body` recorded above (the unapproved placeholders).
 */
export function renderFyxoBody(template: { name: string; body?: string }, variables: string[]): string {
  if (!template.body) {
    return `[template: ${template.name}] ${variables.join(", ")}`;
  }
  return template.body.replace(/\{\{(\d+)\}\}/g, (match, n) => variables[Number(n) - 1] ?? match);
}
