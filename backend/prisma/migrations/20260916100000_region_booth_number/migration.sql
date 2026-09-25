-- Booth number as the campaign knows it ("142", "12A"). Text rather than an
-- integer because real booth numbers carry letters and leading zeros, and
-- optional because only booths have one. Uniqueness is per-parent and
-- enforced in RegionsService — every Mandal numbers its booths from 1, so a
-- global constraint would be wrong.
-- AlterTable
ALTER TABLE "Region" ADD COLUMN     "number" TEXT;
