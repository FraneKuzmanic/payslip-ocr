import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ZoomableSourceViewport } from "./ZoomableSourceViewport";

const regions = [
  {
    fields: ["netoPlaca"],
    page: 1,
    corners: [
      { x: 0.1, y: 0.1 },
      { x: 0.3, y: 0.1 },
      { x: 0.3, y: 0.2 },
      { x: 0.1, y: 0.2 },
    ],
    origin: "model" as const,
  },
];

function renderViewport(onSelect?: (field: string) => void) {
  return render(
    <ZoomableSourceViewport
      ratio={0.8}
      overlaySafe
      regions={regions}
      page={1}
      activeField={null}
      interaction="popover"
      fieldValues={{ netoPlaca: "2298.97" }}
      lowConfidenceFields={[]}
      ungroundableFields={[]}
      unreadableFields={[]}
      editedFields={[]}
      onSelect={onSelect}
    >
      {() => <span />}
    </ZoomableSourceViewport>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ZoomableSourceViewport's popover (Task 09 D9)", () => {
  it("closes on Escape without taking focus it did not have", async () => {
    const { container } = renderViewport(vi.fn());
    fireEvent.click(container.querySelector("polygon")!);
    expect(screen.getByRole("dialog", { name: "Net pay" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the viewport when Escape closes it with focus inside", async () => {
    const { container } = renderViewport(vi.fn());
    fireEvent.click(container.querySelector("polygon")!);
    screen.getByRole("button", { name: "Close" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute("tabindex", "-1");
  });

  it("routes Edit to onSelect with the region's path", async () => {
    const onSelect = vi.fn();
    const { container } = renderViewport(onSelect);
    fireEvent.click(container.querySelector("polygon")!);

    await userEvent.click(screen.getByRole("button", { name: "Edit this field" }));

    expect(onSelect).toHaveBeenCalledWith("netoPlaca");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
