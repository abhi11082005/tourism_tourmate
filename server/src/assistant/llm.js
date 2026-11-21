import { env } from '../config/env.js';

/*
 * Minimal OpenAI-compatible chat client for the providers the app already
 * supports (Groq, Gemini). Kept separate from rag.service.js so the legacy
 * /assistant/ask path is untouched.
 */

const ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
};

export const llmConfigured = () => env.LLM_PROVIDER !== 'none' && Boolean(env.LLM_API_KEY);

/**
 * @returns {{
 *   configured: boolean,
 *   completeJson: (messages: object[], opts?: { timeoutMs?: number }) => Promise<string>,
 *   stream: (messages: object[], opts: { onToken: (t: string) => void, onFinish?: (reason: string) => void, signal?: AbortSignal }) => Promise<string>,
 * }}
 */
const STREAM_TIMEOUT_MS = 30_000;
const RETRYABLE = (status) => status === 429 || status >= 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLlm({ fetchImpl = (...a) => fetch(...a), streamTimeoutMs = STREAM_TIMEOUT_MS, retryDelayMs = 400 } = {}) {
  const configured = llmConfigured();
  const url = ENDPOINTS[env.LLM_PROVIDER];
  const headers = {
    authorization: `Bearer ${env.LLM_API_KEY}`,
    'content-type': 'application/json',
  };

  async function completeJson(messages, { timeoutMs = 1500 } = {}) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages,
        max_tokens: 200,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const body = await res.json();
    return body.choices?.[0]?.message?.content ?? '';
  }

  /**
   * Streams tokens through onToken and resolves with the full text.
   * A provider that hangs cannot hold the request open forever (hard time limit), and one
   * 429/5xx or dropped connection before the first byte is retried once.
   */
  async function stream(messages, { onToken, onFinish, signal }) {
    const limit = AbortSignal.timeout(streamTimeoutMs);
    const both = signal ? AbortSignal.any([signal, limit]) : limit;
    const body = JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      // Generous on purpose. The reply is asked to be short, but models that think first
      // count those tokens against this limit, and a tight cap left blank or cut-off answers.
      max_tokens: 1200,
      temperature: 0.2,
      stream: true,
    });

    let upstream;
    for (let attempt = 0; ; attempt += 1) {
      try {
        upstream = await fetchImpl(url, { method: 'POST', headers, signal: both, body });
        if (upstream.ok && upstream.body) break;
        if (attempt === 1 || !RETRYABLE(upstream.status)) throw new Error(`LLM ${upstream.status}`);
      } catch (err) {
        if (both.aborted || attempt === 1 || /^LLM 4(?!29)/.test(err?.message ?? '')) throw err;
      }
      await sleep(retryDelayMs);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const choice = JSON.parse(payload).choices?.[0];
          const token = choice?.delta?.content;
          if (token) {
            full += token;
            onToken(token);
          }
          if (choice?.finish_reason) onFinish?.(choice.finish_reason);
        } catch {
          // Partial JSON across chunk boundaries — the next read completes it.
        }
      }
    }
    return full;
  }

  return { configured, completeJson, stream };
}
