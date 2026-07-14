import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config, ROOT } from './config.js';

/**
 * Runs the user's installed Claude Code CLI headlessly to generate text.
 * Windows-specific care:
 *   - the real binary is claude.cmd; resolve its full path once.
 *   - feed the prompt on STDIN (avoids the ~8KB command-line limit and all
 *     quoting problems with business names that contain quotes/&/unicode).
 *   - run in a dedicated empty cwd so no stray CLAUDE.md pollutes the prompt.
 *   - kill the whole process tree on timeout (taskkill /T), not just the shim.
 */

let claudeBinCache = null;

export function resolveClaudeBin() {
  if (claudeBinCache) return claudeBinCache;
  if (config.claudeBin && fs.existsSync(config.claudeBin)) {
    claudeBinCache = config.claudeBin;
    return claudeBinCache;
  }
  const cmd = process.platform === 'win32' ? 'where claude' : 'command -v claude';
  try {
    const out = execSync(cmd, { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    // Prefer the .cmd shim on Windows.
    const pick = out.find((p) => /\.cmd$/i.test(p)) || out[0];
    claudeBinCache = pick.trim();
  } catch {
    claudeBinCache = process.platform === 'win32' ? 'claude.cmd' : 'claude';
  }
  return claudeBinCache;
}

const WORKDIR = path.join(ROOT, 'server', '.claude-workdir');

function ensureWorkdir() {
  fs.mkdirSync(WORKDIR, { recursive: true });
  return WORKDIR;
}

export async function claudeHealthCheck() {
  const bin = resolveClaudeBin();
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = (ok, version, error) => {
      if (done) return;
      done = true;
      resolve({ ok, bin, version, error });
    };
    let child;
    try {
      child = spawn(bin, ['--version'], { windowsHide: true, shell: process.platform === 'win32' });
    } catch (err) {
      return finish(false, null, err.message);
    }
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (err) => finish(false, null, err.message));
    child.on('close', (code) => finish(code === 0, out.trim() || null, code === 0 ? null : `exit ${code}`));
    setTimeout(() => { try { child.kill(); } catch { /* */ } finish(false, null, 'timeout'); }, 15000);
  });
}

/**
 * Run claude in headless print mode with a prompt on stdin.
 * Returns { ok, result, raw, error } where `result` is the model's final text.
 */
export function runClaude(prompt, { timeoutMs = 180000, allowedTools = 'WebFetch,WebSearch', maxTurns = 8 } = {}) {
  const bin = resolveClaudeBin();
  const cwd = ensureWorkdir();
  const args = [
    '-p',
    '--output-format', 'json',
    '--allowedTools', allowedTools,
    '--max-turns', String(maxTurns)
  ];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        windowsHide: true,
        shell: process.platform === 'win32'
      });
    } catch (err) {
      return resolve({ ok: false, error: 'spawn failed: ' + err.message });
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      killTree(child);
      finish({ ok: false, error: `timeout after ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);

    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (err) => finish({ ok: false, error: err.message, stderr }));
    child.on('close', (code) => {
      if (settled) return;
      // The --output-format json envelope is a single JSON object on stdout.
      let env;
      try {
        env = JSON.parse(stdout.trim());
      } catch {
        return finish({
          ok: false,
          error: code === 0 ? 'could not parse CLI output' : `exit ${code}: ${stderr.slice(0, 400) || 'no output'}`,
          raw: stdout.slice(0, 2000),
          stderr: stderr.slice(0, 800)
        });
      }
      if (env.is_error || env.subtype !== 'success' || typeof env.result !== 'string') {
        const detail = String(env.result || stderr || '').slice(0, 300);
        let error;
        if (/authenticate|unauthorized|invalid token|401/i.test(detail)) {
          error = `claude not authenticated — run \`claude\` once in a terminal to log in. (${detail})`;
        } else if (env.subtype === 'error_max_turns') {
          error = `claude hit the turn limit before finishing. (${detail})`;
        } else {
          error = `claude error: ${detail || env.subtype || 'unknown'}`;
        }
        return finish({ ok: false, error, raw: env });
      }
      finish({ ok: true, result: env.result, cost: env.total_cost_usd, turns: env.num_turns });
    });

    // Send the prompt on stdin, then close it.
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (err) {
      killTree(child);
      finish({ ok: false, error: 'stdin write failed: ' + err.message });
    }
  });
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch { /* already gone */ }
}
