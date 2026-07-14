import { config } from './config.js';

/**
 * DeepSeek text generation over the OpenAI-compatible chat-completions API.
 *
 * This replaces the old Claude Code CLI (server/claude.js). A plain HTTP API
 * key has none of the CLI's problems: no interactive login, no per-machine
 * auth, no child process to spawn — so it runs identically on a laptop or a
 * VPS serving many users.
 *
 * Note: unlike the Claude CLI, this API cannot browse the web. Any website
 * research must be done BEFORE calling here (see server/website.js) and passed
 * into the prompt as text. runLLM just turns a prompt into a completion.
 *
 * Returns the SAME shape the old runClaude did, so draft.js/engine.js are
 * unaffected: { ok, result, cost?, error }.
 */

const PRICING = {
  // USD per 1M tokens. Best-effort cost estimate for the activity feed only —
  // billing is whatever DeepSeek actually charges. Update if their rates move.
  input: 0.28,
  output: 0.42
};

function estimateCost(usage) {
  if (!usage) return undefined;
  const inTok = usage.prompt_tokens || 0;
  const outTok = usage.completion_tokens || 0;
  return (inTok / 1e6) * PRICING.input + (outTok / 1e6) * PRICING.output;
}

/**
 * Run one prompt through DeepSeek. `system` is optional; the prompt already
 * carries the full instructions, so by default we send it as a single user
 * message. `temperature` is low for consistent, on-spec JSON output.
 *
 * Retries once on transient network / 429 / 5xx errors with a short backoff.
 */
export async function runLLM(prompt, {
  timeoutMs = 120000,
  temperature = 0.7,
  system = null,
  model = config.deepseekModel
} = {}) {
  if (!config.deepseekApiKey) {
    return { ok: false, error: 'DeepSeek API key not configured (set DEEPSEEK_API_KEY in dashboard/.env)' };
  }

  const url = config.deepseekBaseUrl.replace(/\/+$/, '') + '/chat/completions';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const payload = { model, messages, temperature, stream: false };

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.deepseekApiKey}`
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });

      const text = await res.text();

      if (!res.ok) {
        // Parse DeepSeek's error envelope when present for a cleaner message.
        let detail = text.slice(0, 300);
        try { detail = JSON.parse(text)?.error?.message || detail; } catch { /* keep raw */ }

        if (res.status === 401) {
          return { ok: false, error: `DeepSeek auth failed (401) — check DEEPSEEK_API_KEY. (${detail})` };
        }
        if (res.status === 402) {
          return { ok: false, error: `DeepSeek: insufficient balance (402). Top up your account. (${detail})` };
        }
        // 429 / 5xx are worth one retry; 4xx (bad model id, bad request) are not.
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          lastError = `HTTP ${res.status}: ${detail}`;
          await sleep(1200 * attempt);
          continue;
        }
        return { ok: false, error: `DeepSeek HTTP ${res.status}: ${detail}` };
      }

      let env;
      try {
        env = JSON.parse(text);
      } catch {
        return { ok: false, error: 'could not parse DeepSeek response', raw: text.slice(0, 800) };
      }

      const result = env?.choices?.[0]?.message?.content;
      if (typeof result !== 'string' || !result.trim()) {
        const finish = env?.choices?.[0]?.finish_reason;
        return { ok: false, error: `DeepSeek returned no text${finish ? ` (finish_reason: ${finish})` : ''}`, raw: env };
      }

      return { ok: true, result, cost: estimateCost(env.usage) };
    } catch (err) {
      // Abort (timeout) or network-level failure.
      const isAbort = err?.name === 'AbortError';
      lastError = isAbort ? `timeout after ${Math.round(timeoutMs / 1000)}s` : String(err.message || err);
      if (!isAbort && attempt < 2) {
        await sleep(1200 * attempt);
        continue;
      }
      return { ok: false, error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError || 'DeepSeek request failed' };
}

/**
 * Lightweight readiness check for the startup banner. Sends a 1-token request
 * so a bad key / bad model id / no balance surfaces immediately instead of on
 * the first real draft.
 */
export async function llmHealthCheck() {
  if (!config.deepseekApiKey) {
    return { ok: false, error: 'no DEEPSEEK_API_KEY set' };
  }
  const url = config.deepseekBaseUrl.replace(/\/+$/, '') + '/chat/completions';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0
      }),
      signal: ctrl.signal
    });
    if (res.ok) return { ok: true, model: config.deepseekModel };
    let detail = (await res.text()).slice(0, 200);
    try { detail = JSON.parse(detail)?.error?.message || detail; } catch { /* keep raw */ }
    return { ok: false, error: `HTTP ${res.status}: ${detail}`, model: config.deepseekModel };
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'timeout' : String(err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
