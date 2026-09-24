import { describe, expect, it } from "vitest";
import { parseQuantity } from "./quantity.js";

describe("quantity parsing", () => {
  it.each([
    ["3,000", "3.000"],
    ["1.000", "1.000"],
    ["2,092", "2.092"],
    ["-1,000", "-1.000"],
    [" 12,500 ", "12.500"],
  ])("reads a three-decimal quantity %j as the decimal %j", (raw, expected) => {
    expect(parseQuantity(raw)).toBe(expected);
  });

  it.each([
    // Three-decimal coefficients.
    ["1,000", "1.000"], // F01
    ["0,135", "0.135"], // A03
    ["0,065", "0.065"],
    // Two-decimal coefficients.
    ["1,75", "1.75"],
    ["6,25", "6.25"],
    // Hours.
    ["15,5", "15.5"], // A02
    ["212", "212"], // A01
    ["128,00", "128.00"], // B01
  ])("reads the payslip value %j as %j", (raw, expected) => {
    expect(parseQuantity(raw)).toBe(expected);
  });

  it.each([
    ["1,00", "1.00"],
    ["2", "2"],
    ["1.234,5", "1234.5"],
    ["1,234.50", "1234.50"],
    ["1.000.000", "1000000"],
    ["", null],
    ["kom", null],
    [null, null],
    [undefined, null],
  ])("reads %j exactly as money would, as %j", (raw, expected) => {
    expect(parseQuantity(raw)).toBe(expected);
  });
});
