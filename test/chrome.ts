import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

/** Where Chrome is, `CHROME_PATH` first: the places macOS and Linux put it. */
export function chromeAt(): string | undefined {
  const named = process.env["CHROME_PATH"];
  if (named !== undefined && named !== "") return named;
  return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((place) => existsSync(place));
}

/** The keys a test presses that type nothing, with the code Chrome reports for each. */
const KEYS: Readonly<Record<string, number>> = { Enter: 13, Escape: 27, Tab: 9 };

/**
 * A headless Chrome with one page, driven over its DevTools pipe the way a person drives it: a press of the pointer at a point, and keys
 * pressed one by one. `evaluate` reads the page.
 */
export async function chrome(path: string, width = 800, height = 600) {
  const profile = mkdtempSync(join(tmpdir(), "cx-subagents-chrome-"));
  const child = spawn(path, ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const out = child.stdio[3] as Writable;
  const back = child.stdio[4] as Readable;
  const waiting = new Map<number, (message: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  let next = 0;
  let held = "";
  back.on("data", (chunk: Buffer) => {
    held += chunk.toString("utf8");
    for (let end = held.indexOf("\0"); end >= 0; end = held.indexOf("\0")) {
      const message = JSON.parse(held.slice(0, end)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
      held = held.slice(end + 1);
      if (message.id !== undefined) { waiting.get(message.id)?.(message); waiting.delete(message.id); }
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> => new Promise((done, fail) => {
    const id = ++next;
    waiting.set(id, (message) => (message.error === undefined ? done(message.result ?? {}) : fail(new Error(`${method}: ${message.error.message}`))));
    out.write(`${JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) })}\0`);
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
  const on = (method: string, params: Record<string, unknown> = {}) => send(method, params, sessionId);
  await on("Page.enable");
  await on("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await on("Emulation.setFocusEmulationEnabled", { enabled: true });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const { result, exceptionDetails } = await on("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
    return result.value;
  };
  return {
    evaluate,
    open: async (url: string): Promise<void> => {
      await on("Page.navigate", { url });
      for (let n = 0; n < 200 && await evaluate<string>("document.readyState") !== "complete"; n++) await new Promise((done) => setTimeout(done, 25));
    },
    press: async (x: number, y: number): Promise<void> => {
      await on("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await on("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await on("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    },
    key: async (key: string): Promise<void> => {
      const code = KEYS[key];
      if (code === undefined) {
        await on("Input.dispatchKeyEvent", { type: "keyDown", key, text: key, unmodifiedText: key });
        await on("Input.dispatchKeyEvent", { type: "keyUp", key });
        return;
      }
      await on("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      await on("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    },
    close: async (): Promise<void> => {
      await send("Browser.close").catch(() => {});
      await new Promise((done) => { if (child.exitCode !== null) done(undefined); else child.once("exit", done); });
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
