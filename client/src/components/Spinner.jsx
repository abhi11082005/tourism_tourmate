/** Small inline spinner; stops moving for people who ask for reduced motion. */
export default function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`${className} motion-safe:animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Three softly pulsing dots for "the assistant is working". */
export function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-sand-500" role="status">
      <span className="sr-only">Thinking</span>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
