import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { HttpError } from "../middleware/error-handler.js";
import { validateSourceFile } from "./source-file.js";

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);

describe("validateSourceFile", () => {
  it.each([
    [JPEG, "image/jpeg"],
    [PNG, "image/png"],
    [isoBmff("heic"), "image/heic"],
    [isoBmff("mif1"), "image/heif"],
  ] as const)("accepts %s bytes as %s", async (bytes, contentType) => {
    await expect(validateSourceFile(file(bytes))).resolves.toMatchObject({ bytes, contentType });
  });

  it("accepts a PDF and reports its sniffed type", async () => {
    await expect(validateSourceFile(file(await pdf(1)))).resolves.toMatchObject({
      contentType: "application/pdf",
    });
  });

  it("reports a PDF's page count, measured from the bytes", async () => {
    await expect(validateSourceFile(file(await pdf(3)))).resolves.toMatchObject({ pageCount: 3 });
  });

  it.each([JPEG, PNG])("reports one page for an image", async (bytes) => {
    await expect(validateSourceFile(file(bytes))).resolves.toMatchObject({ pageCount: 1 });
  });

  it.each([
    [Buffer.from("MZ executable"), "payslip.jpg", "image/jpeg"],
    [Buffer.from("plain text"), "payslip.txt", "text/plain"],
    [isoBmff("hevc"), "payslip.heic", "image/heic"],
  ])("rejects unsupported bytes", async (bytes, originalname, mimetype) => {
    await expectHttpError(
      validateSourceFile(file(bytes, originalname, mimetype)),
      415,
      "unsupported_media_type",
    );
  });

  it("rejects an encrypted PDF", async () => {
    const bytes = Buffer.from(
      (await pdf(1)).toString("latin1").replace(/trailer\s*\n?<</, "trailer\n<< /Encrypt 1 0 R "),
      "latin1",
    );
    await expectHttpError(validateSourceFile(file(bytes)), 422, "pdf_encrypted");
  });

  it("rejects a PDF over the configured page limit", async () => {
    await expectHttpError(validateSourceFile(file(await pdf(11))), 422, "pdf_too_many_pages");
  });

  it("rejects a truncated PDF", async () => {
    await expectHttpError(validateSourceFile(file(Buffer.from("%PDF-1.7"))), 422, "pdf_unreadable");
  });

  it("requires a file", async () => {
    await expectHttpError(validateSourceFile(undefined), 400, "file_required");
  });

  it("caps a long filename and falls back for a blank one", async () => {
    await expect(validateSourceFile(file(JPEG, "a".repeat(400)))).resolves.toMatchObject({
      originalFilename: "a".repeat(255),
    });
    await expect(validateSourceFile(file(JPEG, "  "))).resolves.toMatchObject({
      originalFilename: "payslip",
    });
  });

  it("preserves a UTF-8 Croatian filename", async () => {
    await expect(validateSourceFile(file(JPEG, "račun-ožujak.jpg"))).resolves.toMatchObject({
      originalFilename: "račun-ožujak.jpg",
    });
  });
});

function file(
  buffer: Buffer,
  originalname = "payslip.jpg",
  mimetype = "image/jpeg",
): Express.Multer.File {
  return { buffer, size: buffer.length, originalname, mimetype } as Express.Multer.File;
}

function isoBmff(brand: string): Buffer {
  return Buffer.concat([
    Buffer.from([0, 0, 0, 32]),
    Buffer.from("ftyp"),
    Buffer.from(brand),
    Buffer.alloc(20),
  ]);
}

async function pdf(pageCount: number): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pageCount; page += 1) document.addPage();
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

async function expectHttpError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ status, code });
  await expect(promise).rejects.toBeInstanceOf(HttpError);
}
