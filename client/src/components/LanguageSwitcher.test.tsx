import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTranslation } from "react-i18next";
import { beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";

function Harness() {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t("home.title")}</h1>
      <LanguageSwitcher />
    </>
  );
}

describe("LanguageSwitcher", () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("hr");
  });

  it("switches visible copy between Croatian and English", async () => {
    render(<Harness />);
    expect(screen.getByRole("heading")).toHaveTextContent("Digitalizacija platnih lista");

    await userEvent.click(screen.getByRole("button", { name: "en" }));

    expect(screen.getByRole("heading")).toHaveTextContent("Payslip digitization");
  });

  it("persists the chosen language to localStorage", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "en" }));

    expect(localStorage.getItem("i18nextLng")).toBe("en");
  });
});
