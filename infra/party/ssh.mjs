// SSH from the development host to a party's machine (T-485). The key and the known-hosts file live outside every
// checkout: the key in ~/.ssh (setup-user.sh makes it), one known-hosts file per run under ~/.local/state.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const KEY = join(homedir(), '.ssh', 'crow-party');
export const STATE = join(homedir(), '.local', 'state', 'crow-party');
export const knownHostsFor = (run) => join(STATE, `known_hosts-${run}`);

/** The options every session uses. The first key a new machine shows is accepted, then pinned for the run. */
export function sshArgs({ ip, run, key = KEY, user = 'party' }) {
  return [
    '-i', key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${knownHostsFor(run)}`,
    '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'SendEnv=-*',
    `${user}@${ip}`,
  ];
}

/**
 * One command on the machine. Output stays in memory; the caller prints what it parses.
 * @param {{ ip: string, run: string, key?: string }} target
 * @param {string[]} command
 * @param {{ input?: string, timeoutMs?: number, spawn?: typeof spawnSync }} [o]
 */
export function ssh(target, command, { input, timeoutMs = 600_000, spawn = spawnSync } = {}) {
  mkdirSync(STATE, { recursive: true, mode: 0o700 });
  const r = spawn('ssh', [...sshArgs(target), ...command], { input, encoding: 'utf8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function forgetHost(run) {
  rmSync(knownHostsFor(run), { force: true });
}
