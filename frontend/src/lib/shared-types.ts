// Single source of truth for enums + Zod DTO schemas used across this
// frontend. A matching copy lives at backend/src/shared-types.ts — backend
// and frontend are fully independent projects (no shared npm package), so
// keep the two files in sync by hand when either changes.

import { z } from "zod";

// ============================================================
// ENUMS
// ============================================================

// Three-tier role model. "Area" (which Region a SUPER_ADMIN/ADMIN manages) is
// carried on the user's regionId, not the role — an ADMIN's regionId can be
// a District, Constituency, Mandal, or Booth node interchangeably.
export const Role = ["SUPER_ADMIN", "ADMIN", "CADRE"] as const;
export type Role = (typeof Role)[number];

export const RegionType = ["STATE", "DISTRICT", "CONSTITUENCY", "MANDAL", "BOOTH"] as const;
export type RegionType = (typeof RegionType)[number];

export const Gender = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"] as const;
export type Gender = (typeof Gender)[number];

export const CampaignStatus = ["DRAFT", "UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type CampaignStatus = (typeof CampaignStatus)[number];

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
  // so the backend generates one server-side for a Cadre instead.
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

const campaignBaseSchema = z.object({
  name: z.string().min(3).max(150),
  description: z.string().min(1),
  objective: z.string().optional(),
  category: z.string().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  priority: z.enum(CampaignPriority).default("MEDIUM"),
  bannerUrl: z.string().url().optional(),
  totalTarget: z.number().int().positive(),
  totalBudget: z.number().positive(),
  expectedVolunteers: z.number().int().nonnegative().optional(),
  requiredDocuments: z.array(z.string()).default([]),
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
// Cadre yet. Always awaits allocation: see allocateTaskSchema below (the
// actual "pick Cadres and send" step).
export const createTaskBatchSchema = z.object({
  name: z.string().min(2).max(150),
  objective: z.string().optional(),
  description: z.string().optional(),
  additionalDetails: z.string().optional(),
  remarks: z.string().optional(),
  deadline: z.coerce.date(),
  priority: z.enum(TaskPriority).default("MEDIUM"),
  campaignId: z.string().optional(),
  regionIds: z.array(z.string().min(1)).min(1, "Select at least one area"),
  attachmentUrls: z.array(z.string().url()).default([]),
});
export type CreateTaskBatchDto = z.infer<typeof createTaskBatchSchema>;

export const acknowledgeTaskSchema = z.object({
  acknowledgment: z.enum(["ACCEPTED", "DECLINED"]),
});
export type AcknowledgeTaskDto = z.infer<typeof acknowledgeTaskSchema>;

// An Admin allocating a Super-Admin-routed batch to their own Cadres. Either
// regionIds (broadcast to every active Cadre in those area(s)) or cadreIds
// (specific hand-picked Cadres) or both.
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
  options: z.array(z.string().min(1).max(60)).min(2, "Add at least 2 options").max(3, "A poll can have at most 3 options"),
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
// GOOGLE SHEET (task message log)
// ============================================================
// A Super Admin connects the sheet from the app itself, so the URL is
// whatever they pasted out of the browser — GoogleSheetsService.connect
// extracts the spreadsheet id from it (or accepts a bare id), which is why
// this only checks it's non-empty rather than trying to match a URL shape
// here and rejecting a link Google would have accepted.
export const connectSheetSchema = z.object({
  spreadsheetUrl: z.string().min(1, "Paste the Google Sheet link"),
  // Defaults to "Task Messages" server-side; the tab is created if the
  // spreadsheet doesn't have one by that name yet.
  tabName: z.string().max(100).optional(),
});
export type ConnectSheetDto = z.infer<typeof connectSheetSchema>;

// The service-account key file, pasted whole. Only checked for "is there
// something here" — the real validation (is it JSON, is it a service
// account, is the key intact) happens in GoogleSheetsService.saveServiceAccount,
// which can give a specific, fixable message per failure instead of one
// generic schema error.
export const saveGoogleCredentialsSchema = z.object({
  serviceAccountJson: z.string().min(1, "Paste the contents of the JSON key file"),
});
export type SaveGoogleCredentialsDto = z.infer<typeof saveGoogleCredentialsSchema>;

// The one-time OAuth app registration from Google Cloud. An application
// identity, not a user's credentials — set once per install, then the Super
// Admin only ever clicks "Connect Google Sheets".
export const saveGoogleOAuthAppSchema = z.object({
  clientId: z.string().min(1, "Paste the OAuth Client ID"),
  clientSecret: z.string().min(1, "Paste the OAuth Client secret"),
});
export type SaveGoogleOAuthAppDto = z.infer<typeof saveGoogleOAuthAppSchema>;

// Picking a sheet from the signed-in account's own Drive — an id straight
// from the picker list, so unlike connectSheetSchema there's no URL to parse.
export const selectSpreadsheetSchema = z.object({
  spreadsheetId: z.string().min(1),
  tabName: z.string().max(100).optional(),
});
export type SelectSpreadsheetDto = z.infer<typeof selectSpreadsheetSchema>;

// ============================================================
// PER-ADMIN WHATSAPP TEMPLATE
// ============================================================
// A Super Admin records which already-approved WhatsApp template each Admin's
// own tasks go out with (and one for themselves); several Admins may share
// the same template. PoliOS cannot create or approve templates — this only
// points at a name that already exists in Fyxo/Meta, so a typo here surfaces
// as a failed send, not a validation error.
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
});
export type AssignMessageTemplateDto = z.infer<typeof assignMessageTemplateSchema>;

// Shared by both Ask AI surfaces: the per-task dashboard (filters unused)
// and the global Communication & AI Insights dashboard (filters optional —
// whatever the Admin currently has the dashboard filtered to).
export const taskAnalyticsFiltersSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  districtId: z.string().optional(),
  mandalId: z.string().optional(),
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

export const bulkRecipientSelectionSchema = z.object({
  selected: z.boolean(),
  recipientIds: z.array(z.string().min(1)).optional(),
  filter: z
    .object({
      district: z.string().optional(),
      constituency: z.string().optional(),
      mandal: z.string().optional(),
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

export const submitGrievanceSchema = z.object({
  regionId: z.string().min(1),
  citizenId: z.string().min(1).optional(),
  category: z.string().min(1),
  description: z.string().min(1),
  photos: z.array(z.string().url()).default([]),
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
