import type { Request, RequestHandler, Response } from "express";
import type { AuthContext, Authenticator } from "../auth/authenticator.js";
import { HttpError } from "./error-handler.js";

const AUTH_CONTEXT = "authContext";
const BEARER = /^Bearer[ ]+(.+)$/i;

/**
 * Rejects any request that does not carry a verifiable access token. Mounted on the
 * `/api/sessions` and `/api/payslips` prefixes rather than per route, so a route added later is
 * protected by construction rather than by remembering.
 */
export function requireAuth(authenticator: Authenticator): RequestHandler {
  return (req, res, next) => {
    const token = bearerToken(req.headers.authorization);
    if (token === null) {
      next(new HttpError(401, "unauthorized"));
      return;
    }

    authenticator
      .authenticate(token)
      .then((auth) => {
        if (auth === null) {
          next(new HttpError(401, "unauthorized"));
          return;
        }
        res.locals[AUTH_CONTEXT] = auth;
        next();
      })
      // A verification outage is a server fault, not a rejected credential: 500, never 401.
      .catch(next);
  };
}

/**
 * Passes the proven identity to the handler as an argument. This is what makes `AuthContext`
 * impossible to fake — there is no optional `req.auth` a future route could reach for and
 * assert non-null (PRD §9.1).
 */
export function authenticated(
  handler: (req: Request, res: Response, auth: AuthContext) => Promise<void> | void,
): RequestHandler {
  return (req, res, next) => {
    const auth = res.locals[AUTH_CONTEXT] as AuthContext | undefined;
    if (auth === undefined) {
      // Only reachable by wiring a route without requireAuth. That is a bug in the wiring, so
      // it must be loud — answering 401 would disguise it as a credential problem.
      next(new Error("authenticated() used on a route that is not behind requireAuth"));
      return;
    }

    try {
      Promise.resolve(handler(req, res, auth)).catch(next);
    } catch (error) {
      next(error);
    }
  };
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = BEARER.exec(header.trim());
  const token = match?.[1]?.trim();
  return token === undefined || token === "" ? null : token;
}
