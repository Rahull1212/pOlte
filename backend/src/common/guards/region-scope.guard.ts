import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthenticatedUser } from "../../auth/types";
import { isRegionWithinScope } from "../utils/region-scope.util";

/**
 * Defense-in-depth check: if the request carries a `regionId` (route param,
 * query, or body), the caller's own region must be that region or an
 * ancestor of it. SUPER_ADMIN always passes. Routes with no regionId in the
 * payload are not affected here — the finer-grained "you may only touch your
 * own allocation/task" rules live in the relevant service.
 */
@Injectable()
export class RegionScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) return false;
    if (user.role === "SUPER_ADMIN") return true;

    const candidateRegionId: string | undefined =
      request.params?.regionId ?? request.query?.regionId ?? request.body?.regionId;

    if (!candidateRegionId) return true; // nothing to check here

    const withinScope = await isRegionWithinScope(this.prisma, user.regionId, candidateRegionId);
    if (!withinScope) {
      throw new ForbiddenException("Region is outside your organizational scope");
    }
    return true;
  }
}
