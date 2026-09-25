// Single source of truth for enums + Zod DTO schemas used across this
// backend. A matching copy lives at frontend/src/lib/shared-types.ts —
// backend and frontend are fully independent projects (no shared npm
// package), so keep the two files in sync by hand when either changes.

import { z } from "zod";

// ============================================================
// ENUMS
// ============================================================

// Three-tier role model. "Area" (which Region a SUPER_ADMIN/ADMIN manages) is
// carried on the user's regionId, not the role — an ADMIN's regionId can be
// a District, Constituency, or Polling Station node interchangeably.
export const Role = ["SUPER_ADMIN", "ADMIN", "CADRE"] as const;
export type Role = (typeof Role)[number];

export const RegionType = ["STATE", "DISTRICT", "CONSTITUENCY", "BOOTH"] as const;
export type RegionType = (typeof RegionType)[number];

export const Gender = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"] as const;
export type Gender = (typeof Gender)[number];

export const CampaignStatus = ["DRAFT", "UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type CampaignStatus = (typeof CampaignStatus)[number];

// Where an Admin stands on a campaign they were handed. Assignment alone
// isn't agreement — until they ACCEPT, they cannot allocate its work.
export const CampaignAssignmentStatus = ["PENDING", "ACCEPTED", "DECLINED"] as const;
export type CampaignAssignmentStatus = (typeof CampaignAssignmentStatus)[number];

export const CampaignPriority = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type CampaignPriority = (typeof CampaignPriority)[number];

export const TaskStatus = ["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE", "CANCELLED"] as const;
export type TaskStatus = (typeof TaskStatus)[number];

export const TaskPriority = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TaskPriority)[number];

export const TaskAcknowledgment = ["AWAITING", "ACCEPTED", "DECLINED"] as const;
export type TaskAcknowledgment = (typeof TaskAcknowledgment)[number];

export const WhatsappDeliveryStatus = ["PENDING", "SENT", "FAILED"] as const;
export type WhatsappDeliveryStatus = (typeof WhatsappDeliveryStatus)[number];

export const ExpenseType = [
  "POSTER_PRINTING",
  "FOOD",
  "TRAVEL",
  "FUEL",
  "VENUE",
  "MISCELLANEOUS",
] as const;
export type ExpenseType = (typeof ExpenseType)[number];

export const ApprovalStatus = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ApprovalStatus = (typeof ApprovalStatus)[number];

export const MessageType = ["TEXT", "IMAGE", "VIDEO", "PDF", "VOICE_NOTE"] as const;
export type MessageType = (typeof MessageType)[number];

export const NotificationType = [
  "NEW_CAMPAIGN",
  "TASK_ASSIGNED",
  "BUDGET_APPROVED",
  "EXPENSE_REJECTED",
  "DEADLINE_REMINDER",
  "CAMPAIGN_COMPLETED",
  "ESCALATION",
  "GRIEVANCE_SUBMITTED",
  "GRIEVANCE_RESOLVED",
  "EVENT_INVITATION",
  "TASK_DECLINED",
  "TASK_PENDING_ALLOCATION",
  "TASK_ALLOCATED",
  "POLL_PENDING_ALLOCATION",
] as const;
export type NotificationType = (typeof NotificationType)[number];

export const AIInsightType = ["SUMMARY", "RISK", "RECOMMENDATION", "PREDICTION", "WEEKLY_REPORT"] as const;
export type AIInsightType = (typeof AIInsightType)[number];

export const GrievanceStatus = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"] as const;
export type GrievanceStatus = (typeof GrievanceStatus)[number];

// ============================================================
// REGIONS (areas)
// ============================================================
// The hierarchy itself (which type may sit under which) is enforced in
// RegionsService, not here — it depends on the parent's stored type, which a
// schema can't see. These only check the shape.

export const createRegionSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  type: z.enum(RegionType),
  // Required for everything but a State; the service rejects the invalid
  // combinations with a message naming the expected parent type.
  parentId: z.string().min(1).optional(),
  // Booths only. Free text because real booth numbers carry letters and
  // leading zeros ("12A", "007").
  number: z.string().max(20).optional(),
});
export type CreateRegionDto = z.infer<typeof createRegionSchema>;

export const updateRegionSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    parentId: z.string().min(1).optional(),
    type: z.enum(RegionType).optional(),
    number: z.string().max(20).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Nothing to update",
  });
export type UpdateRegionDto = z.infer<typeof updateRegionSchema>;

// Campaign status transitions come in as a bare field; without this any
// string was accepted straight into the database column.
// An Admin's answer to a campaign assignment. A decline should say why —
// the Super Admin otherwise only learns that someone said no.
export const respondToCampaignSchema = z
  .object({
    status: z.enum(["ACCEPTED", "DECLINED"]),
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.status !== "DECLINED" || (d.note && d.note.trim().length > 0), {
    message: "Give a reason for declining this campaign",
    path: ["note"],
  });
export type RespondToCampaignDto = z.infer<typeof respondToCampaignSchema>;

export const setCampaignStatusSchema = z.object({ status: z.enum(CampaignStatus) });
export type SetCampaignStatusDto = z.infer<typeof setCampaignStatusSchema>;

export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1, "refreshToken is required") });
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

// ============================================================
// AUTH
// ============================================================

export const loginSchema = z.object({
  phone: z.string().min(10).max(15),
  password: z.string().min(6),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  gender: z.enum(Gender).optional(),
});
export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;

export const requestPhoneChangeSchema = z.object({
  newPhone: z.string().min(10).max(15),
  currentPassword: z.string().min(1),
});
export type RequestPhoneChangeDto = z.infer<typeof requestPhoneChangeSchema>;

export const confirmPhoneChangeSchema = z.object({
  newPhone: z.string().min(10).max(15),
  code: z.string().length(6),
});
export type ConfirmPhoneChangeDto = z.infer<typeof confirmPhoneChangeSchema>;

export const forgotPasswordSchema = z.object({
  phone: z.string().min(10).max(15),
});
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  phone: z.string().min(10).max(15),
  code: z.string().length(6),
  newPassword: z.string().min(6),
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

// ============================================================
// USERS
// ============================================================

export const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(10).max(15),
  email: z.string().email().optional(),
  // Optional — required for an Admin (who logs into the web portal), but a
  // Cadre works entirely from WhatsApp and never types a password anywhere,
  // so UsersService.create() generates one server-side for a Cadre rather
  // than making an Admin invent/communicate one nobody will ever use.
  password: z.string().min(6).optional(),
  role: z.enum(Role),
  regionId: z.string().min(1),
  parentUserId: z.string().optional(),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  regionId: z.string().min(1).optional(),
  role: z.enum(Role).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

// ============================================================
// CAMPAIGNS
// ============================================================

// What kind of work a campaign involves. Chosen from a list rather than
// typed free-hand so campaigns group cleanly in filtering and reporting —
// "Door-to-door", "door to door" and "D2D" were all the same thing before.
//
// Stored in the existing Campaign.category column as plain text, not an
// enum: campaigns created before this list exists carry values that aren't
// in it, and an enum would make those rows unreadable and un-editable.
export const CampaignType = [
  "Door-to-door Canvassing",
  "Membership Drive",
  "Voter Registration",
  "Phone Banking / Calling",
  "Survey / Feedback Collection",
  "Event / Rally Coordination",
  "Social Media Push",
  "Booth-level Mobilization",
] as const;
export type CampaignType = (typeof CampaignType)[number];

const campaignBaseSchema = z.object({
  name: z.string().min(3).max(150),
  description: z.string().min(1),
  objective: z.string().optional(),
  // The Campaign Type (see CampaignType). Kept as a free string so legacy
  // values still validate; the UI offers the list.
  category: z.string().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  priority: z.enum(CampaignPriority).default("MEDIUM"),
  bannerUrl: z.string().url().optional(),
  // Optional: a campaign is created without them, and the real numbers are
  // allocated per area on the Targets/Budget screens. Still positive when
  // given — a target of zero is a typo, not a plan.
  totalTarget: z.number().int().positive().optional(),
  totalBudget: z.number().positive().optional(),
  expectedVolunteers: z.number().int().nonnegative().optional(),
  requiredDocuments: z.array(z.string()).default([]),
  // The areas this campaign runs in. Every Admin covering one of them is
  // assigned it, and each then accepts or declines — so the Super Admin
  // chooses WHERE the campaign applies rather than having to know which
  // Admin happens to hold which patch today.
  regionIds: z.array(z.string().min(1)).default([]),
  // Specific Admins, still accepted for callers that name people directly
  // (and for edits). Merged with whoever the areas resolve to.
  adminIds: z.array(z.string().min(1)).default([]),
});

export const createCampaignSchema = campaignBaseSchema.refine(
  (data) => data.endDate > data.startDate,
  { message: "endDate must be after startDate", path: ["endDate"] },
);
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = campaignBaseSchema.partial();
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

// ============================================================
// TARGET / BUDGET ALLOCATION
// ============================================================

export const createAllocationSchema = z.object({
  regionId: z.string().min(1),
  ownerUserId: z.string().min(1),
  target: z.number().int().positive(),
  allocatedBudget: z.number().positive(),
  deadline: z.coerce.date(),
  notes: z.string().optional(),
});
export type CreateAllocationDto = z.infer<typeof createAllocationSchema>;

export const subAllocateSchema = z.object({
  parentAllocationId: z.string().min(1),
  splits: z
    .array(
      z.object({
        regionId: z.string().min(1),
        ownerUserId: z.string().min(1),
        target: z.number().int().positive(),
        allocatedBudget: z.number().positive(),
        deadline: z.coerce.date(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
});
export type SubAllocateDto = z.infer<typeof subAllocateSchema>;

export const approveBudgetSchema = z.object({
  approvedBudget: z.number().nonnegative(),
});
export type ApproveBudgetDto = z.infer<typeof approveBudgetSchema>;

// ============================================================
// TASKS
// ============================================================

export const createTaskSchema = z.object({
  campaignId: z.string().min(1).optional(),
  allocationId: z.string().optional(),
  // The official ECI location: a Polling Station id. Its ancestry supplies
  // the Assembly Constituency, District and State, so those are never sent
  // separately — they could only disagree with each other if they were.
  pollingStationId: z.string().min(1).optional(),
  name: z.string().min(2).max(150),
  description: z.string().optional(),
  assignedToId: z.string().min(1),
  deadline: z.coerce.date(),
  priority: z.enum(TaskPriority).default("MEDIUM"),
});
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  description: z.string().optional(),
  deadline: z.coerce.date().optional(),
  priority: z.enum(TaskPriority).optional(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE", "CANCELLED"]).optional(),
  remarks: z.string().optional(),
});
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

// Creates a TaskBatch — the task record — without sending anything to any
// Cadre yet. Always awaits allocation: see TasksService.createBatch and
// allocateTaskSchema below (the actual "pick Cadres and send" step).
export const createTaskBatchSchema = z.object({
  name: z.string().min(2).max(150),
  objective: z.string().optional(),
  description: z.string().optional(),
  remarks: z.string().optional(),
  deadline: z.coerce.date(),
  priority: z.enum(TaskPriority).default("MEDIUM"),
  campaignId: z.string().optional(),
  pollingStationId: z.string().min(1).optional(),
  regionIds: z.array(z.string().min(1)).min(1, "Select at least one area"),
  attachmentUrls: z.array(z.string().url()).default([]),
});
export type CreateTaskBatchDto = z.infer<typeof createTaskBatchSchema>;

export const acknowledgeTaskSchema = z.object({
  acknowledgment: z.enum(["ACCEPTED", "DECLINED"]),
});
export type AcknowledgeTaskDto = z.infer<typeof acknowledgeTaskSchema>;

// An Admin allocating a Super-Admin-routed batch to their own Cadres — see
// TasksService.allocateToCadres. Either regionIds (broadcast to every active
// Cadre in those area(s)) or cadreIds (specific hand-picked Cadres) or both.
export const allocateTaskSchema = z
  .object({
    regionIds: z.array(z.string().min(1)).default([]),
    cadreIds: z.array(z.string().min(1)).default([]),
  })
  .refine((d) => d.regionIds.length > 0 || d.cadreIds.length > 0, {
    message: "Select at least one area or Cadre",
  });
export type AllocateTaskDto = z.infer<typeof allocateTaskSchema>;

// ============================================================
// POLLS
// ============================================================
// Same two-step shape as tasks: create the record (no send), then allocate
// it to Cadres (that's what actually sends it) — see PollsService.

// 2-3 options: capped by how many Quick Reply buttons a WhatsApp template
// can carry — see FYXO_TEMPLATES.POLL's doc comment.
export const createPollSchema = z.object({
  question: z.string().min(3).max(300),
  /**
   * The approved WhatsApp template to ask with. Its Quick Reply buttons ARE
   * the answers — Meta fixes button labels at approval time, so options
   * cannot be typed per poll; you pick a template that already offers the
   * ones you want ("Yes / No", "In Progress / Completed / Need Help").
   */
  templateName: z.string().min(1, "Choose a template"),
  templateLanguage: z.string().min(2).max(10).optional(),
  /** Hang this poll off a task, or leave unset for a standalone poll. */
  taskId: z.string().min(1).optional(),
  regionIds: z.array(z.string().min(1)).min(1, "Select at least one area"),
  deadline: z.coerce.date().optional(),
});
export type CreatePollDto = z.infer<typeof createPollSchema>;

// Same regionIds/cadreIds-or-both shape as allocateTaskSchema.
export const allocatePollSchema = z
  .object({
    regionIds: z.array(z.string().min(1)).default([]),
    cadreIds: z.array(z.string().min(1)).default([]),
  })
  .refine((d) => d.regionIds.length > 0 || d.cadreIds.length > 0, {
    message: "Select at least one area or Cadre",
  });
export type AllocatePollDto = z.infer<typeof allocatePollSchema>;


// ============================================================
// PER-ADMIN WHATSAPP TEMPLATE
// ============================================================
// A Super Admin records which already-approved WhatsApp template each Admin's
// own tasks go out with (and one for themselves); several Admins may share
// the same template. PoliOS cannot create or approve templates — this only
// points at a name that already exists in Fyxo/Meta, so a typo here surfaces
// as a failed send, not a validation error.
// What a {{n}} placeholder in a template is filled with. Deliberately a small
// closed set: every value must be single-line (a line break makes Meta reject
// the whole send, API.md §5) and available at send time without extra lookups.
export const TemplateVariableSource = [
  "CADRE_NAME",
  // The campaign a task belongs to. Added for the task_assigned_v2
  // template, whose {{2}} is the campaign name; a task filed against no
  // campaign renders an em dash rather than failing the send.
  "CAMPAIGN_NAME",
  "TASK_NAME",
  "DEADLINE",
  "PRIORITY",
  "ASSIGNED_BY",
] as const;
export type TemplateVariableSource = (typeof TemplateVariableSource)[number];

// What tapping a Quick Reply sends back. The first two are the built-in
// behaviours PoliOS already knew how to produce; CUSTOM_TEXT lets a Super
// Admin write their own wording, and NONE stays silent for a button whose
// answer is handled by the Fyxo flow itself.
export const ButtonReplyAction = ["TASK_DETAILS", "ADMIN_CONTACT", "CUSTOM_TEXT", "NONE"] as const;
export type ButtonReplyAction = (typeof ButtonReplyAction)[number];

export const templateButtonReplySchema = z
  .object({
    // The button's approved label, exactly as Meta has it — this is what
    // arrives on a tap, so it is the key the reply is looked up by.
    label: z.string().min(1).max(120),
    action: z.enum(ButtonReplyAction),
    /**
     * Extra wording to send with this button, added by hand.
     *
     * Valid alongside ANY action, not just CUSTOM_TEXT: it is appended to
     * whatever the action produces, so "send the task details AND tell them
     * to bring the register" is one button rather than a choice between
     * the two. With action NONE it becomes the whole reply.
     */
    text: z.string().max(1000).optional(),
  })
  .refine((b) => b.action !== "CUSTOM_TEXT" || (b.text && b.text.trim().length > 0), {
    message: "Write the message this button should send",
    path: ["text"],
  });
export type TemplateButtonReplyDto = z.infer<typeof templateButtonReplySchema>;

export const assignMessageTemplateSchema = z.object({
  // Meta's own naming rule for approved templates: lowercase letters,
  // digits and underscores only. Checked here so an obviously-wrong name
  // (e.g. "My Template") is caught before it can silently fail every send.
  templateName: z
    .string()
    .min(1, "Enter the approved template name")
    .max(100)
    .regex(/^[a-z0-9_]+$/, "Template names use lowercase letters, numbers and underscores only (e.g. polios_east)"),
  templateLanguage: z.string().min(2).max(10).default("en"),
  // The approved body copy, {{1}} included. Optional, and never sent —
  // it's only used to render what the Cadre reads into the Google Sheet log
  // and the preview on screen.
  templateBody: z.string().max(1000).optional(),
  // One entry per {{n}} the template declares, in order. Omitted or empty
  // keeps the default who/what/when order.
  templateVariables: z.array(z.enum(TemplateVariableSource)).max(10).optional(),
  // One entry per Quick Reply the template declares. Omitted keeps the
  // built-in behaviour for every button.
  templateButtons: z.array(templateButtonReplySchema).max(10).optional(),
});
export type AssignMessageTemplateDto = z.infer<typeof assignMessageTemplateSchema>;

// Shared by both Ask AI surfaces: the per-task dashboard (filters unused)
// and the global Communication & AI Insights dashboard (filters optional —
// whatever the Admin currently has the dashboard filtered to).
export const taskAnalyticsFiltersSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  districtId: z.string().optional(),
  constituencyId: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  taskType: z.enum(["BULK", "INDIVIDUAL"]).optional(),
});
export type TaskAnalyticsFiltersDto = z.infer<typeof taskAnalyticsFiltersSchema>;

export const askTaskAiSchema = z.object({
  question: z.string().min(3).max(500),
  filters: taskAnalyticsFiltersSchema.optional(),
});
export type AskTaskAiDto = z.infer<typeof askTaskAiSchema>;

export const progressUpdateSchema = z.object({
  completedForms: z.number().int().nonnegative().optional(),
  meetingsConducted: z.number().int().nonnegative().optional(),
  houseVisits: z.number().int().nonnegative().optional(),
  volunteersJoined: z.number().int().nonnegative().optional(),
  photos: z.array(z.string().url()).default([]),
  videos: z.array(z.string().url()).default([]),
  gpsLat: z.number().optional(),
  gpsLng: z.number().optional(),
  completionPercentage: z.number().int().min(0).max(100),
});
export type ProgressUpdateDto = z.infer<typeof progressUpdateSchema>;

// ============================================================
// EXPENSES
// ============================================================

export const createExpenseSchema = z.object({
  campaignId: z.string().min(1),
  allocationId: z.string().optional(),
  expenseType: z.enum(ExpenseType),
  amount: z.number().positive(),
  billUrl: z.string().url().optional(),
  description: z.string().optional(),
});
export type CreateExpenseDto = z.infer<typeof createExpenseSchema>;

export const decideExpenseSchema = z.object({
  rejectionReason: z.string().optional(),
});
export type DecideExpenseDto = z.infer<typeof decideExpenseSchema>;

// ============================================================
// ANNOUNCEMENTS
// ============================================================

export const createAnnouncementSchema = z.object({
  campaignId: z.string().optional(),
  targetLevels: z.array(z.enum(Role)).min(1),
  targetRegionIds: z.array(z.string()).default([]),
  messageType: z.enum(MessageType),
  content: z.string().min(1),
  mediaUrl: z.string().url().optional(),
});
export type CreateAnnouncementDto = z.infer<typeof createAnnouncementSchema>;

// ============================================================
// BULK WHATSAPP MESSAGING (via Fyxo Connect)
// ============================================================

export const BulkCampaignStatus = ["DRAFT", "SENDING", "SENT", "FAILED"] as const;
export type BulkCampaignStatus = (typeof BulkCampaignStatus)[number];

export const BulkRecipientStatus = ["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "OPTED_OUT"] as const;
export type BulkRecipientStatus = (typeof BulkRecipientStatus)[number];

// Select/deselect recipients for sending. Omitting both recipientIds and
// filter means "every recipient in the campaign" (select all / clear all).
// A filter always matches against the raw District/Constituency/Polling
// Station text stored on each recipient — see BulkMessagingService.
export const bulkRecipientSelectionSchema = z.object({
  selected: z.boolean(),
  recipientIds: z.array(z.string().min(1)).optional(),
  filter: z
    .object({
      district: z.string().optional(),
      constituency: z.string().optional(),
      booth: z.string().optional(),
    })
    .optional(),
});
export type BulkRecipientSelectionDto = z.infer<typeof bulkRecipientSelectionSchema>;

export const composeBulkMessageSchema = z.object({
  messageText: z.string().min(1).max(4096),
  mediaUrl: z.string().url().optional(),
  templateId: z.string().optional(),
});
export type ComposeBulkMessageDto = z.infer<typeof composeBulkMessageSchema>;

// ============================================================
// CITIZENS
// ============================================================

export const registerCitizenSchema = z.object({
  name: z.string().min(2).max(150),
  phone: z.string().min(10).max(15).optional(),
  address: z.string().optional(),
  regionId: z.string().min(1).optional(), // defaults to the submitter's own region
});
export type RegisterCitizenDto = z.infer<typeof registerCitizenSchema>;

// ============================================================
// GRIEVANCES
// ============================================================

// The categories offered in the UI. Kept identical to GRIEVANCE_CATEGORIES in
// whatsapp-conversation.service.ts so a grievance filed on the web and one
// filed over WhatsApp are filed under the same names and group together in
// reporting. Not an enum on the model: existing rows carry free text.
export const GrievanceCategory = [
  "Water Supply",
  "Roads",
  "Electricity",
  "Sanitation",
  "Other",
] as const;
export type GrievanceCategory = (typeof GrievanceCategory)[number];

export const submitGrievanceSchema = z.object({
  regionId: z.string().min(1),
  citizenId: z.string().min(1).optional(),
  category: z.string().min(1),
  description: z.string().min(1),
  // URLs returned by POST /grievances/attachments. Validated as URLs so a
  // caller can't smuggle a filesystem path in here.
  attachmentUrls: z.array(z.string().url()).default([]),
});
export type SubmitGrievanceDto = z.infer<typeof submitGrievanceSchema>;

export const resolveGrievanceSchema = z.object({
  resolutionNotes: z.string().min(1),
});
export type ResolveGrievanceDto = z.infer<typeof resolveGrievanceSchema>;

export const rejectGrievanceSchema = z.object({
  resolutionNotes: z.string().min(1),
});
export type RejectGrievanceDto = z.infer<typeof rejectGrievanceSchema>;

// Moving a grievance along the workflow. RESOLVED/REJECTED are terminal and
// require a note explaining the decision, which is why they also have their
// own endpoints; this one exists for the OPEN -> IN_PROGRESS review step.
export const updateGrievanceStatusSchema = z.object({
  status: z.enum(GrievanceStatus),
  resolutionNotes: z.string().min(1).optional(),
});
export type UpdateGrievanceStatusDto = z.infer<typeof updateGrievanceStatusSchema>;

// ============================================================
// EVENTS
// ============================================================

export const EventRsvpStatus = ["PENDING", "CONFIRMED", "DECLINED"] as const;
export type EventRsvpStatus = (typeof EventRsvpStatus)[number];

export const createEventSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().optional(),
  objective: z.string().optional(),
  location: z.string().optional(),
  organizer: z.string().optional(),
  instructions: z.string().optional(),
  remarks: z.string().optional(),
  expectedAttendees: z.number().int().nonnegative().optional(),
  attachmentUrls: z.array(z.string().url()).default([]),
  regionId: z.string().min(1),
  startAt: z.coerce.date(),
  endAt: z.coerce.date().optional(),
});
export type CreateEventDto = z.infer<typeof createEventSchema>;

export const addEventParticipantsSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
});
export type AddEventParticipantsDto = z.infer<typeof addEventParticipantsSchema>;

export const markAttendanceSchema = z.object({
  userId: z.string().min(1),
  attended: z.boolean(),
});
export type MarkAttendanceDto = z.infer<typeof markAttendanceSchema>;

export const updateEventRsvpSchema = z.object({
  userId: z.string().min(1),
  rsvpStatus: z.enum(["CONFIRMED", "DECLINED"]),
});
export type UpdateEventRsvpDto = z.infer<typeof updateEventRsvpSchema>;
