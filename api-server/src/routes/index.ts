import { Router } from "express";
import { createV1Router } from "./v1.js";

export function createVersionedApiRouter() {
  const router = Router();

  router.use("/v1", createV1Router());

  return router;
}
