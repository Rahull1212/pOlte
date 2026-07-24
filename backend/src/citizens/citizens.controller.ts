import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { registerCitizenSchema, RegisterCitizenDto } from "../shared-types";
import { CitizensService } from "./citizens.service";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";

@Controller("citizens")
export class CitizensController {
  constructor(private readonly citizensService: CitizensService) {}

  @Post()
  register(
    @Body(new ZodValidationPipe(registerCitizenSchema)) dto: RegisterCitizenDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.citizensService.register(dto, user);
  }

  @Get()
  findMany(@CurrentUser() user: AuthenticatedUser, @Query("regionId") regionId?: string) {
    return this.citizensService.findMany(user, { regionId });
  }

  @Get(":id")
  findById(@Param("id") id: string) {
    return this.citizensService.findById(id);
  }
}
