import type { z } from "zod";
import {
  Assertion,
  Auth,
  Body,
  EnvironmentSchema,
  FolderConfigSchema,
  HttpMethod,
  RequestSchema,
} from "./schema";

export type TruSpecRequest = z.infer<typeof RequestSchema>;
export type TruSpecFolderConfig = z.infer<typeof FolderConfigSchema>;
export type TruSpecEnvironment = z.infer<typeof EnvironmentSchema>;
export type TruSpecAssertion = z.infer<typeof Assertion>;
export type TruSpecAuth = z.infer<typeof Auth>;
export type TruSpecBody = z.infer<typeof Body>;
export type TruSpecMethod = z.infer<typeof HttpMethod>;
