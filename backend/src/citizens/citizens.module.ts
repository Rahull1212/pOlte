import { Module } from "@nestjs/common";
import { CitizensController } from "./citizens.controller";
import { CitizensService } from "./citizens.service";
import { RegionsModule } from "../regions/regions.module";

@Module({
  imports: [RegionsModule],
  controllers: [CitizensController],
  providers: [CitizensService],
  exports: [CitizensService],
})
export class CitizensModule {}
