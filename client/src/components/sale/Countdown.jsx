import { useCountdown } from '../../hooks/useCountdown.js';

/*
 * Counts down to a campaign's REAL end date (useCountdown works from an absolute
 * deadline, so a throttled background tab is still right when it wakes). It renders
 * nothing without an end date or once the deadline has passed — there is no fallback
 * "ends soon" and no invented deadline.
 */

const two = (n) => String(n).padStart(2, '0');

function split(totalSeconds) {
  return {
    d: Math.floor(totalSeconds / 86_400),
    h: Math.floor((totalSeconds % 86_400) / 3600),
    m: Math.floor((totalSeconds % 3600) / 60),
    s: totalSeconds % 60,
  };
}

export default function Countdown({ endsAt, variant = 'tiles', onExpire }) {
  const left = useCountdown(endsAt, onExpire);
  if (!endsAt || left <= 0) return null;

  const { d, h, m, s } = split(left);
  const spoken = `${d > 0 ? `${d} days ` : ''}${h} hours ${m} minutes left`;

  if (variant === 'inline') {
    return (
      <span className="tabular-nums" role="timer" aria-label={spoken}>
        {d > 0 ? `${d}d ${h}h ${two(m)}m` : `${two(h)}:${two(m)}:${two(s)}`}
      </span>
    );
  }

  const units = [
    ...(d > 0 ? [['Days', String(d)]] : []),
    ['Hours', two(h)],
    ['Mins', two(m)],
    ['Secs', two(s)],
  ];

  return (
    <div className="flex gap-2" role="timer" aria-label={spoken}>
      {units.map(([label, value]) => (
        <div
          key={label}
          className="min-w-[3.6rem] rounded-xl bg-white/10 px-3 py-2 text-center ring-1 ring-white/15 backdrop-blur-md"
        >
          <p className="text-2xl font-bold leading-none tabular-nums">{value}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-widest text-white/60">{label}</p>
        </div>
      ))}
    </div>
  );
}
