// One graft call under one deadline (flyingrobots/footprint#100). `graft struct review` and
// `graft struct exports` used to be awaited with no limit, so a graft that stalled held the whole
// run. The deadline bounds the process and the reading of both its pipes, as the outliner's does
// (flyingrobots/footprint#56): a child that exits while a grandchild still holds a pipe open is
// stopped at the same deadline. Past it the process is killed and the caller states the section
// unavailable, with this reason.

/** Each `graft struct` call is stopped after this long. Normally one answers in about a second. */
export const GRAFT_TIMEOUT_MS = 60_000;

export type Bounded =
  | { readonly ok: true; readonly code: number; readonly out: string; readonly err: string }
  | { readonly ok: false; readonly reason: string };

export async function runBounded(cmd: readonly string[], cwd: string, timeoutMs: number, label: string): Promise<Bounded> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([...cmd], { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore", timeout: timeoutMs, killSignal: "SIGKILL" });
  } catch (e) {
    return { ok: false, reason: `${label} could not start: ${e instanceof Error ? e.message : String(e)}` };
  }
  const outReader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const errReader = (proc.stderr as ReadableStream<Uint8Array>).getReader();
  const timedOut: Bounded = { ok: false, reason: `${label} did not answer within ${timeoutMs} ms and was stopped` };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  const done = Promise.all([proc.exited, drain(outReader), drain(errReader)]);
  const settled = await Promise.race([done, deadline]);
  clearTimeout(timer);
  if (settled === "timeout") {
    proc.kill("SIGKILL");
    outReader.cancel().catch(() => {}); errReader.cancel().catch(() => {});
    done.catch(() => {});
    return timedOut;
  }
  const [code, out, err] = settled;
  if (proc.signalCode !== null && proc.signalCode !== undefined) return timedOut;
  return { ok: true, code, out, err };
}

/** A stream read to its end as text; cancelling the reader ends it early. */
export async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
  }
}
