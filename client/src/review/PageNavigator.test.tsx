import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { LoadedPdf } from "./pdfDocument";
import { PageNavigator } from "./PageNavigator";

function pdf(numPages = 2): LoadedPdf {
  return {
    numPages,
    viewportOf: vi.fn(async () => ({ width: 595, height: 842 })),
    render: vi.fn(() => ({ completed: Promise.resolve(), cancel: vi.fn() })),
    destroy: vi.fn(),
  };
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
});
it.each([true, false])("omits navigation for one page, wide=%s", (wide) => {
  render(<PageNavigator document={pdf(1)} page={1} onChange={vi.fn()} wide={wide} />);
  expect(screen.queryByRole("navigation")).toBeNull();
});
it("shows a desktop nav with the current page and allows page selection", async () => {
  const onChange = vi.fn();
  render(<PageNavigator document={pdf()} page={1} onChange={onChange} wide />);
  const nav = screen.getByRole("navigation", { name: "Pages" });
  expect(within(nav).getAllByRole("button")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
  expect(onChange).toHaveBeenCalledWith(2);
  expect(screen.queryByRole("tablist")).toBeNull();
});
it("opens a phone sheet and returns focus to the pill after selection or Escape", async () => {
  const onChange = vi.fn();
  render(<PageNavigator document={pdf()} page={1} onChange={onChange} wide={false} />);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(onChange).toHaveBeenCalledWith(2);
  const pill = screen.getByRole("button", { name: "Page 1 of 2" });
  await userEvent.click(pill);
  expect(screen.getByRole("dialog", { name: "Choose a page" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(pill).toHaveFocus();
  await userEvent.click(pill);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(pill).toHaveFocus();
});
it("cancels thumbnail painting on unmount", async () => {
  const cancel = vi.fn();
  const document = pdf();
  document.render = vi.fn(() => ({ completed: new Promise<void>(() => {}), cancel }));
  const { unmount } = render(
    <PageNavigator document={document} page={1} onChange={vi.fn()} wide />,
  );
  await waitFor(() => expect(document.render).toHaveBeenCalledTimes(2));
  unmount();
  expect(cancel).toHaveBeenCalledTimes(2);
});
