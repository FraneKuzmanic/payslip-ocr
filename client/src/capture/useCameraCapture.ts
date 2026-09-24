import { useEffect, useState } from "react";

/**
 * A touch-first pointer is the practical signal that `<input capture>` will actually open a camera.
 * Desktop browsers parse the attribute and then ignore it, which is what made "Scan payslip" and
 * "Choose file" open the identical file dialog there.
 *
 * The query is re-read on change because a detachable tablet flips between the two.
 */
const COARSE_POINTER = "(pointer: coarse)";

function coarsePointer(): boolean {
  // No matchMedia (jsdom, very old browsers): keep the camera path rather than hiding it. Offering
  // an extra button is harmless; withholding capture on a real phone would be a genuine regression.
  return window.matchMedia?.(COARSE_POINTER).matches ?? true;
}

export function useCameraCapture(): boolean {
  const [available, setAvailable] = useState(coarsePointer);

  useEffect(() => {
    const query = window.matchMedia?.(COARSE_POINTER);
    if (!query) return;

    const update = () => setAvailable(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return available;
}
