import { Router } from "express";
import authRouter from "../modules/auth.js";
import { createUserRouter } from "../modules/user.js";
import matchmakingRouter from "../modules/matchmaking.js";
import roomRouter from "../modules/room.js";
import progressionRouter from "../modules/progression.js";
import {
  platformRouter,
} from "../modules/platform.js";
import socialRouter from "../modules/social.js";
import rankingRouter from "../modules/ranking.js";
import preferencesRouter from "../modules/preferences.js";

export function createV1Router() {
  const router = Router();

  router.get("/", (_request, response) => {
    response.json({
      ok: true,
      service: "bop-api-server",
      version: "v1",
      timestamp: new Date().toISOString(),
    });
  });

  router.use("/auth", authRouter);
  router.use("/user", createUserRouter());
  router.use("/matchmaking", matchmakingRouter);
  router.use("/room", roomRouter);
  router.use("/progression", progressionRouter);
  router.use("/platform", platformRouter);
  router.use("/social", socialRouter);
  router.use("/ranking", rankingRouter);
  router.use("/preferences", preferencesRouter);

  return router;
}
