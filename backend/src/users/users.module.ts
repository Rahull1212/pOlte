import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
import { UserDashboardService } from "./user-dashboard.service";
import { RegionsModule } from "../regions/regions.module";

@Module({
  imports: [RegionsModule],
  controllers: [UsersController],
  providers: [UsersService, UserDashboardService],
  exports: [UsersService],
})
export class UsersModule {}
