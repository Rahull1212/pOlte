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
// The other entries below are unapproved placeholders — nothing in this
// codebase requests them yet — kept only so future work has a name to grow
// into. Do not wire a new send to one of these until it's actually approved
// in Fyxo and its real variable count/order is confirmed the same way
// TASK_ASSIGNED's was (never guessed).
export const FYXO_TEMPLATES = {
  TASK_ASSIGNED: { name: "polios", language: "en" },
  TASK_REMINDER: { name: "task_reminder", language: "en" },
  TASK_STARTED: { name: "task_started", language: "en" },
  TASK_SUBMITTED: { name: "task_submitted", language: "en" },
  TASK_VERIFIED: { name: "task_verified", language: "en" },
} as const;
