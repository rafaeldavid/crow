#!/usr/bin/env node
// One real agent session's numbers, read from its Claude Code transcript (T-493): the pilot's purchases and sales,
// where the benchmark harness cannot drive the agent because a person approves real offers. It writes one
// `crow.metrics.agent-session/1` record (scripts/metrics/schemas/agent-session.schema.json): approvals, tokens per
// model, wall time and time without the user, and tool calls by name.
//
// It reads only and writes numbers and tool names only: never a message, a command, a path, an address, a
// repository or a credential. A transcript can hold all of those, so it never leaves the machine it was made on;
// the record can.
//
//   node tools/one-click/session-record.mjs <transcript.jsonl> [<subagent.jsonl> ...] --label <name> [--out <file>]
//
// Claude Code keeps one transcript per session under ~/.claude/projects/<project>/<session id>.jsonl. What it reads,
// as Claude Code wrote it on 2026-11-16 (measured on real transcripts, never on message text):
// - a tool result's `permissionDecision`: `source` `config` when the settings allowed it with no question,
//   `user_temporary` when a person allowed it, `user_permanent` with `reasonType` `rule` when a stored rule did;
// - a message from a person: a `user` entry, or a `queued_command` attachment sent mid-turn, with origin kind human;
// - an assistant entry's `message.usage` and `message.model`, several entries to one model call (`message.id`).
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { envelope, gitCommit, isMain, ROOT, writeJson } from '../../scripts/metrics/lib.mjs';
import { check, loadSchemas } from '../../scripts/metrics/check.mjs';

export const SCRIPT = 'tools/one-click/session-record.mjs';
const TOOL = /^[A-Za-z0-9_.-]{1,80}$/;
const MODEL = /^[a-z0-9.@[\]-]{1,64}$/;
const LABEL = /^[a-z0-9][a-z0-9-]{0,63}$/;

const tsOf = (e) => (typeof e?.timestamp === 'string' && !Number.isNaN(Date.parse(e.timestamp)) ? Date.parse(e.timestamp) : null);
const toolName = (n) => (typeof n === 'string' && TOOL.test(n) ? n : 'other');
const modelName = (m) => (typeof m === 'string' && MODEL.test(m.toLowerCase()) ? m.toLowerCase() : 'unknown');
const humanOrigin = (o) => o?.kind === 'human';
const count = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
const zero = () => ({ calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
const n = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

/** A person answered this decision: a one-time or a lasting yes, or a no, that no stored rule made. */
export const byPerson = (d) => typeof d?.source === 'string' && d.source.startsWith('user_') && d.reasonType !== 'rule';

/**
 * The record's body from the transcripts' parsed entries, in file order. Pure. `entries` holds every file's entries,
 * the main session's first; a line that is not JSON is skipped by the caller and counted in `gaps`.
 */
export function sessionNumbers(entries) {
  const toolUses = new Map(); // tool_use id -> { name, at }
  const byTool = new Map(), approvedByTool = new Map();
  let toolPermission = 0, questions = 0, messages = 0, autoAllowed = 0, denied = 0, subagentEntries = 0, toolCalls = 0;
  let waitingMs = 0;
  // The agent's last activity: its last assistant entry or tool result. Bookkeeping entries (a queue operation, a
  // title) are written when the person types, so a wait measured from them reads about 0.
  let firstAt = null, lastAt = null, agentAt = null, firstHumanSeen = false;
  let version = null;
  const calls = new Map(); // model call id -> { model, usage }
  for (const e of entries) {
    const at = tsOf(e);
    if (e?.isSidechain === true) subagentEntries++;
    if (typeof e?.version === 'string' && /^\d+\.\d+\.\d+/.test(e.version)) version ??= e.version.slice(0, 40);
    if (e?.type === 'assistant') {
      const m = e.message ?? {};
      if (Array.isArray(m.content)) for (const p of m.content) if (p?.type === 'tool_use' && typeof p.id === 'string') {
        toolUses.set(p.id, { name: toolName(p.name), at });
        count(byTool, toolName(p.name));
        toolCalls++;
      }
      const id = typeof m.id === 'string' ? m.id : typeof e.requestId === 'string' ? e.requestId : null;
      if (m.usage && id && m.model !== '<synthetic>') calls.set(id, { model: modelName(m.model), usage: m.usage });
    }
    if (e?.type === 'user') {
      const c = e.message?.content;
      const results = Array.isArray(c) ? c.filter((p) => p?.type === 'tool_result') : [];
      for (const r of results) {
        const use = toolUses.get(r.tool_use_id);
        const d = e.permissionDecision;
        if (use?.name === 'AskUserQuestion' && r.is_error !== true) {
          questions++;
          if (use.at !== null && at !== null) waitingMs += Math.max(0, at - use.at);
        }
        if (!d) continue;
        if (d.decision === 'reject') denied++;
        else if (byPerson(d)) {
          toolPermission++;
          count(approvedByTool, use?.name ?? 'other');
          if (use?.at !== null && use?.at !== undefined && at !== null) waitingMs += Math.max(0, at - use.at);
        } else autoAllowed++;
      }
      if (!results.length && e.isMeta !== true && (humanOrigin(e.origin) || e.turnOrigin === 'human')) {
        if (firstHumanSeen) {
          messages++;
          if (agentAt !== null && at !== null) waitingMs += Math.max(0, at - agentAt);
        }
        firstHumanSeen = true;
      }
    }
    // A message a person sent while the agent worked: no wait, since the agent did not stop for it.
    if (e?.type === 'attachment' && e.attachment?.type === 'queued_command' && humanOrigin(e.attachment.origin)) {
      if (firstHumanSeen) messages++;
      firstHumanSeen = true;
    }
    if (at !== null) {
      firstAt ??= at;
      lastAt = at;
      const results = e?.type === 'user' && Array.isArray(e.message?.content) && e.message.content.some((p) => p?.type === 'tool_result');
      if (e?.type === 'assistant' || results) agentAt = at;
    }
  }
  const byModel = {};
  const total = zero();
  for (const { model, usage } of calls.values()) {
    const t = (byModel[model] ??= zero());
    const add = { calls: 1, input: n(usage.input_tokens), cacheWrite: n(usage.cache_creation_input_tokens), cacheRead: n(usage.cache_read_input_tokens), output: n(usage.output_tokens) };
    for (const k of Object.keys(add)) {
      t[k] += add[k];
      total[k] += add[k];
    }
  }
  const wallMs = firstAt !== null && lastAt !== null ? lastAt - firstAt : 0;
  const waitingOnPersonMs = Math.min(waitingMs, wallMs);
  return {
    session: { claudeCodeVersion: version, entries: entries.length, subagentEntries, startedAt: firstAt === null ? null : new Date(firstAt).toISOString(), endedAt: lastAt === null ? null : new Date(lastAt).toISOString() },
    approvals: { total: toolPermission + questions + messages, toolPermission, questions, messages, byTool: Object.fromEntries([...approvedByTool].sort()), autoAllowed, denied },
    tokens: { calls: calls.size, byModel, total },
    time: {
      wallMs,
      waitingOnPersonMs,
      withoutUserMs: wallMs - waitingOnPersonMs,
      method: 'Wall time from the first to the last entry. Waiting: each tool call a person allowed, from the call to its result (an upper bound: it includes the run), each question, and the gap before each message a person sent when the agent was idle.',
    },
    tools: { calls: toolCalls, byTool: Object.fromEntries([...byTool].sort()) },
  };
}

/** Parses transcript text into entries; lines that are not JSON are counted, never echoed. */
export function parseTranscript(text) {
  const entries = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      bad++;
    }
  }
  return { entries, bad };
}

/** The whole record, enveloped, for the given transcripts' texts. */
export function sessionRecord(texts, { label, commit, generatedAt }) {
  if (typeof label !== 'string' || !LABEL.test(label)) throw new Error('--label is lowercase letters, digits and hyphens, at most 64, such as pilot-scan-1-buyer');
  const gaps = [];
  const entries = [];
  texts.forEach((t, i) => {
    const p = parseTranscript(t);
    if (p.bad) gaps.push(`file ${i + 1}: ${p.bad} lines were not JSON and were skipped`);
    entries.push(...p.entries);
  });
  const body = sessionNumbers(entries);
  if (body.approvals.messages === 0 && !entries.some((e) => humanOrigin(e?.origin) || e?.turnOrigin === 'human')) gaps.push('no message carries origin kind human: this Claude Code version may mark a person\'s messages another way, so messages reads 0');
  if (!entries.some((e) => e?.permissionDecision)) gaps.push('no tool result carries a permissionDecision: tool approvals read 0');
  return { ...envelope('agent-session', { script: SCRIPT, commit, generatedAt, sources: [], gaps }), label, ...body };
}

if (isMain(import.meta.url)) {
  const { values, positionals } = parseArgs({ options: { label: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } }, allowPositionals: true, strict: true });
  const usage = 'usage: node tools/one-click/session-record.mjs <transcript.jsonl> [<subagent.jsonl> ...] --label <name> [--out <file>]';
  if (values.help) {
    console.log(`${usage}\nReads Claude Code transcripts and writes one record of numbers and tool names only (crow.metrics.agent-session/1).`);
    process.exit(0);
  }
  if (!positionals.length || !values.label) {
    console.error(usage);
    process.exit(2);
  }
  let record;
  try {
    record = sessionRecord(positionals.map((f) => readFileSync(f, 'utf8')), { label: values.label, commit: gitCommit(ROOT), generatedAt: Date.now() });
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const r = check('agent-session', record, loadSchemas());
  if (!r.ok) {
    console.error(`the record does not match its schema:\n${r.errors.join('\n')}`);
    process.exit(1);
  }
  if (values.out) writeJson(values.out, record);
  else console.log(JSON.stringify(record, null, 2));
  const a = record.approvals, t = record.tokens.total, s = record.time;
  console.error(`${record.label}: ${a.total} approvals (${a.toolPermission} tool, ${a.questions} questions, ${a.messages} messages), ${t.input + t.cacheWrite + t.cacheRead} input and ${t.output} output tokens in ${record.tokens.calls} calls, ${Math.round(s.withoutUserMs / 1000)} s without the user of ${Math.round(s.wallMs / 1000)} s`);
}
