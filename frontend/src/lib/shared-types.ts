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

export const CampaignStatus = ["DRAFT", "UPCOMING", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
export type CampaignStatus = (typeof CampaignStatus)[number];

export const CampaignPriority = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type CampaignPriority = (typeof CampaignPriority)[number];

export const TaskStatus = ["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE", "CANCELLED"] as const;
export type TaskStatus = (typeof TaskStatus)[number];

export const TaskPriority = ["LOW", "MEDIUM", "HIGH"] as const;
export type TaskPriority = (typeof TaskPriority)[number];

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

// ============================================================
// USERS
// ============================================================

export const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(10).max(15),
  email: z.string().email().optional(),
  password: z.string().min(6),
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
  campaignId: z.string().min(1),
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
  citizenId: z.string().min(1),
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

export const createEventSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().optional(),
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
