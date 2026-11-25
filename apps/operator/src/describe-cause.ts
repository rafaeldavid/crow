// An unexpected error as one line for the node operator's log (T-609). A 500 `internal` never names its cause to the
// caller, so the node's log is the only place the cause can be read, under the answer's Request-Id.
//
// The line keeps what says why and drops what says who (D39): each error in the cause chain by name, with viem's short
// message and the RPC node's own details where it has them, never viem's full message, which repeats the request
// (addresses, calldata, signatures). A URL is cut to its origin, since a keyed RPC's key sits in its path or query, and
// long hex and base64 runs are cut out.

const MAX = 800;
/** Errors in the chain worth a line each; viem nests four or five deep. */
const DEPTH = 6;

const origin = (url: string): string => {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return '<url>';
  }
};

const scrub = (s: string): string =>
  s
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>)\]]+/g, origin)
    .replace(/0x[0-9a-fA-F]{9,}/g, '0x…')
    .replace(/[A-Za-z0-9+_=-]{32,}/g, '…')
    .replace(/\s+/g, ' ')
    .trim();

/** Characters of one message or stack line that are read at all: what a node or a bug wrote is bounded before it is scanned. */
const LINE_MAX = 600;

const firstLine = (s: unknown): string => (typeof s === 'string' ? (s.slice(0, LINE_MAX * 4).split('\n').find((l) => l.trim()) ?? '').slice(0, LINE_MAX) : '');

/** `name: message (details)` for one error; viem's `shortMessage` stands for its message. */
function one(e: object): string {
  const o = e as { name?: unknown; message?: unknown; shortMessage?: unknown; details?: unknown; status?: unknown; code?: unknown };
  const message = firstLine(o.shortMessage) || firstLine(o.message);
  const details = firstLine(o.details);
  const facts = [details && details !== message ? details : '', typeof o.status === 'number' ? `HTTP ${o.status}` : '', typeof o.code === 'number' ? `code ${o.code}` : ''].filter(Boolean);
  return scrub(`${typeof o.name === 'string' ? o.name : 'Error'}: ${message}${facts.length ? ` (${facts.join(', ')})` : ''}`);
}

/**
 * Where a plain error was thrown: the first stack frame, as `at fn (file:line:column)`. An RPC error's says nothing.
 * A stack starts with the error's message, which may hold lines that look like frames, so the message is skipped; a
 * frame ends in a line and a column; and the frame is cut and scrubbed like every other text here. The path keeps its
 * last two parts: enough to name the file, without the machine's directories.
 */
function frame(e: object): string {
  const o = e as { stack?: unknown; shortMessage?: unknown; message?: unknown };
  if (o.shortMessage !== undefined || typeof o.stack !== 'string') return '';
  const message = typeof o.message === 'string' ? o.message : '';
  const after = message ? o.stack.indexOf(message) : -1;
  const frames = after < 0 ? o.stack : o.stack.slice(after + message.length);
  const at = frames
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ') && l.length <= LINE_MAX && /:\d+:\d+\)?$/.test(l));
  if (!at) return '';
  // No part of a path holds a slash, so the match cannot backtrack across parts.
  return ` ${scrub(at.replace(/(?:file:\/\/)?\/?(?:[^\s():/]*\/)+(?=[^\s():/]+\/[^\s():/]+:\d)/, ''))}`;
}

export function describeCause(e: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  for (let x: unknown = e; x !== undefined && x !== null && !seen.has(x) && lines.length < DEPTH; x = (x as { cause?: unknown }).cause) {
    seen.add(x);
    if (typeof x !== 'object') {
      lines.push(scrub(String(x)));
      break;
    }
    lines.push(`${one(x)}${lines.length === 0 ? frame(x) : ''}`);
  }
  const out = lines.join(' <- ');
  return out.length > MAX ? `${out.slice(0, MAX)}…` : out;
}
