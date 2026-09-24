import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom 30 ships `HTMLDialogElement` and the right default styles, but implements none of the
 * element's behaviour: `showModal` and `close` are simply absent, so any component that opens a
 * modal throws on import into a test. This stub toggles the `open` attribute, which is all the
 * default stylesheet needs to make the dialog visible to Testing Library queries.
 *
 * It gives back only visibility. The top layer, the focus trap, the inert background and the
 * Escape handling are real-browser behaviour and are provable nowhere else — the reason this
 * project uses a native `<dialog>` in the first place.
 */
function showModalStub(this: HTMLDialogElement) {
  this.setAttribute("open", "");
}

function closeStub(this: HTMLDialogElement) {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
}

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = showModalStub;
  HTMLDialogElement.prototype.close = closeStub;
}

afterEach(() => {
  cleanup();
});
