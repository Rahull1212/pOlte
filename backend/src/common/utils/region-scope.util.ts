import { PrismaService } from "../../prisma/prisma.service";

/**
 * Returns true if `targetRegionId` is the same as `scopeRegionId` or lives
 * anywhere underneath it in the Region tree (State -> District -> ... -> Booth).
 * Used to enforce that a District Head can only touch their own district's
 * subtree, a Mandal Head only their mandal, etc.
 */
export async function isRegionWithinScope(
  prisma: PrismaService,
  scopeRegionId: string,
  targetRegionId: string,
): Promise<boolean> {
  if (scopeRegionId === targetRegionId) return true;

  let current = await prisma.region.findUnique({
    where: { id: targetRegionId },
    select: { parentId: true },
  });

  // Walk up the tree from the target region toward the root, checking for a match.
  // Hierarchy is at most ~6 levels deep, so this is cheap.
  let guard = 0;
  while (current?.parentId && guard < 20) {
    if (current.parentId === scopeRegionId) return true;
    current = await prisma.region.findUnique({
      where: { id: current.parentId },
      select: { parentId: true },
    });
    guard += 1;
  }
  return false;
}
