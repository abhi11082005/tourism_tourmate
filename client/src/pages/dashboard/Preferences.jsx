import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { ErrorNote, SectionHeader } from '../../components/ui.jsx';

/*
 * Preferences. Each control saves on change — a "Save" button here would be a
 * second thing to remember for a screen where every setting is independent.
 *
 * The PATCH sends only the key that moved, and the server merges it into the
 * JSONB column in SQL, so two tabs editing different settings cannot overwrite
 * each other.
 *
 * Theme is the one setting with a local twin: ThemeContext owns what is on screen
 * (per device), the account copy is what a new device inherits. Saving here does
 * both, in that order.
 */

const MOODS = [
  'calm',
  'adventurous',
  'romantic',
  'foodie',
  'historic',
  'family',
  'nightlife',
  'nature',
  'spiritual',
  'photography',
];

export default function Preferences() {
  const { user, applyUser } = useAuth();
  const { setTheme } = useTheme();
  const prefs = user.preferences;

  const save = useMutation({
    mutationFn: (patch) => api.updatePreferences(patch),
    onSuccess: ({ user: next }) => applyUser(next),
  });

  const update = (patch) => save.mutate(patch);

  const toggleMood = (mood) => {
    const next = prefs.moods.includes(mood)
      ? prefs.moods.filter((m) => m !== mood)
      : [...prefs.moods, mood];
    // The server caps this at 12; stopping here avoids a 422 for something the
    // user cannot see the limit of.
    if (next.length > 12) return;
    update({ moods: next });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Preferences"
        hint="Applied everywhere you are signed in. Saved as you change them."
      />

      <ErrorNote error={save.error} />

      <section className="card space-y-4 p-4">
        <Row label="Appearance" hint="Follows your device when set to system.">
          <Segmented
            name="theme"
            value={prefs.theme}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['system', 'System'],
            ]}
            onChange={(v) => {
              setTheme(v); // repaint this device now
              update({ theme: v }); // remember it for the next one
            }}
          />
        </Row>

        <Row label="Currency" hint="Prices are charged in INR; this only changes display.">
          <Segmented
            name="currency"
            value={prefs.currency}
            options={[
              ['INR', '₹'],
              ['USD', '$'],
              ['EUR', '€'],
              ['GBP', '£'],
            ]}
            onChange={(v) => update({ currency: v })}
          />
        </Row>

        <Row label="Distance" hint="Used for “near me” results and route summaries.">
          <Segmented
            name="distanceUnit"
            value={prefs.distanceUnit}
            options={[
              ['km', 'Kilometres'],
              ['mi', 'Miles'],
            ]}
            onChange={(v) => update({ distanceUnit: v })}
          />
        </Row>

        <Row label="Language" hint="Interface language and date formatting.">
          <select
            className="field max-w-48"
            value={prefs.locale}
            onChange={(e) => update({ locale: e.target.value })}
          >
            <option value="en-IN">English (India)</option>
            <option value="en-GB">English (UK)</option>
            <option value="hi-IN">हिन्दी</option>
          </select>
        </Row>
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">Travel moods</h2>
          <p className="muted text-sm">
            Pick a few and the map will route you through places that match. Up to 12.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {MOODS.map((mood) => {
            const on = prefs.moods.includes(mood);
            return (
              <li key={mood}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleMood(mood)}
                  className={`chip capitalize transition ${
                    on
                      ? 'bg-teal-500/20 text-teal-900 dark:text-teal-100'
                      : 'bg-sand-100 hover:bg-sand-200 dark:bg-ink-800 dark:hover:bg-ink-700'
                  }`}
                >
                  {mood}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">Notifications</h2>
          <p className="muted text-sm">
            Booking confirmations are always sent by email — that one is your receipt.
          </p>
        </div>
        {[
          ['email', 'Trip reminders by email'],
          ['whatsapp', 'Invoices and reminders on WhatsApp'],
          ['promotions', 'Occasional offers and new tours'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-sand-300 accent-teal-600 dark:border-ink-600"
              checked={Boolean(prefs.notifications[key])}
              onChange={(e) => update({ notifications: { [key]: e.target.checked } })}
            />
            {label}
          </label>
        ))}
        <p className="faint text-xs">
          Delivery is not wired up yet — these choices are stored and honoured once it is.
        </p>
      </section>
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="faint text-xs">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/*
 * A radiogroup, not a row of buttons: arrow keys move between options and the
 * group announces itself once. Built from real radio inputs so that behaviour is
 * the browser's rather than ours.
 */
function Segmented({ name, value, options, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="inline-flex rounded-xl border border-sand-300 p-0.5 dark:border-ink-600"
    >
      {options.map(([option, label]) => {
        const on = option === value;
        return (
          <label
            key={option}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              on
                ? 'bg-ink-800 text-sand-50 dark:bg-sand-200 dark:text-ink-900'
                : 'hover:bg-sand-100 dark:hover:bg-ink-800'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={on}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {label}
          </label>
        );
      })}
    </div>
  );
}
