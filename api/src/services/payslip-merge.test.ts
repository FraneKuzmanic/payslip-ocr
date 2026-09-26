import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";
import convert from "heic-convert";
import { describe, expect, it, vi } from "vitest";
import { MergeSourceError, combineSources } from "./payslip-merge.js";

vi.mock("heic-convert", () => ({ default: vi.fn(async () => jpeg(200, 100)) }));

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** One JPEG marker segment, its length counting the two length bytes. */
function segment(marker: number, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]),
    body,
  ]);
}

/** A 16-bit big-endian value as four hex digits. */
function word(value: number): string {
  return value.toString(16).padStart(4, "0");
}

/**
 * A JPEG of markers only: pdf-lib's `embedJpg` reads the frame header and never decodes pixels,
 * and `exifr` reads the APP1 segment.
 */
function jpeg(width: number, height: number, orientation?: number): Buffer {
  const parts: Buffer[] = [Buffer.from("ffd8", "hex")];
  if (orientation !== undefined) {
    // A big-endian TIFF header, then IFD0 with one entry: Orientation (0x0112), SHORT, count 1.
    const tiff = `4d4d002a00000008 0001 0112 0003 00000001 ${word(orientation)}0000 00000000`;
    const exif = Buffer.from(tiff.replaceAll(" ", ""), "hex");
    parts.push(segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "binary"), exif])));
  }
  // SOF0: 8-bit samples, the height and width, then three components.
  const frame = `08 ${word(height)} ${word(width)} 03 011100 021100 031100`;
  parts.push(segment(0xc0, Buffer.from(frame.replaceAll(" ", ""), "hex")));
  parts.push(Buffer.from("ffd9", "hex"));
  return Buffer.concat(parts);
}

/** One page per size, so page order is observable from the combined document's page sizes. */
async function pdf(...sizes: [number, number][]): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const size of sizes) document.addPage(size);
  return Buffer.from(await document.save());
}

async function pages(bytes: Buffer) {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => ({
    ...page.getSize(),
    rotation: page.getRotation().angle,
  }));
}

async function firstPageText(bytes: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const content = await (await (await task.promise).getPage(1)).getTextContent();
    return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
  } finally {
    await task.destroy();
  }
}

describe("combineSources (plan 11 D9)", () => {
  it("keeps every page of every PDF, in the given order", async () => {
    const combined = await combineSources([
      { bytes: await pdf([100, 200], [110, 210]), contentType: "application/pdf" },
      { bytes: await pdf([300, 400]), contentType: "application/pdf" },
    ]);

    expect(combined.pageCount).toBe(3);
    expect((await pages(combined.bytes)).map(({ width }) => width)).toEqual([100, 110, 300]);
  });

  it("gives an image one page whose long edge is A4's, keeping its aspect ratio", async () => {
    const combined = await combineSources([
      { bytes: await pdf([595, 842]), contentType: "application/pdf" },
      { bytes: jpeg(1200, 1600), contentType: "image/jpeg" },
    ]);

    const [, image] = await pages(combined.bytes);
    expect(combined.pageCount).toBe(2);
    expect(image?.height).toBeCloseTo(842);
    expect(image?.width).toBeCloseTo(631.5);
  });

  it("embeds a PNG", async () => {
    const combined = await combineSources([{ bytes: PNG, contentType: "image/png" }]);

    expect(await pages(combined.bytes)).toEqual([{ width: 842, height: 842, rotation: 0 }]);
  });

  it.each([
    [6, 90],
    [3, 180],
    [8, 270],
    [1, 0],
    [undefined, 0],
  ])("turns EXIF orientation %s into a %s° page rotation", async (orientation, rotation) => {
    const combined = await combineSources([
      { bytes: jpeg(200, 100, orientation), contentType: "image/jpeg" },
    ]);

    expect((await pages(combined.bytes))[0]?.rotation).toBe(rotation);
  });

  it("keeps a PDF page's own rotation", async () => {
    const document = await PDFDocument.create();
    document.addPage([200, 100]).setRotation(degrees(90));
    const bytes = Buffer.from(await document.save());

    const combined = await combineSources([{ bytes, contentType: "application/pdf" }]);

    expect((await pages(combined.bytes))[0]?.rotation).toBe(90);
  });

  it("decrypts a permissions-only PDF, so its copied page keeps its text (D1)", async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([300, 300]).drawText("OBRACUN PLACE", { x: 20, y: 150, size: 18, font });
    document.encrypt({
      userPassword: "",
      ownerPassword: "owner",
      permissions: { modifying: false },
    });
    const encrypted = Buffer.from(await document.save());
    expect((await PDFDocument.load(encrypted, { ignoreEncryption: true })).isEncrypted).toBe(true);

    const combined = await combineSources([
      { bytes: encrypted, contentType: "application/pdf" },
      { bytes: PNG, contentType: "image/png" },
    ]);

    expect(combined.pageCount).toBe(2);
    expect(await firstPageText(combined.bytes)).toContain("OBRACUN PLACE");
  });

  it.each(["image/heic", "image/heif"] as const)(
    "converts %s to JPEG before embedding it",
    async (contentType) => {
      vi.mocked(convert).mockClear();

      const combined = await combineSources([{ bytes: Buffer.from("heic"), contentType }]);

      expect(convert).toHaveBeenCalledOnce();
      expect(vi.mocked(convert).mock.calls[0]?.[0]).toMatchObject({ format: "JPEG" });
      expect(await pages(combined.bytes)).toEqual([{ width: 842, height: 421, rotation: 0 }]);
    },
  );

  it.each(["application/pdf", "image/png", "image/jpeg"] as const)(
    "reports an undecodable %s as a MergeSourceError",
    async (contentType) => {
      await expect(
        combineSources([{ bytes: Buffer.from("not a document"), contentType }]),
      ).rejects.toBeInstanceOf(MergeSourceError);
    },
  );
});
