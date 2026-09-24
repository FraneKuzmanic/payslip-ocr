export type Section = "seller" | "buyer" | "document" | "vat" | "items";

export const SECTION_COLOURS: Record<Section, string> = {
  seller: "#7c3aed",
  buyer: "#0f766e",
  document: "#1d4ed8",
  vat: "#a21caf",
  items: "#15803d",
};

const FIELD_LABEL_KEYS = {
  sellerName: "review.fields.sellerName",
  sellerAddress: "review.fields.sellerAddress",
  sellerOib: "review.fields.sellerOib",
  buyerName: "review.fields.buyerName",
  buyerAddress: "review.fields.buyerAddress",
  buyerOib: "review.fields.buyerOib",
  documentNumber: "review.fields.documentNumber",
  issueDate: "review.fields.issueDate",
  issueTime: "review.fields.issueTime",
  subtotal: "review.fields.subtotal",
  total: "review.fields.total",
  currency: "review.fields.currency",
  paymentMethod: "review.fields.paymentMethod",
  jir: "review.fields.jir",
  zki: "review.fields.zki",
  rate: "review.fields.rate",
  taxableBase: "review.fields.taxableBase",
  vatAmount: "review.fields.vatAmount",
  description: "review.fields.description",
  quantity: "review.fields.quantity",
  unitPrice: "review.fields.unitPrice",
} as const;

/**
 * The translation key naming a canonical field path, keyed by its leaf so `vatBreakdown.0.rate`
 * and `items.2.total` resolve like their top-level namesakes. Returns null for a path this UI has
 * no label for, so a caller falls back rather than rendering a raw key.
 */
export function fieldLabelKey(
  fieldPath: string,
): (typeof FIELD_LABEL_KEYS)[keyof typeof FIELD_LABEL_KEYS] | null {
  const leaf = fieldPath.split(".").at(-1) ?? "";
  return leaf in FIELD_LABEL_KEYS ? FIELD_LABEL_KEYS[leaf as keyof typeof FIELD_LABEL_KEYS] : null;
}

export function sectionOf(fieldPath: string): Section | null {
  if (fieldPath.startsWith("vatBreakdown.")) return "vat";
  if (fieldPath.startsWith("items.")) return "items";
  if (["sellerName", "sellerAddress", "sellerOib"].includes(fieldPath)) return "seller";
  if (["buyerName", "buyerAddress", "buyerOib"].includes(fieldPath)) return "buyer";
  if (
    [
      "documentNumber",
      "issueDate",
      "issueTime",
      "subtotal",
      "total",
      "currency",
      "paymentMethod",
      "jir",
      "zki",
    ].includes(fieldPath)
  )
    return "document";
  return null;
}
