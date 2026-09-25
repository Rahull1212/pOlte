import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as XLSX from "xlsx";
import { BulkRecipientSelectionDto, ComposeBulkMessageDto } from "../shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/types";
import { FyxoConnectService } from "../fyxo-connect/fyxo-connect.service";

const HEADER_ALIASES: Record<string, "phone" | "name" | "district" | "constituency" | "booth"> = {
  phonenumber: "phone",
  phone: "phone",
  mobile: "phone",
  mobilenumber: "phone",
  contactnumber: "phone",
  whatsappnumber: "phone",
  name: "name",
  contactname: "name",
  fullname: "name",
  district: "district",
  constituency: "constituency",
  assemblyconstituency: "constituency",
  ac: "constituency",
  booth: "booth",
  pollingstation: "booth",
  villagebooth: "booth",
  village: "booth",
};

// A 10-digit Indian mobile number (optionally prefixed with the 91 country
// code, with or without a leading +) starting 6-9 — matches how phone
// numbers are already stored elsewhere in this app (see the seed data:
// plain 10-digit strings, no country code).
const PHONE_REGEX = /^[6-9]\d{9}$/;

function normalizeHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizePhone(raw: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

function personalize(template: string, name: string | null | undefined): string {
  return template.replace(/\{\{\s*name\s*\}\}/gi, name?.trim() || "there");
}

interface ParsedRow {
  name: string | null;
  rawPhone: string;
  phone: string;
  isValidPhone: boolean;
  isDuplicate: boolean;
  districtName: string | null;
  constituencyName: string | null;
  boothName: string | null;
}

@Injectable()
export class BulkMessagingService {
  private readonly logger = new Logger(BulkMessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fyxoConnect: FyxoConnectService,
  ) {}

  /**
   * Parses an uploaded Excel file into rows, tolerant of header naming
   * (Phone/Phone Number/Mobile, etc. — see HEADER_ALIASES), validates each
   * phone number, and flags duplicates within THIS upload (by normalized
   * phone, first occurrence wins). Column headers that don't match any
   * known alias are ignored, not errored on, since a contact list may
   * legitimately carry extra columns.
   */
  private parseExcel(buffer: Buffer): ParsedRow[] {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer" });
    } catch {
      throw new BadRequestException("Could not read this file — please upload a valid .xlsx or .xls file");
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) throw new BadRequestException("The uploaded file has no sheets");

    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rawRows.length === 0) {
      throw new BadRequestException("The uploaded file has no data rows");
    }

    const seenPhones = new Set<string>();
    const rows: ParsedRow[] = [];

    for (const rawRow of rawRows) {
      const mapped: Record<string, string> = {};
      for (const [header, value] of Object.entries(rawRow)) {
        const key = HEADER_ALIASES[normalizeHeader(header)];
        if (key && !mapped[key]) mapped[key] = String(value ?? "").trim();
      }

      const rawPhone = mapped.phone ?? "";
      if (!rawPhone) continue; // skip fully blank rows (e.g. trailing empty Excel rows)

      const phone = normalizePhone(rawPhone);
      const isValidPhone = PHONE_REGEX.test(phone);

      rows.push({
        name: mapped.name || null,
        rawPhone,
        phone,
        isValidPhone,
        isDuplicate: false,
        districtName: mapped.district || null,
        constituencyName: mapped.constituency || null,
        boothName: mapped.booth || null,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException(
        "No Phone Number column was recognized in this file — expected a column named Phone Number, Phone, or Mobile",
      );
    }

    // Duplicate detection runs after collecting all rows so it only flags
    // the 2nd+ occurrence of a given valid, normalized phone number.
    for (const row of rows) {
      if (!row.isValidPhone) continue;
      if (seenPhones.has(row.phone)) {
        row.isDuplicate = true;
      } else {
        seenPhones.add(row.phone);
      }
    }

    return rows;
  }

  /**
   * Best-effort match of each row's District/Constituency/Polling Station text
   * against the real Region table — most specific first. A row that
   * doesn't match anything still keeps its raw text (used for filtering)
   * and just has no regionId; this is expected for external contact lists
   * that won't always spell area names exactly the way Region records do.
   */
  private async resolveRegionIds(rows: ParsedRow[]): Promise<(string | null)[]> {
    const regions = await this.prisma.region.findMany({ select: { id: true, name: true, type: true } });
    const byTypeAndName = new Map<string, string>();
    for (const r of regions) {
      byTypeAndName.set(`${r.type}:${r.name.toLowerCase()}`, r.id);
    }

    return rows.map((row) => {
      if (row.boothName) {
        const id = byTypeAndName.get(`BOOTH:${row.boothName.toLowerCase()}`);
        if (id) return id;
      }
      if (row.constituencyName) {
        const id = byTypeAndName.get(`CONSTITUENCY:${row.constituencyName.toLowerCase()}`);
        if (id) return id;
      }
      if (row.districtName) {
        const id = byTypeAndName.get(`DISTRICT:${row.districtName.toLowerCase()}`);
        if (id) return id;
      }
      return null;
    });
  }

  async uploadExcel(fileBuffer: Buffer, name: string | undefined, user: AuthenticatedUser) {
    const rows = this.parseExcel(fileBuffer);
    const regionIds = await this.resolveRegionIds(rows);

    const validCount = rows.filter((r) => r.isValidPhone && !r.isDuplicate).length;
    const invalidCount = rows.filter((r) => !r.isValidPhone).length;
    const duplicateCount = rows.filter((r) => r.isValidPhone && r.isDuplicate).length;

    const campaign = await this.prisma.bulkMessageCampaign.create({
      data: {
        name: name?.trim() || `Bulk Message – ${new Date().toISOString().slice(0, 10)}`,
        createdById: user.id,
        totalContacts: rows.length,
        validCount,
        invalidCount,
        duplicateCount,
      },
    });

    await this.prisma.bulkRecipient.createMany({
      data: rows.map((row, i) => ({
        campaignId: campaign.id,
        name: row.name,
        phone: row.phone,
        rawPhone: row.rawPhone,
        districtName: row.districtName,
        constituencyName: row.constituencyName,
        boothName: row.boothName,
        regionId: regionIds[i],
        isValidPhone: row.isValidPhone,
        isDuplicate: row.isDuplicate,
        // Never pre-select an invalid or duplicate contact for sending.
        selected: row.isValidPhone && !row.isDuplicate,
      })),
    });

    return {
      campaignId: campaign.id,
      totalContacts: rows.length,
      validCount,
      invalidCount,
      duplicateCount,
    };
  }

  async list(_user: AuthenticatedUser) {
    return this.prisma.bulkMessageCampaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } } },
    });
  }

  private async getCampaignOrThrow(id: string) {
    const campaign = await this.prisma.bulkMessageCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return campaign;
  }

  async getCampaign(id: string) {
    const campaign = await this.prisma.bulkMessageCampaign.findUnique({
      where: { id },
      include: { createdBy: { select: { name: true } } },
    });
    if (!campaign) throw new NotFoundException("Campaign not found");
    return { ...campaign, fyxoConfigured: this.fyxoConnect.isConfigured };
  }

  listRecipients(campaignId: string) {
    return this.prisma.bulkRecipient.findMany({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Distinct District/Constituency/Polling Station combinations among this campaign's recipients, for the cascading filter UI. */
  async getFilterOptions(campaignId: string) {
    const rows = await this.prisma.bulkRecipient.findMany({
      where: { campaignId, isValidPhone: true, isDuplicate: false },
      select: { districtName: true, constituencyName: true, boothName: true },
      distinct: ["districtName", "constituencyName", "boothName"],
    });
    return rows;
  }

  async updateSelection(campaignId: string, dto: BulkRecipientSelectionDto) {
    const campaign = await this.getCampaignOrThrow(campaignId);
    if (campaign.status !== "DRAFT") {
      throw new BadRequestException("Recipients can only be changed while the campaign is still a draft");
    }

    const where: Record<string, unknown> = {
      campaignId,
      isValidPhone: true,
      isDuplicate: false,
    };
    if (dto.recipientIds && dto.recipientIds.length > 0) {
      where.id = { in: dto.recipientIds };
    } else if (dto.filter) {
      if (dto.filter.district) where.districtName = dto.filter.district;
      if (dto.filter.constituency) where.constituencyName = dto.filter.constituency;
      if (dto.filter.booth) where.boothName = dto.filter.booth;
    }

    const result = await this.prisma.bulkRecipient.updateMany({ where, data: { selected: dto.selected } });
    return { updated: result.count };
  }

  async composeMessage(campaignId: string, dto: ComposeBulkMessageDto) {
    const campaign = await this.getCampaignOrThrow(campaignId);
    if (campaign.status !== "DRAFT") {
      throw new BadRequestException("The message can only be edited while the campaign is still a draft");
    }
    const updated = await this.prisma.bulkMessageCampaign.update({
      where: { id: campaignId },
      data: { messageText: dto.messageText, mediaUrl: dto.mediaUrl, templateId: dto.templateId },
    });
    // Include fyxoConfigured for parity with getCampaign() — the frontend
    // caches this mutation's response over the campaign query cache, and a
    // missing field here would otherwise make the "Fyxo Connect not
    // configured" banner flicker incorrectly after saving the message.
    return { ...updated, fyxoConfigured: this.fyxoConnect.isConfigured };
  }

  /**
   * Dispatches to every selected, valid, non-duplicate recipient via
   * FyxoConnectService — the single seam that talks to Fyxo Connect. See
   * FyxoConnectService's doc comment for what's simulated vs real today.
   */
  async send(campaignId: string) {
    const campaign = await this.getCampaignOrThrow(campaignId);
    if (campaign.status !== "DRAFT") {
      throw new BadRequestException("This campaign has already been sent");
    }
    if (!campaign.messageText) {
      throw new BadRequestException("Write a message before sending");
    }

    const recipients = await this.prisma.bulkRecipient.findMany({
      where: { campaignId, selected: true, isValidPhone: true, isDuplicate: false },
    });
    if (recipients.length === 0) {
      throw new BadRequestException("Select at least one recipient before sending");
    }

    await this.prisma.bulkMessageCampaign.update({ where: { id: campaignId }, data: { status: "SENDING" } });

    const results = await this.fyxoConnect.sendBulk(
      recipients.map((r) => ({ phone: r.phone, name: r.name ?? undefined, message: personalize(campaign.messageText!, r.name) })),
    );
    const resultByPhone = new Map(results.map((r) => [r.phone, r]));

    await this.prisma.$transaction(
      recipients.map((r) => {
        const result = resultByPhone.get(r.phone);
        if (result?.success) {
          return this.prisma.bulkRecipient.update({
            where: { id: r.id },
            data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId },
          });
        }
        return this.prisma.bulkRecipient.update({
          where: { id: r.id },
          data: { status: "FAILED", failedReason: result?.error ?? "Send failed" },
        });
      }),
    );

    const sentCount = results.filter((r) => r.success).length;
    const failedCount = results.length - sentCount;

    await this.prisma.bulkMessageCampaign.update({
      where: { id: campaignId },
      data: { status: sentCount > 0 ? "SENT" : "FAILED", sentAt: new Date() },
    });

    return { sentCount, failedCount, fyxoConfigured: this.fyxoConnect.isConfigured };
  }

  async getDashboard(campaignId: string) {
    const campaign = await this.getCampaignOrThrow(campaignId);

    const [total, sent, delivered, read, failed, pending, optedOut] = await Promise.all([
      this.prisma.bulkRecipient.count({ where: { campaignId } }),
      this.prisma.bulkRecipient.count({ where: { campaignId, status: { in: ["SENT", "DELIVERED", "READ"] } } }),
      this.prisma.bulkRecipient.count({ where: { campaignId, status: { in: ["DELIVERED", "READ"] } } }),
      this.prisma.bulkRecipient.count({ where: { campaignId, status: "READ" } }),
      this.prisma.bulkRecipient.count({ where: { campaignId, status: "FAILED" } }),
      this.prisma.bulkRecipient.count({ where: { campaignId, status: "PENDING", selected: true } }),
      this.prisma.bulkRecipient.count({ where: { campaignId, status: "OPTED_OUT" } }),
    ]);
    const invalidNumbers = campaign.invalidCount;

    const recipients = await this.prisma.bulkRecipient.findMany({
      where: { campaignId },
      orderBy: { createdAt: "asc" },
    });

    return {
      campaign: { ...campaign, fyxoConfigured: this.fyxoConnect.isConfigured },
      kpis: { totalRecipients: total, sent, delivered, read, failed, pending, invalidNumbers, optedOut },
      recipients,
    };
  }

  /**
   * Applies a delivery-status update from Fyxo Connect's webhook. Event
   * names are the confirmed ones from API.md §10 (message.sent/delivered/
   * read/failed, contact.opted_out) — matched case-insensitively with a
   * couple of bare-word fallbacks in case a status string ever arrives
   * instead of a full event name. No-ops (logs, doesn't throw) on anything
   * unrecognized or uncorrelated, so a shape surprise never turns into a
   * 500 back to Fyxo Connect.
   */
  async handleStatusWebhook(providerMessageId: string, eventRaw: string, timestamp?: string): Promise<boolean> {
    const recipient = await this.prisma.bulkRecipient.findFirst({ where: { providerMessageId } });
    if (!recipient) {
      this.logger.warn(`Fyxo Connect webhook: no recipient found for providerMessageId=${providerMessageId}`);
      return false;
    }

    const event = eventRaw.toLowerCase().trim();
    const at = timestamp ? new Date(timestamp) : new Date();
    const data: Record<string, unknown> = {};

    if (event === "message.delivered" || event === "delivered") {
      data.status = "DELIVERED";
      data.deliveredAt = at;
    } else if (event === "message.read" || event === "read" || event === "seen") {
      data.status = "READ";
      data.readAt = at;
    } else if (event === "message.failed" || event === "failed" || event === "error" || event === "undelivered") {
      data.status = "FAILED";
      data.failedReason = "Reported failed by Fyxo Connect";
    } else if (event === "contact.opted_out" || event === "opted_out" || event === "opt_out" || event === "blocked") {
      data.status = "OPTED_OUT";
    } else if (event === "message.sent" || event === "sent" || event === "accepted" || event === "queued") {
      data.status = "SENT";
      data.sentAt = at;
    } else {
      this.logger.warn(`Fyxo Connect webhook: unrecognized event "${eventRaw}" for providerMessageId=${providerMessageId}`);
      return false;
    }

    await this.prisma.bulkRecipient.update({ where: { id: recipient.id }, data });
    return true;
  }
}
