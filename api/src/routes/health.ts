import { Router } from "express";
import type { HealthResponse } from "@payslip/shared";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const body: HealthResponse = { status: "ok", uptimeSeconds: Math.floor(process.uptime()) };
  res.json(body);
});
