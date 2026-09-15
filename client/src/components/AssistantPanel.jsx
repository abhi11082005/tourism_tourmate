import { useCallback, useEffect, useRef, useState } from 'react';
import { askExpert } from '../lib/api.js';

/*
 * "Ask the Expert" chat panel.
 *
 * The answer is streamed, so the first words land in a few hundred milliseconds
 * even when the model takes two seconds to finish — that is how the 3-second
 * budget is met without a faster model.
 *
 * Tokens are buffered and flushed once per animation frame. Calling setState on
 * every token (there can be 200) is what makes a streaming chat stutter.
 */

const SUGGESTIONS = [
  'Is the AC coach worth it?',
  'What is included in the price?',
  'How many seats are left this weekend?',
  'What happens if I cancel three days before?',
];

export default function AssistantPanel({ tourId, tourTitle }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const bufferRef = useRef('');
  const frameRef = useRef(0);
  const scrollRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const flush = useCallback(() => {
    frameRef.current = 0;
    const chunk = bufferRef.current;
    if (!chunk) return;
    bufferRef.current = '';
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, text: last.text + chunk };
      return next;
    });
  }, []);

  const ask = useCallback(
    async (question) => {
      const trimmed = question.trim();
      if (trimmed.length < 3 || streaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setDraft('');
      setStreaming(true);
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: trimmed },
        { role: 'assistant', text: '', sources: [] },
      ]);

      try {
        await askExpert(
          { tourId, question: trimmed },
          {
            signal: controller.signal,
            onSources: (sources) =>
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { ...next[next.length - 1], sources };
                return next;
              }),
            onToken: (token) => {
              bufferRef.current += token;
              if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
            },
          }
        );
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        flush();
        setStreaming(false);
      }
    },
    [flush, streaming, tourId]
  );

  return (
    <section className="card flex h-full flex-col p-4" aria-label="Ask the expert">
      <header className="mb-3">
        <h3 className="text-sm font-semibold">Ask the expert</h3>
        <p className="text-xs text-sand-500">
          Answers come from {tourTitle}&apos;s own itinerary, prices and live seat counts.
        </p>
      </header>

      <div
        ref={scrollRef}
        className="min-h-40 flex-1 space-y-3 overflow-y-auto pr-1"
        aria-live="polite"
        aria-busy={streaming}
      >
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="chip min-h-11 text-left" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <article
            key={i}
            className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
              m.role === 'user' ? 'ml-auto bg-ink-800 text-sand-50' : 'bg-sand-50 text-ink-800'
            }`}
          >
            {m.text || (streaming && i === messages.length - 1 ? (
              <span className="text-sand-500">thinking…</span>
            ) : null)}
            {m.role === 'assistant' && m.sources?.length > 0 && (
              <p className="mt-2 text-[11px] text-sand-500">
                from: {m.sources.map((s) => s.ref ?? s.kind).join(', ')}
              </p>
            )}
          </article>
        ))}
      </div>

      {error && <p className="mt-2 rounded-xl bg-red-50 p-2 text-xs text-red-700">{error}</p>}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <label className="sr-only" htmlFor="assistant-input">
          Your question
        </label>
        <input
          id="assistant-input"
          className="field flex-1"
          placeholder="Ask about food, timings, refunds…"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
        />
        {streaming ? (
          <button type="button" className="btn-ghost" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn-primary" disabled={draft.trim().length < 3}>
            Ask
          </button>
        )}
      </form>
    </section>
  );
}
