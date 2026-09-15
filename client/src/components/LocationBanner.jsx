import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import LocationPicker from './LocationPicker.jsx';

/*
 * Shown only when the browser has told us it will not share a location and the
 * account has no saved city either (`needsManualLocation`). That condition is
 * the whole point: a banner that appears while the permission dialog is still
 * open would be nagging about a question the user is in the middle of answering.
 *
 * Dismissal is per page-load and deliberately not persisted — the same prompt is
 * always available in the dashboard Profile card, so there is nothing to
 * permanently suppress, and a stored flag would hide the feature from someone
 * who later wants it.
 */
export default function LocationBanner() {
  const { needsManualLocation } = useAuth();
  const [hidden, setHidden] = useState(false);

  if (!needsManualLocation || hidden) return null;

  return (
    <aside
      aria-labelledby="loc-banner-title"
      className="border-b border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="loc-banner-title" className="text-sm font-semibold">
              Where are you travelling from?
            </h2>
            <p className="muted text-xs">
              We use it to sort attractions by distance and to suggest tours nearby. Nothing is
              shared with anyone else.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="btn-ghost shrink-0 px-2 py-1 text-xs"
          >
            Not now
          </button>
        </div>

        <LocationPicker compact />
      </div>
    </aside>
  );
}
