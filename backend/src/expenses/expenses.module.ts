import { Module } from "@nestjs/common";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";
import { AllocationsModule } from "../allocations/allocations.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [AllocationsModule, NotificationsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
