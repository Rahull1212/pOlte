import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Writes uploaded files to the same `uploads/` directory the rest of PoliOS
 * uses (served at /uploads by main.ts) and returns public URLs for them.
 *
 * This exists because the grievance uploader needs Word documents, and the
 * inline uploaders in tasks/events derive the file extension from
 * `mimetype.split("/")[1]` — which yields the whole
 * "vnd.openxmlformats-officedocument.wordprocessingml.document" string for a
 * .docx. An explicit type -> extension map is the only way to accept Office
 * formats, so the logic moved here rather than being copied a third time.
 *
 * Stored names are random UUIDs, never the caller's filename: the uploaded
 * name is untrusted input and would otherwise let a caller pick where the
 * file lands or what it shadows.
 */
const UPLOADS_DIR = join(process.cwd(), "uploads");

export interface StoredAttachment {
  url: string;
  /** The name the user chose, kept only for display — never used as a path. */
  originalName: string;
  size: number;
}

/**
 * The file types a grievance may carry as evidence, mapped to the extension
 * each is stored under. Anything absent is refused: this map *is* the
 * allowlist, so adding a type is a deliberate edit rather than an oversight.
 */
export const GRIEVANCE_ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB per file
export const MAX_ATTACHMENT_COUNT = 5;

/** Human-readable list for error messages and UI hints. */
export const ALLOWED_ATTACHMENT_LABEL = "PDF, JPG, PNG, DOC or DOCX";

export async function storeAttachments(
  files: Express.Multer.File[],
  allowedTypes: Record<string, string>,
): Promise<StoredAttachment[]> {
  // Validate everything before writing anything, so a rejected third file
  // doesn't leave the first two orphaned on disk.
  for (const file of files) {
    if (!allowedTypes[file.mimetype]) {
      throw new BadRequestException(
        `"${file.originalname}" is a ${file.mimetype} file. Attachments must be ${ALLOWED_ATTACHMENT_LABEL}.`,
      );
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException(
        `"${file.originalname}" is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB.`,
      );
    }
  }

  const publicUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
  await mkdir(UPLOADS_DIR, { recursive: true });

  return Promise.all(
    files.map(async (file) => {
      const filename = `${randomUUID()}.${allowedTypes[file.mimetype]}`;
      await writeFile(join(UPLOADS_DIR, filename), file.buffer);
      return {
        url: `${publicUrl}/uploads/${filename}`,
        originalName: file.originalname,
        size: file.size,
      };
    }),
  );
}
