import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface DistrictData {
  district: string;
  mandals: string[];
  uncertain?: boolean;
  note?: string;
}

/**
 * Idempotently loads Telangana's real district/mandal structure into the
 * Region table. Safe to re-run: every level is find-or-create by
 * (name, type, parentId), so it will not duplicate the demo
 * Hyderabad/Warangal districts (or their demo mandals) created by seed.ts —
 * it fills in whatever's missing and leaves existing rows untouched.
 *
 * Source data lives in prisma/data/telangana-regions.json, compiled from
 * public sources rather than hand-typed — see that file's `uncertain`/`note`
 * fields for districts whose mandal list needs a manual double-check
 * against an official source before relying on it operationally.
 */
async function main() {
  const dataPath = join(__dirname, "data", "telangana-regions.json");
  const districts: DistrictData[] = JSON.parse(readFileSync(dataPath, "utf-8"));

  let state = await prisma.region.findFirst({ where: { name: "Telangana", type: "STATE" } });
  if (!state) {
    state = await prisma.region.create({ data: { name: "Telangana", type: "STATE" } });
    console.log("Created state: Telangana");
  }

  let districtsCreated = 0;
  let mandalsCreated = 0;
  const flagged: string[] = [];

  for (const d of districts) {
    let district = await prisma.region.findFirst({
      where: { name: d.district, type: "DISTRICT", parentId: state.id },
    });
    if (!district) {
      district = await prisma.region.create({
        data: { name: d.district, type: "DISTRICT", parentId: state.id },
      });
      districtsCreated += 1;
    }

    if (d.uncertain) {
      flagged.push(`${d.district}: ${d.note ?? "no note given"}`);
    }

    for (const mandalName of d.mandals) {
      const existing = await prisma.region.findFirst({
        where: { name: mandalName, type: "MANDAL", parentId: district.id },
      });
      if (!existing) {
        await prisma.region.create({
          data: { name: mandalName, type: "MANDAL", parentId: district.id },
        });
        mandalsCreated += 1;
      }
    }
  }

  console.log(`Districts in source: ${districts.length} (created ${districtsCreated} new)`);
  console.log(`Mandals created: ${mandalsCreated}`);
  if (flagged.length > 0) {
    console.log("\nFlagged for manual review:");
    flagged.forEach((f) => console.log(`  - ${f}`));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
