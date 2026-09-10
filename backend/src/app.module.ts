import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { RegionsModule } from "./regions/regions.module";
import { CampaignsModule } from "./campaigns/campaigns.module";
import { AllocationsModule } from "./allocations/allocations.module";
import { TasksModule } from "./tasks/tasks.module";
import { PollsModule } from "./polls/polls.module";
import { ExpensesModule } from "./expenses/expenses.module";
import { CommunicationModule } from "./communication/communication.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AiModule } from "./ai/ai.module";
import { QueueModule } from "./queue/queue.module";
import { CitizensModule } from "./citizens/citizens.module";
import { GrievancesModule } from "./grievances/grievances.module";
import { EventsModule } from "./events/events.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";
import { AuditModule } from "./audit/audit.module";
import { BulkMessagingModule } from "./bulk-messaging/bulk-messaging.module";
import { FyxoAgentModule } from "./fyxo-agent/fyxo-agent.module";
import { GoogleSheetsModule } from "./google-sheets/google-sheets.module";
import { MessageTemplatesModule } from "./message-templates/message-templates.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { AuditLogInterceptor } from "./common/interceptors/audit-log.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RegionsModule,
    CampaignsModule,
    AllocationsModule,
    TasksModule,
    PollsModule,
    ExpensesModule,
    CommunicationModule,
    NotificationsModule,
    AnalyticsModule,
    AiModule,
    QueueModule,
    CitizensModule,
    GrievancesModule,
    EventsModule,
    WhatsAppModule,
    AuditModule,
    BulkMessagingModule,
    FyxoAgentModule,
    GoogleSheetsModule,
    MessageTemplatesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
