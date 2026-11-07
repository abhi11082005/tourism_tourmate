import { CalendarDays, Landmark, Tag, Users } from 'lucide-react';

/*
 * A compact "at a glance" row. Every fact comes from the tour record; a fact whose
 * source field is missing is simply not rendered (no placeholders, no invented
 * values).
 */

export const prettyCategory = (tourType) =>
  String(tourType ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim();

export function buildFacts(tour) {
  const facts = [];

  if (tour.duration_days) {
    facts.push({
      key: 'duration',
      icon: CalendarDays,
      label: 'Duration',
      value: `${tour.duration_days}D${
        tour.duration_nights != null ? ` / ${tour.duration_nights}N` : ''
      }`,
    });
  }

  const category = prettyCategory(tour.tour_type);
  if (category) {
    facts.push({ key: 'category', icon: Tag, label: 'Style', value: category, capitalize: true });
  }

  const attractionCount = tour.attractions?.length ?? 0;
  if (attractionCount > 0) {
    facts.push({
      key: 'places',
      icon: Landmark,
      label: 'On the route',
      value: `${attractionCount} ${attractionCount === 1 ? 'place' : 'places'}`,
    });
  }

  if (tour.total_seats) {
    facts.push({
      key: 'group',
      icon: Users,
      label: 'Group size',
      value: `Up to ${tour.total_seats}`,
    });
  }

  return facts;
}

export default function TourQuickFacts({ tour }) {
  const facts = buildFacts(tour);
  if (!facts.length) return null;

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {facts.map(({ key, icon: Icon, label, value, capitalize }) => (
        <div
          key={key}
          className="flex items-center gap-3 rounded-2xl border border-sand-200 bg-white px-3 py-2.5 dark:border-ink-600 dark:bg-ink-900"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sand-100 text-sand-700 dark:bg-ink-800 dark:text-sand-300">
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <dt className="faint text-[11px] font-semibold uppercase tracking-wide">{label}</dt>
            <dd className={`truncate text-sm font-semibold ${capitalize ? 'capitalize' : ''}`}>
              {value}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  );
}
