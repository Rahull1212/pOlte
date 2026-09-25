import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient, Region } from "@prisma/client";

const prisma = new PrismaClient();

interface ConstituencyData {
  no: string;
  name: string;
  district: string;
}

/**
 * Replaces the administrative area tree (State > District > Mandal > Booth)
 * with the Election Commission's own (State > District > Assembly
 * Constituency > Polling Station).
 *
 * The Mandal layer was never official — it is a revenue unit that appears
 * nowhere in an electoral roll, so a task located by Mandal could not be
 * tied back to a polling station. Districts kept their names because the
 * ECI uses the same revenue districts; only the layer beneath them changes.
 *
 * Every row that points at an area (users, citizens, grievances, events,
 * allocations, bulk recipients) is repointed to the nearest equivalent in
 * the new tree *before* the old rows are deleted — User.regionId is
 * non-nullable, so there is no moment at which a user has no area.
 *
 * Idempotent: re-running finds the ECI tree already present and only tops
 * up whatever is missing.
 *
 *   npx ts-node prisma/import-eci-regions.ts
 */

/**
 * How many placeholder polling stations to create per constituency.
 *
 * Real Telangana has ~35,000, published only as per-AC PDFs on the CEO
 * portal — there is no ECI API to fetch them from. These stand in so the
 * task flow is usable end to end; replace them with a real per-AC list
 * when one is exported from the portal.
 */
const PLACEHOLDER_STATIONS_PER_AC = 5;

const STATION_VENUES = [
  "Zilla Parishad High School",
  "Government Primary School",
  "Mandal Parishad Primary School",
  "Government Junior College",
  "Anganwadi Centre",
];

async function main() {
  const raw = readFileSync(join(__dirname, "data", "telangana-assembly-constituencies.json"), "utf-8");
  const { constituencies } = JSON.parse(raw) as { constituencies: ConstituencyData[] };

  const before = await prisma.region.findMany({ select: { id: true } });

  // ---- Build the ECI tree ------------------------------------------------
  // Every area the new tree keeps — whether just created or reused because
  // it already carried the right name and place. Anything *not* in here is
  // administrative leftover and gets deleted at the end, so a District that
  // survives by name must be recorded here or it would be thrown away with
  // the Mandals beneath it.
  const keep = new Set<string>();
  const remember = <T extends Region>(region: T) => {
    keep.add(region.id);
    return region;
  };

  const state = remember(await findOrCreate({ name: "Telangana", type: "STATE", parentId: null, number: null }));

  const districtNames = [...new Set(constituencies.map((c) => c.district))].sort();
  const districts = new Map<string, Region>();
  for (const name of districtNames) {
    districts.set(name, remember(await findOrCreate({ name, type: "DISTRICT", parentId: state.id, number: null })));
  }

  const constituencyRows: Region[] = [];
  const booths: Region[] = [];
  for (const ac of constituencies) {
    const district = districts.get(ac.district)!;
    const constituency = remember(
      await findOrCreate({ name: ac.name, type: "CONSTITUENCY", parentId: district.id, number: ac.no }),
    );
    constituencyRows.push(constituency);

    for (let i = 1; i <= PLACEHOLDER_STATIONS_PER_AC; i += 1) {
      booths.push(
        remember(
          await findOrCreate({
            name: `${STATION_VENUES[(i - 1) % STATION_VENUES.length]}, ${ac.name} — Room ${i}`,
            type: "BOOTH",
            parentId: constituency.id,
            number: String(i),
          }),
        ),
      );
    }
  }

  console.log(
    `ECI tree: 1 state, ${districts.size} districts, ${constituencyRows.length} constituencies, ${booths.length} polling stations`,
  );

  // ---- Repoint everything still on an old area ---------------------------
  const staleIds = before.map((r) => r.id).filter((id) => !keep.has(id));
  if (staleIds.length === 0) {
    console.log("No administrative areas left to replace.");
    return;
  }

  // A Super Admin belongs at the State, an Admin runs a Constituency, a
  // Cadre works a polling station — spread round-robin, since which dummy
  // Cadre lands on which station carries no meaning.
  await repointUsers("SUPER_ADMIN", staleIds, [state]);
  await repointUsers("ADMIN", staleIds, constituencyRows.length > 0 ? constituencyRows : [state]);
  await repointUsers("CADRE", staleIds, booths);

  for (const [label, repoint] of [
    ["citizens", (ids: string[], to: string) => prisma.citizen.updateMany({ where: { regionId: { in: ids } }, data: { regionId: to } })],
    ["grievances", (ids: string[], to: string) => prisma.grievance.updateMany({ where: { regionId: { in: ids } }, data: { regionId: to } })],
    ["events", (ids: string[], to: string) => prisma.event.updateMany({ where: { regionId: { in: ids } }, data: { regionId: to } })],
    ["allocations", (ids: string[], to: string) => prisma.targetAllocation.updateMany({ where: { regionId: { in: ids } }, data: { regionId: to } })],
    ["bulk recipients", (ids: string[], to: string) => prisma.bulkRecipient.updateMany({ where: { regionId: { in: ids } }, data: { regionId: to } })],
  ] as const) {
    const { count } = await repoint(staleIds, booths[0]?.id ?? state.id);
    if (count > 0) console.log(`Repointed ${count} ${label}`);
  }

  // targetRegionIds is a plain String[] with no FK, so stale ids would
  // linger silently — clear them rather than leave batches referring to
  // areas that no longer exist.
  const batches = await prisma.taskBatch.findMany({ select: { id: true, targetRegionIds: true } });
  for (const batch of batches) {
    const kept = batch.targetRegionIds.filter((id) => !staleIds.includes(id));
    if (kept.length !== batch.targetRegionIds.length) {
      await prisma.taskBatch.update({ where: { id: batch.id }, data: { targetRegionIds: kept } });
    }
  }

  // ---- Delete the old tree, deepest first --------------------------------
  // Children before parents, or the self-referencing FK blocks the delete.
  let remaining = staleIds;
  while (remaining.length > 0) {
    const leaves = await prisma.region.findMany({
      where: { id: { in: remaining }, children: { none: {} } },
      select: { id: true },
    });
    if (leaves.length === 0) {
      console.warn(`Stopped with ${remaining.length} area(s) still referenced — nothing else can be deleted.`);
      break;
    }
    await prisma.region.deleteMany({ where: { id: { in: leaves.map((l) => l.id) } } });
    const deleted = new Set(leaves.map((l) => l.id));
    remaining = remaining.filter((id) => !deleted.has(id));
  }
  console.log(`Removed ${staleIds.length - remaining.length} administrative area(s).`);
  // Tasks that pointed at a deleted area were nulled by ON DELETE SET NULL.
}

/** Round-robins every user of one role off the old areas and onto the new ones. */
async function repointUsers(role: "SUPER_ADMIN" | "ADMIN" | "CADRE", staleIds: string[], targets: Region[]) {
  if (targets.length === 0) return;
  const users = await prisma.user.findMany({ where: { role, regionId: { in: staleIds } }, select: { id: true } });
  for (const [i, user] of users.entries()) {
    await prisma.user.update({ where: { id: user.id }, data: { regionId: targets[i % targets.length].id } });
  }
  if (users.length > 0) console.log(`Repointed ${users.length} ${role} user(s)`);
}

async function findOrCreate(data: { name: string; type: Region["type"]; parentId: string | null; number: string | null }) {
  const existing = await prisma.region.findFirst({
    where: { name: data.name, type: data.type, parentId: data.parentId },
  });
  return existing ?? prisma.region.create({ data });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
