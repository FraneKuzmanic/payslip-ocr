import pino from "pino";
import { config } from "./config.js";

// PRD §9.4: never log credentials, payslip contents or signed URLs.
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.file",
      "*.bytes",
      "*.content",
      "*.raw",
      "*.signedUrl",
    ],
    remove: true,
  },
});
