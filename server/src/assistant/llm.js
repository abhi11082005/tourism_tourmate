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
 *   stream: (messages: object[], opts: { onToken: (t: string) => void, signal?: AbortSignal }) => Promise<string>,
 * }}
 */
export function createLlm() {
  const configured = llmConfigured();
  const url = ENDPOINTS[env.LLM_PROVIDER];
  const headers = {
    authorization: `Bearer ${env.LLM_API_KEY}`,
    'content-type': 'application/json',
  };

  async function completeJson(messages, { timeoutMs = 1500 } = {}) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages,
        max_tokens: 80,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const body = await res.json();
    return body.choices?.[0]?.message?.content ?? '';
  }

  /** Streams tokens through onToken and resolves with the full text. */
  async function stream(messages, { onToken, signal }) {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages,
        max_tokens: 260,
        temperature: 0.2,
        stream: true,
      }),
    });
    if (!upstream.ok || !upstream.body) throw new Error(`LLM ${upstream.status}`);

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
          const token = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (token) {
            full += token;
            onToken(token);
          }
        } catch {
          // Partial JSON across chunk boundaries — the next read completes it.
        }
      }
    }
    return full;
  }

  return { configured, completeJson, stream };
}
