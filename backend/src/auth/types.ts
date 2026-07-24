import { Role } from "../shared-types";

export interface JwtPayload {
  sub: string; // user id
  role: Role;
  regionId: string;
}

export interface AuthenticatedUser {
  id: string;
  role: Role;
  regionId: string;
  name: string;
}
