import { ThinkingDots } from './Spinner.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { chatAssistant, loadAssistantHistory } from '../lib/api.js';
import { useGeolocation } from '../hooks/useGeolocation.js';
import AssistantBlocks from './assistant/AssistantBlocks.jsx';

/*
 * TourMate assistant chat panel.
 *
 * Two modes, one component:
 *   - on a tour page (`tourId` set): "Ask the expert" about that tour;
 *   - anywhere else (no `tourId`): the central chatbot — discover tours, offers,
 *     places near you.
 *
 * The answer is streamed, so the first words land in a few hundred milliseconds
 * even when the model takes two seconds to finish — that is how the 3-second
 * budget is met without a faster model.
 *
 * Tokens are buffered and flushed once per animation frame. Calling setState on
 * every token (there can be 200) is what makes a streaming chat stutter.
 *
 * Location is shared only when the traveller taps "Use my location" — the
 * browser permission prompt never appears on its own.
 */

const TOUR_SUGGESTIONS = [
  'Is the AC coach worth it?',
  'What is included in the price?',
  'How many seats are left this weekend?',
  'What happens if I cancel three days before?',
];

const CENTRAL_SUGGESTIONS = [
  'Cheapest tours under ₹3000',
  'Any offers running right now?',
  'What is near me?',
  'Find a heritage tour',
];

export default function AssistantPanel({ tourId, tourTitle }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [shared, setShared] = useState(null); // { lat, lng } once the traveller opts in

  const abortRef = useRef(null);
  const bufferRef = useRef('');
  const frameRef = useRef(0);
  const scrollRef = useRef(null);

  // `request` only fires from the button below; `auto` stays false on purpose.
  const geo = useGeolocation();
  const askedForLocation = useRef(false);

  const suggestions = tourId ? TOUR_SUGGESTIONS : CENTRAL_SUGGESTIONS;

  useEffect(() => () => abortRef.current?.abort(), []);

  // Carry the words of an existing conversation across page changes and reloads.
  useEffect(() => {
    const controller = new AbortController();
    loadAssistantHistory({ signal: controller.signal }).then((past) => {
      if (!controller.signal.aborted && past.length) {
        setMessages((prev) => (prev.length ? prev : past.map((m) => ({ role: m.role, text: m.text }))));
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    if (askedForLocation.current && geo.state === 'granted' && geo.isPrecise) {
      setShared({ lat: geo.coords.lat, lng: geo.coords.lng });
    }
  }, [geo.state, geo.isPrecise, geo.coords.lat, geo.coords.lng]);

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

  const patchLast = useCallback(
    (patch) =>
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], ...patch(next[next.length - 1]) };
        return next;
      }),
    []
  );

  const ask = useCallback(
    async (question) => {
      const trimmed = question.trim();
      if (trimmed.length < 2 || streaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setDraft('');
      setStreaming(true);
      setMessages((prev) => [
        ...prev,
        { role: 'user', text: trimmed },
        { role: 'assistant', text: '', sources: [], blocks: [] },
      ]);

      try {
        await chatAssistant(
          { tourId, message: trimmed, ...(shared ? { location: shared } : {}) },
          {
            signal: controller.signal,
            onSources: (sources) => patchLast(() => ({ sources })),
            onUi: (blocks) => patchLast((m) => ({ blocks: [...(m.blocks ?? []), ...blocks] })),
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
    [flush, patchLast, shared, streaming, tourId]
  );

  const shareLocation = () => {
    askedForLocation.current = true;
    geo.request();
  };

  const locating = geo.state === 'locating';

  return (
    <section
      className="card flex h-full min-w-0 flex-col p-4 text-ink-900 shadow-xl dark:text-sand-50"
      aria-label={tourId ? 'Ask the expert' : 'TourMate assistant'}
    >
      <header className="mb-3">
        <h3 className="pr-8 text-sm font-semibold">{tourId ? 'Ask the expert' : 'TourMate assistant'}</h3>
        <p className="faint text-xs">
          {tourId
            ? `Answers come from ${tourTitle}'s own itinerary, prices and live seat counts.`
            : 'Find tours, check offers and see what is near you.'}
        </p>
      </header>

      <div
        ref={scrollRef}
        className="min-h-40 min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden pr-1"
        aria-live="polite"
        aria-busy={streaming}
      >
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} type="button" className="chip min-h-11 text-left" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const waiting = !m.text && streaming && i === messages.length - 1;
          return (
            <div key={i} className="min-w-0 space-y-2">
              {(m.text || waiting) && (
                <article
                  className={`max-w-[90%] break-words rounded-2xl px-3 py-2 text-sm ${
                    isUser
                      ? 'ml-auto bg-ink-800 text-sand-50 dark:bg-sand-300 dark:text-ink-900'
                      : 'bg-sand-100 text-ink-900 dark:bg-ink-800 dark:text-sand-50'
                  }`}
                >
                  {m.text || <ThinkingDots />}
                  {m.role === 'assistant' && m.sources?.length > 0 && (
                    <p className="faint mt-2 text-[11px]">
                      from: {m.sources.map((s) => s.ref ?? s.kind).join(', ')}
                    </p>
                  )}
                </article>
              )}
              {/* Cards (prices, dates, tours) sit under the text at full width, on the panel itself. */}
              {m.blocks?.length > 0 && <AssistantBlocks blocks={m.blocks} />}
            </div>
          );
        })}
      </div>

      {error && <p className="notice-error mt-2 !p-2 !text-xs" role="alert">{error}</p>}

      <div className="mt-3 flex items-center justify-between gap-2 text-xs">
        {shared ? (
          <span className="faint">Using your location</span>
        ) : (
          <button
            type="button"
            className="chip min-h-9"
            onClick={shareLocation}
            disabled={locating}
            aria-busy={locating}
          >
            {locating ? 'Locating…' : 'Use my location'}
          </button>
        )}
        {geo.state === 'denied' && !shared && (
          <span className="faint">Location blocked — name a city instead.</span>
        )}
      </div>

      <form
        className="mt-2 flex gap-2"
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
          placeholder={tourId ? 'Ask about food, timings, refunds…' : 'Ask about tours, offers, places…'}
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
        />
        {streaming ? (
          <button type="button" className="btn-ghost" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" className="btn-primary" disabled={draft.trim().length < 2}>
            Ask
          </button>
        )}
      </form>
    </section>
  );
}
