import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

export const ROOT = resolve(import.meta.dirname, "..");
export const PI_SUBAGENTS = join(ROOT, "node_modules", "pi-subagents");
const PI = join(ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
/** The config the box's image carries for pi-subagents, as `comchatx/comchatx`'s `src/sandbox/image/pi-home/extensions/subagent/config.json`. */
export const BOX_CONFIG = join(ROOT, "test", "fixtures", "subagent-config.json");

type Part = { readonly text?: string; readonly functionCall?: { readonly name: string; readonly args: Record<string, unknown> } };
type Request = { readonly contents?: readonly { readonly role: string; readonly parts?: readonly Record<string, unknown>[] }[]; readonly tools?: readonly { readonly functionDeclarations?: readonly { readonly name: string }[] }[]; readonly systemInstruction?: unknown };
export type Asked = { readonly at: number; readonly role: string; readonly tools: readonly string[]; readonly system: string; readonly last: string };
export type Answer = { readonly parts: readonly Part[]; readonly holdMs?: number };

/** What the request's first user message says, which tells a helper's conversation from the parent's. */
export const firstUser = (body: Request): string => ((body.contents ?? []).find((one) => one.role === "user")?.parts ?? []).map((part) => String(part["text"] ?? "")).join("");
/** The request's last user content, its tool results written out. */
export const lastUser = (body: Request): string => {
  const content = [...(body.contents ?? [])].reverse().find((one) => one.role === "user");
  return (content?.parts ?? []).map((part) => (typeof part["text"] === "string" ? part["text"] : part["functionResponse"] === undefined ? "" : `[${(part["functionResponse"] as { name: string }).name}] ${JSON.stringify((part["functionResponse"] as { response: unknown }).response)}`)).join("\n");
};

/** A Google-protocol model on loopback, scripted per request; no vendor is called. */
export async function scriptedModel(script: (body: Request, last: string) => { readonly role: string; readonly answer: Answer }) {
  const asked: Asked[] = [];
  const started = Date.now();
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}") as Request;
      const last = lastUser(body);
      const { role, answer } = script(body, last);
      asked.push({ at: Date.now() - started, role, last, system: JSON.stringify(body.systemInstruction ?? ""), tools: (body.tools ?? []).flatMap((one) => (one.functionDeclarations ?? []).map((declared) => declared.name)) });
      const event = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
      const send = (): void => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        for (const part of answer.parts) response.write(event({ candidates: [{ content: { role: "model", parts: [part] } }] }));
        response.end(event({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 } }));
      };
      const held = setTimeout(send, answer.holdMs ?? 0);
      response.on("close", () => clearTimeout(held));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta`,
    asked,
    close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
  };
}

type Frame = Record<string, unknown>;

/**
 * The pinned pi in RPC mode, as a box's steward starts it (`src/sandbox/steward/spawn.ts`): its own agent directory as `HOME` and
 * `PI_CODING_AGENT_DIR`, offline, the tenant root its cwd; pi-subagents then this package listed in the order a click installs them,
 * and the box's config for pi-subagents where it reads it. A background runner is its own process group, so the whole tree is stopped.
 */
export class Box {
  readonly frames: { readonly at: number; readonly frame: Frame }[] = [];
  readonly #child: ChildProcess;
  readonly #started = Date.now();
  readonly #waiting = new Set<{ readonly test: (frame: Frame) => boolean; readonly done: (frame: Frame) => void }>();
  readonly home: string;
  stderr = "";
  #next = 0;

  constructor(modelUrl: string, options: { readonly config?: boolean } = {}) {
    this.home = mkdtempSync(join(tmpdir(), "cx-subagents-"));
    const agent = join(this.home, "agent");
    const tenant = join(this.home, "tenant");
    for (const directory of [agent, tenant, join(this.home, "tmp"), join(this.home, "sessions")]) mkdirSync(directory, { recursive: true });
    writeFileSync(join(agent, "settings.json"), JSON.stringify({
      defaultProvider: "google", defaultModel: "gemini-3.6-flash", defaultThinkingLevel: "low", transport: "sse", quietStartup: true, defaultProjectTrust: "always",
      cacheWarming: "off", steeringMode: "all", retry: { enabled: false }, extensions: ["-builtin:llama.cpp"], packages: [PI_SUBAGENTS, ROOT],
    }));
    writeFileSync(join(agent, "models.json"), JSON.stringify({ providers: { google: { baseUrl: modelUrl, apiKey: "cmx-placeholder-key" } } }));
    if (options.config !== false) {
      mkdirSync(join(agent, "extensions", "subagent"), { recursive: true });
      cpSync(BOX_CONFIG, join(agent, "extensions", "subagent", "config.json"));
    }
    const env = { PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_CODING_AGENT_DIR: agent, HOME: agent, PATH: process.env["PATH"] ?? "", TMPDIR: join(this.home, "tmp") };
    this.#child = spawn(process.execPath, [PI, "--mode", "rpc", "--session-dir", join(this.home, "sessions")], { cwd: tenant, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    this.#child.stderr?.on("data", (chunk: Buffer) => { this.stderr += chunk.toString(); });
    createInterface({ input: this.#child.stdout! }).on("line", (line) => {
      let frame: Frame;
      try { frame = JSON.parse(line) as Frame; } catch { return; }
      this.frames.push({ at: Date.now() - this.#started, frame });
      for (const waiter of [...this.#waiting]) if (waiter.test(frame)) { this.#waiting.delete(waiter); waiter.done(frame); }
    });
  }

  /** A command as the steward sends a seller's message: steered into a running turn. */
  send(command: Frame): void {
    this.#child.stdin!.write(`${JSON.stringify({ id: `c${this.#next++}`, ...command })}\n`);
  }

  prompt(message: string): void { this.send({ type: "prompt", message, streamingBehavior: "steer" }); }

  /** The next frame that passes the test, or an error after `boundMs`. */
  until(test: (frame: Frame) => boolean, boundMs: number): Promise<Frame> {
    const seen = this.frames.find(({ frame }) => test(frame));
    if (seen !== undefined) return Promise.resolve(seen.frame);
    return new Promise((resolve, reject) => {
      const waiter = { test, done: (frame: Frame) => { clearTimeout(timer); resolve(frame); } };
      const timer = setTimeout(() => { this.#waiting.delete(waiter); reject(new Error(`not seen within ${boundMs} ms; stderr: ${this.stderr.slice(-2000)}`)); }, boundMs);
      this.#waiting.add(waiter);
    });
  }

  /** When a frame that passes the test was seen, in ms from the start. */
  at(test: (frame: Frame) => boolean): number | undefined {
    return this.frames.find(({ frame }) => test(frame))?.at;
  }

  async stop(): Promise<void> {
    const exited = this.#child.exitCode === null ? new Promise<void>((done) => this.#child.once("exit", () => done())) : Promise.resolve();
    try { process.kill(-this.#child.pid!, "SIGTERM"); } catch { /* gone */ }
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5_000))]);
    try { process.kill(-this.#child.pid!, "SIGKILL"); } catch { /* gone */ }
    rmSync(this.home, { recursive: true, force: true });
  }
}

/** Whether a frame ends an assistant message that says `words`. */
export const said = (words: string) => (frame: Frame): boolean => frame["type"] === "message_end" && JSON.stringify(frame["message"] ?? {}).includes(words);
