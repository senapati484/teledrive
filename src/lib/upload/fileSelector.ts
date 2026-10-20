import { addFilesToUploadQueue } from "./uploadManager";

/**
 * Triggers the standard HTML browser file picker and enqueues selected files for upload.
 * Appends the hidden input to document.body so WebKit/WKWebView and Chromium browsers
 * treat it as a trusted, connected DOM element without dismissing it prematurely.
 */
export async function triggerFilePicker(): Promise<void> {
  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.left = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);

    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
        resolve();
      }
    };

    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        addFilesToUploadQueue(Array.from(files));
      }
      cleanup();
    };

    input.oncancel = () => {
      cleanup();
    };

    // Safety timeout in case cancel event isn't fired by some WebKit versions
    window.addEventListener(
      "focus",
      () => {
        setTimeout(cleanup, 1500);
      },
      { once: true }
    );

    input.click();
  });
}

/**
 * Triggers the standard HTML browser directory picker and enqueues selected files for upload.
 * Recursively selects all files inside chosen folders.
 */
export async function triggerFolderPicker(): Promise<void> {
  return new Promise<void>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;

    // Set folder select attributes for WebKit/Blink browsers
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.style.position = "fixed";
    input.style.top = "-9999px";
    input.style.left = "-9999px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);

    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
        resolve();
      }
    };

    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        addFilesToUploadQueue(Array.from(files));
      }
      cleanup();
    };

    input.oncancel = () => {
      cleanup();
    };

    window.addEventListener(
      "focus",
      () => {
        setTimeout(cleanup, 1500);
      },
      { once: true }
    );

    input.click();
  });
}
