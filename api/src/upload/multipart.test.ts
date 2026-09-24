import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import { errorHandler } from "../middleware/error-handler.js";
import { sourceFileUpload } from "./multipart.js";

function app() {
  const server = express();
  server.post("/", sourceFileUpload, (req, res) => {
    res.json({ hasFile: req.file !== undefined });
  });
  server.use(errorHandler);
  return server;
}

describe("sourceFileUpload", () => {
  it("maps an oversized file to file_too_large", async () => {
    const response = await request(app())
      .post("/")
      .attach("file", Buffer.alloc(config.MAX_UPLOAD_BYTES + 1), "payslip.jpg");

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: { code: "file_too_large" } });
  });

  it("maps a wrong field name to file_required", async () => {
    const response = await request(app())
      .post("/")
      .attach("wrong", Buffer.from("x"), "payslip.jpg");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "file_required" } });
  });

  it("maps multiple files to file_required", async () => {
    const response = await request(app())
      .post("/")
      .attach("file", Buffer.from("x"), "one.jpg")
      .attach("file", Buffer.from("x"), "two.jpg");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "file_required" } });
  });

  it("maps an extra text field to file_required", async () => {
    const response = await request(app()).post("/").field("userId", "forged");

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "file_required" } });
  });

  it("passes one small file to the next handler", async () => {
    const response = await request(app())
      .post("/")
      .attach("file", Buffer.from("small"), "payslip.jpg");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasFile: true });
  });
});
