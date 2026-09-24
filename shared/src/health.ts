export const HEALTH_PATH = "/api/health" as const;

export interface HealthResponse {
  status: "ok";
  uptimeSeconds: number;
}
