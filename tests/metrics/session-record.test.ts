// T-493: one real agent session's numbers from its Claude Code transcript. The transcript here is made up, in the
// shapes Claude Code wrote on 2026-11-16 (tools/one-click/session-record.mjs, header), and it carries text the record
// must never hold: a scope, an address, a command and a credential.
import { describe, expect, it } from 'vitest';
import { check, loadSchemas } from '../../scripts/metrics/check.mjs';
import { byPerson, sessionNumbers, sessionRecord } from '../../tools/one-click/session-record.mjs';
import { COMMIT } from './helpers';

const SECRET = 'quote-credential-9f8e7d6c';
const SCOPE = 'github.com/example-org/private-repo';
const ADDRESS = '0x1111222233334444555566667777888899990000';
const t = (s: number) => new Date(Date.parse('2026-11-16T10:00:00Z') + s * 1000).toISOString();
const human = (s: number, text: string) => ({ type: 'user', timestamp: t(s), origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text }] } });
const assistant = (s: number, id: string, model: string, usage: Record<string, number>, content: unknown[] = [{ type: 'text', text: `I will buy ${SCOPE} for ${ADDRESS}` }]) => ({ type: 'assistant', timestamp: t(s), version: '2.1.150', message: { id, model, usage, content } });
const use = (s: number, id: string, call: string, name = 'Bash') => assistant(s, `msg-${call}`, 'claude-opus-5-5', { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 }, [{ type: 'tool_use', id, name, input: { command: `HOLDBACK_KEY=${SECRET} node buy.mjs approve` } }]);
const result = (s: number, id: string, decision: Record<string, string> | undefined) => ({ type: 'user', timestamp: t(s), ...(decision ? { permissionDecision: decision } : {}), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `paid from ${ADDRESS}` }] } });

const PERSON = { source: 'user_temporary', decision: 'accept', reasonCode: 'safetyCheck' };
const RULE = { source: 'user_permanent', decision: 'accept', reasonType: 'rule', ruleSource: 'localSettings' };
const CONFIG = { source: 'config', decision: 'accept', reasonType: 'classifier' };
const REFUSED = { source: 'config', decision: 'reject', reasonType: 'classifier' };

/** A purchase: the goal, a call a person allows, a stored rule, the settings, a refusal, a question, an idle reply, a mid-turn message. */
const TRANSCRIPT = [
  { type: 'queue-operation', timestamp: t(0), operation: 'enqueue', content: SECRET },
  human(0, `Buy the scan of ${SCOPE}`),
  // One model call that Claude Code wrote as two entries: counted once.
  assistant(1, 'msg-a', 'claude-opus-5-5', { input_tokens: 3, cache_creation_input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 7 }),
  assistant(1, 'msg-a', 'claude-opus-5-5', { input_tokens: 3, cache_creation_input_tokens: 20, cache_read_input_tokens: 0, output_tokens: 7 }),
  use(2, 'tu-1', '1'), result(32, 'tu-1', PERSON), // a person waited on for 30 s
  use(33, 'tu-2', '2'), result(34, 'tu-2', RULE),
  use(35, 'tu-3', '3', 'Read'), result(36, 'tu-3', CONFIG),
  use(37, 'tu-4', '4'), result(38, 'tu-4', REFUSED),
  use(39, 'tu-5', '5', 'AskUserQuestion'), result(99, 'tu-5', undefined), // a question answered after 60 s
  assistant(100, 'msg-b', 'claude-sonnet-5-5', { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 50, output_tokens: 2 }),
  { type: 'queue-operation', timestamp: t(219), operation: 'enqueue', content: SECRET },
  human(220, `yes, approve it with ${SECRET}`), // idle for 120 s before it
  { type: 'attachment', timestamp: t(221), attachment: { type: 'queued_command', origin: { kind: 'human' }, prompt: SCOPE } }, // mid-turn: no wait
  { type: 'attachment', timestamp: t(222), attachment: { type: 'queued_command', origin: { kind: 'task-notification' }, prompt: 'done' } },
  { type: 'user', timestamp: t(223), isMeta: true, origin: { kind: 'peer' }, message: { content: 'a subagent report' } },
  assistant(230, 'msg-c', 'claude-opus-5-5', { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 3 }),
];
const lines = TRANSCRIPT.map((e) => JSON.stringify(e)).join('\n');

describe('session-record.mjs (T-493)', () => {
  it('counts what a person answered, and only that', () => {
    const r = sessionNumbers(TRANSCRIPT);
    expect(r.approvals).toEqual({ total: 4, toolPermission: 1, questions: 1, messages: 2, byTool: { Bash: 1 }, autoAllowed: 2, denied: 1 }); // the stored rule and the settings
    expect(byPerson(PERSON)).toBe(true);
    expect(byPerson(RULE)).toBe(false);
    expect(byPerson(CONFIG)).toBe(false);
  });

  it('counts each model call once, by model', () => {
    const r = sessionNumbers(TRANSCRIPT);
    expect(r.tokens.calls).toBe(8);
    expect(r.tokens.byModel['claude-opus-5-5']).toEqual({ calls: 7, input: 55, cacheWrite: 520, cacheRead: 5000, output: 35 });
    expect(r.tokens.byModel['claude-sonnet-5-5']).toEqual({ calls: 1, input: 1, cacheWrite: 0, cacheRead: 50, output: 2 });
    expect(r.tokens.total.output).toBe(37);
  });

  it('measures the wait from the agent\'s last activity, not from the bookkeeping written when the person types', () => {
    const r = sessionNumbers(TRANSCRIPT);
    expect(r.time.wallMs).toBe(230_000);
    expect(r.time.waitingOnPersonMs).toBe(30_000 + 60_000 + 120_000);
    expect(r.time.withoutUserMs).toBe(20_000);
    expect(r.tools).toEqual({ calls: 5, byTool: { AskUserQuestion: 1, Bash: 3, Read: 1 } });
    expect(r.session).toMatchObject({ claudeCodeVersion: '2.1.150', entries: TRANSCRIPT.length, subagentEntries: 0, startedAt: '2026-11-16T10:00:00.000Z', endedAt: '2026-11-16T10:03:50.000Z' });
  });

  it('writes a record its schema accepts, with no text from the transcript', () => {
    const rec = sessionRecord([lines, 'not json'], { label: 'pilot-scan-1-buyer', commit: COMMIT, generatedAt: Date.parse('2026-11-16T12:00:00Z') });
    expect(check('agent-session', rec, loadSchemas())).toEqual({ ok: true, errors: [] });
    const out = JSON.stringify(rec);
    for (const leak of [SECRET, SCOPE, ADDRESS, 'buy.mjs', 'approve it', 'subagent report']) expect(out).not.toContain(leak);
    expect(rec.gaps).toEqual(['file 2: 1 lines were not JSON and were skipped']);
  });

  it('refuses a label that could carry a name or a path, and says when a transcript has no marks to count', () => {
    for (const label of ['Pilot Scan', '../x', 'a'.repeat(65), '']) expect(() => sessionRecord([lines], { label, commit: COMMIT, generatedAt: 0 })).toThrow(/--label/);
    const bare = sessionRecord([JSON.stringify({ type: 'user', timestamp: t(0), message: { content: 'hi' } })], { label: 'old-version', commit: COMMIT, generatedAt: 0 });
    expect(bare.gaps.join(' ')).toMatch(/origin kind human/);
    expect(bare.gaps.join(' ')).toMatch(/permissionDecision/);
  });
});
