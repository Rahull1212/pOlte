import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { PrismaService } from "../../prisma/prisma.service";
import { AuthenticatedUser } from "../../auth/types";

/**
 * Writes one AuditLog row per mutating request (POST/PATCH/DELETE) that
 * succeeds. Applied globally in AppModule; failures never throw — audit
 * logging must never break the actual request.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method: string = request.method;

    if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((response: any) => {
        const user: AuthenticatedUser | undefined = request.user;
        if (!user) return;

        const entityType = request.route?.path?.split("/")?.[2] ?? "unknown";
        const entityId = response?.id ?? request.params?.id ?? "unknown";

        this.prisma.auditLog
          .create({
            data: {
              userId: user.id,
              action: `${method} ${request.route?.path ?? request.url}`,
              entityType,
              entityId,
              metadata: { body: request.body },
            },
          })
          .catch(() => undefined);
      }),
    );
  }
}
