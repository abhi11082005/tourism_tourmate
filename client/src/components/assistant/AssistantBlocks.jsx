import { Link } from 'react-router-dom';
import { inr, mmss, shortDate } from '../../lib/format.js';
import { durationLabel, ratingOf } from '../TourBits.jsx';
import QuoteCard from './QuoteCard.jsx';

/*
 * Renders the structured blocks the server attaches to an assistant reply.
 *
 * Blocks are built from database rows by the assistant tools — the model writes
 * the sentence, never the card — so a price or seat count here cannot be a
 * hallucination. Unknown block types are ignored, which keeps an older client
 * working against a newer server.
 */

const titleCase = (s = '') => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

const distance = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);

function TourCards({ tours }) {
  return (
    <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1" aria-label="Suggested tours">
      {tours.map((t) => {
        const rating = ratingOf({ avg_rating: t.rating });
        const length = durationLabel({ duration_days: t.days, duration_nights: t.nights });
        return (
          <li key={t.id} className="w-44 shrink-0 snap-start">
            <Link
              to={`/tours/${t.slug}`}
              className="card block h-full p-3 transition hover:border-sand-300 dark:hover:border-ink-500"
            >
              <p className="line-clamp-2 text-sm font-semibold">{t.title}</p>
              <p className="faint mt-1 text-xs">
                {[titleCase(t.tourType), length].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-2 text-sm">
                <span className="font-bold">{inr(t.basePrice)}</span>
                <span className="faint text-xs"> /seat</span>
              </p>
              {rating && (
                <p className="faint mt-0.5 text-xs">
                  ★ {rating} ({t.reviews})
                </p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Nearby({ attractions }) {
  return (
    <ul className="card divide-y divide-sand-100 dark:divide-ink-600" aria-label="Places nearby">
      {attractions.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">{a.name}</span>
            <span className="faint block text-xs">
              {[titleCase(a.category), a.city].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span className="faint shrink-0 text-xs">{distance(a.distanceMeters)}</span>
        </li>
      ))}
    </ul>
  );
}

function Offers({ offers }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Current offers">
      {offers.map((o) => (
        <li key={o.name} className="chip bg-sand-50 dark:bg-ink-800">
          {o.discountPercent}% off · {o.name}
        </li>
      ))}
    </ul>
  );
}

function Availability({ dates }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Open dates">
      {dates.map((d) => (
        <li
          key={d.date}
          className={`chip ${d.fitsParty === false ? 'line-through opacity-50' : ''}`}
          title={d.fitsParty === false ? 'Not enough seats for your group' : undefined}
        >
          {shortDate(d.date)} · {d.seatsLeft} left
        </li>
      ))}
    </ul>
  );
}

function CheckoutState({ block }) {
  const resumable = block.status === 'PENDING' && block.holdActive;
  return (
    <section className="card space-y-1 p-3 text-sm" aria-label="Booking status">
      <p className="font-semibold">{block.tour}</p>
      <p className="faint text-xs">
        {block.reference} · {block.seats} seat{block.seats === 1 ? '' : 's'} · {inr(block.totalAmount)}
      </p>
      <p>
        {block.status === 'CONFIRMED'
          ? 'Confirmed'
          : resumable
            ? `Seats held — ${mmss(block.secondsLeft)} left when checked`
            : block.status === 'PENDING'
              ? 'The hold has expired'
              : titleCase(block.status)}
      </p>
      {resumable && (
        <Link to={`/checkout/${block.bookingId}`} className="btn-primary mt-2 w-full">
          Resume checkout
        </Link>
      )}
    </section>
  );
}

function Block({ block }) {
  switch (block.type) {
    case 'tour_cards':
      return <TourCards tours={block.tours} />;
    case 'nearby':
      return <Nearby attractions={block.attractions} />;
    case 'offers':
      return <Offers offers={block.offers} />;
    case 'availability':
      return <Availability dates={block.dates} />;
    case 'quote':
      return <QuoteCard block={block} />;
    case 'checkout_state':
      return <CheckoutState block={block} />;
    default:
      return null;
  }
}

export default function AssistantBlocks({ blocks }) {
  if (!blocks?.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {blocks.map((b, i) => (
        <Block key={`${b.type}-${i}`} block={b} />
      ))}
    </div>
  );
}
