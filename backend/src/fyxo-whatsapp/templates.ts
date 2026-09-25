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
  // The richer assignment template: four variables and two Quick Replies.
  //   {{1}} Cadre name  {{2}} Campaign  {{3}} Task  {{4}} Due date
  // Buttons: "View Task" and "Contact Admin". Which one was tapped is
  // recorded via buttonPayloads (API.md §5) — see TEMPLATE_BUTTON_ACTIONS
  // below and ConversationRouterService.handleButton.
  //
  // As with every entry here, PoliOS cannot create or approve this: the
  // name must already exist and be APPROVED in Fyxo/Meta before a send
  // will succeed. Until then sends fall back to whatever template the
  // sender owns (MessageTemplatesService.resolveFor).
  TASK_ASSIGNED_V2: {
    name: "task_assigned_v2",
    language: "en",
    body:
      "New Task Assigned\n\nHello {{1}},\n\nA new task has been assigned to you.\n\n" +
      "Campaign: {{2}}\nTask: {{3}}\nDue Date: {{4}}\n\n" +
      "Please review the task and take the required action.",
  },
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

/**
 * The Quick Reply buttons on TASK_ASSIGNED_V2, in the order they appear in
 * the approved template, and the action each records.
 *
 * A template button tap arrives carrying the payload we set at send time
 * (API.md §5), positionally matched to this list. The ACTION is what gets
 * stored, not the label: rewording "View Task" to "Open Task" in the Meta
 * console must not silently split one action into two in the dashboard.
 */
export const TEMPLATE_BUTTON_ACTIONS = [
  { action: "VIEW_TASK", label: "View Task" },
  { action: "CONTACT_ADMIN", label: "Contact Admin" },
] as const;

export type TemplateButtonAction = (typeof TEMPLATE_BUTTON_ACTIONS)[number]["action"];

/**
 * Per-button payloads for one recipient: ["VIEW_TASK:<taskId>",
 * "CONTACT_ADMIN:<taskId>"].
 *
 * Carrying the task id in every button is what makes a tap attributable to
 * a specific assignment rather than just "someone with this number tapped
 * something".
 */
export function taskButtonPayloads(taskId: string): string[] {
  return TEMPLATE_BUTTON_ACTIONS.map((b) => `${b.action}:${taskId}`);
}

/** Splits a payload back into its action and task id; null if it isn't ours. */
export function parseButtonPayload(payload: string): { action: string; taskId: string } | null {
  const [action, taskId] = payload.split(":");
  if (!action || !taskId) return null;
  return { action, taskId };
}

/**
 * The variable order a template expects, when the Super Admin hasn't set a
 * per-Admin mapping for it.
 *
 * Only templates whose approved wording we know go here. task_assigned_v2
 * reads who / which campaign / what / when, which is NOT the conventional
 * who/what/when order the generic default uses — without this entry its
 * {{2}} would be filled with the task name and every message would name the
 * wrong thing.
 */
export const TEMPLATE_VARIABLE_ORDER: Record<string, string[]> = {
  // Approved, 4 variables, buttons "view task" / "contact admin". Its body
  // reads Campaign / Task / Due Date in that order — NOT the conventional
  // who/what/when — so without an entry here the generic 3-slot default left
  // the 4th variable unfilled and put the wrong value in {{2}}.
  task_assigned: ["CADRE_NAME", "CAMPAIGN_NAME", "TASK_NAME", "DEADLINE"],
  task_assigned_v2: ["CADRE_NAME", "CAMPAIGN_NAME", "TASK_NAME", "DEADLINE"],
};
