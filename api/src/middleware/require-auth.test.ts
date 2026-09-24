import { randomUUID } from "node:crypto";
import express, { type Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext, Authenticator } from "../auth/authenticator.js";
import type { Database } from "../database.types.js";
import { errorHandler } from "./error-handler.js";
import { authenticated, requireAuth } from "./require-auth.js";

const userId = randomUUID();

/** Stands in for a real Supabase client; no test here ever calls it. */
const client = {} as SupabaseClient<Database>;

function appWith(authenticator: Authenticator): Express {
  const app = express();

  app.get(
    "/protected",
    requireAuth(authenticator),
    authenticated((_req, res, auth) => {
      res.json({ userId: auth.userId });
    }),
  );

  app.use(errorHandler);
  return app;
}

const accepting: Authenticator = {
  authenticate: (token) =>
    Promise.resolve<AuthContext | null>(token === "good-token" ? { userId, client } : null),
};

const rejecting: Authenticator = { authenticate: () => Promise.resolve(null) };

const failing: Authenticator = {
  authenticate: () => Promise.reject(new Error("supabase unreachable")),
};

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const response = await request(appWith(accepting)).get("/protected");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "unauthorized" } });
  });

  it("rejects an Authorization scheme that is not Bearer", async () => {
    const response = await request(appWith(accepting))
      .get("/protected")
      .set("Authorization", "Basic good-token");

    expect(response.status).toBe(401);
  });

  it("rejects a Bearer header carrying no token", async () => {
    const response = await request(appWith(accepting))
      .get("/protected")
      .set("Authorization", "Bearer   ");

    expect(response.status).toBe(401);
  });

  it("rejects a token the authenticator refuses", async () => {
    const response = await request(appWith(rejecting))
      .get("/protected")
      .set("Authorization", "Bearer expired-token");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: "unauthorized" } });
  });

  it("treats a verification outage as a server fault, not a rejected credential", async () => {
    const response = await request(appWith(failing))
      .get("/protected")
      .set("Authorization", "Bearer good-token");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "internal_error" } });
  });

  it("passes the proven user id to the handler", async () => {
    const response = await request(appWith(accepting))
      .get("/protected")
      .set("Authorization", "Bearer good-token");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId });
  });

  it("accepts a lowercase bearer scheme", async () => {
    const response = await request(appWith(accepting))
      .get("/protected")
      .set("Authorization", "bearer good-token");

    expect(response.status).toBe(200);
  });
});

describe("authenticated", () => {
  it("fails loudly when a route was wired without requireAuth", async () => {
    const app = express();
    app.get(
      "/unguarded",
      authenticated((_req, res, auth) => {
        res.json({ userId: auth.userId });
      }),
    );
    app.use(errorHandler);

    const response = await request(app).get("/unguarded");

    // A wiring bug must not be able to masquerade as a credential problem.
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "internal_error" } });
  });

  it("forwards a rejected handler promise to the error handler", async () => {
    const app = express();
    app.get(
      "/boom",
      requireAuth(accepting),
      authenticated(() => Promise.reject(new Error("handler failed"))),
    );
    app.use(errorHandler);

    const response = await request(app).get("/boom").set("Authorization", "Bearer good-token");

    expect(response.status).toBe(500);
  });
});
