import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SourceRegion } from "@payslip/shared";
import i18n from "../i18n";
import { SourceStrip } from "./SourceStrip";
import { stripView } from "./stripGeometry";

const region: SourceRegion = {
  fields: ["netoPlaca"],
  page: 1,
  origin: "model",
  corners: [
    { x: 0.4, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.52 },
    { x: 0.4, y: 0.52 },
  ],
};
beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(343);
});
afterEach(() => vi.restoreAllMocks());
function mount(overlaySafe = true, activeField = "netoPlaca") {
  return render(
    <SourceStrip
      ratio={0.7}
      overlaySafe={overlaySafe}
      regions={[region, { ...region, fields: ["brutoPlaca"] }]}
      page={1}
      activeField={activeField}
      editedFields={[]}
    >
      {(width) => <img alt="crop" style={{ width }} />}
    </SourceStrip>,
  );
}
it("positions the page around one outline and makes the strip inert", () => {
  const { container } = mount();
  const view = stripView({ minX: 0.4, maxX: 0.5, minY: 0.5, maxY: 0.52 }, 0.7, {
    width: 343,
    height: 64,
  })!;
  const surface = screen.getByAltText("crop").parentElement!;
  expect(surface).toHaveStyle({ transform: `translate(${view.x}px, ${view.y}px)` });
  expect(parseFloat(surface.style.width)).toBeCloseTo(view.surfaceWidth);
  expect(container.querySelectorAll("polygon")).toHaveLength(1);
  expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  expect(container.firstElementChild).toHaveAttribute("inert");
});
it.each([
  [false, "netoPlaca"],
  [true, "employeeName"],
] as const)("shows a note for safe=%s field=%s", (safe, field) => {
  const { container } = mount(safe, field);
  expect(screen.getByText("This value has no highlight on the payslip.")).toBeInTheDocument();
  expect(container.querySelector("polygon")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
});
