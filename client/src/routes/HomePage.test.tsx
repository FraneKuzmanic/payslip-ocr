import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the translated heading", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Payslip digitization");
  });
});
