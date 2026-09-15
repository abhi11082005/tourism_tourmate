import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, auth as tokenStore } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { stamp } from '../../lib/format.js';
import LocationPicker from '../../components/LocationPicker.jsx';
import { ErrorNote, SectionHeader } from '../../components/ui.jsx';

/*
 * Profile management: the details, where "home" is, and the password.
 *
 * The form is seeded from the cached user and submits only what changed — a PATCH
 * that resends every field would overwrite a value another tab just saved. The
 * server's whitelist means an unchanged field is genuinely left alone.
 *
 * Changing a password returns a fresh token (the old one is invalidated by
 * password_changed_at), so that response is fed back through the auth context
 * rather than discarded, or the user would be signed out by their own success.
 */

const FIELDS = [
  ['fullName', 'Full name', { required: true, autoComplete: 'name' }],
  ['email', 'Email', { readOnly: true, autoComplete: 'email' }],
  ['phone', 'Phone', { type: 'tel', autoComplete: 'tel', hint: 'Used for WhatsApp invoices.' }],
  ['homeCity', 'Home city', { autoComplete: 'address-level2' }],
  ['homeCountry', 'Home country', { autoComplete: 'country-name' }],
  ['avatarUrl', 'Avatar URL', { type: 'url', hint: 'Any public image URL — Cloudinary works well.' }],
];

const fromUser = (user) => ({
  fullName: user?.fullName ?? '',
  email: user?.email ?? '',
  phone: user?.phone ?? '',
  homeCity: user?.home?.city ?? '',
  homeCountry: user?.home?.country ?? '',
  avatarUrl: user?.avatarUrl ?? '',
});

export default function Profile() {
  const { user, applyUser } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => fromUser(user));
  const [saved, setSaved] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const save = useMutation({
    mutationFn: (patch) => api.updateProfile(patch),
    onSuccess: ({ user: next }) => {
      applyUser(next);
      setForm(fromUser(next));
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  const submit = (e) => {
    e.preventDefault();
    const base = fromUser(user);
    // email is display-only; the server does not accept it here.
    const patch = Object.fromEntries(
      Object.entries(form).filter(([k, v]) => k !== 'email' && v !== base[k])
    );
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    save.mutate(patch);
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Profile" hint="What we call you, and where to send your documents." />

      <form className="card space-y-3 p-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([key, label, opts]) => (
            <label key={key} className="block text-sm">
              {label}
              <input
                className="field mt-1"
                value={form[key]}
                onChange={set(key)}
                type={opts.type ?? 'text'}
                required={opts.required}
                readOnly={opts.readOnly}
                autoComplete={opts.autoComplete}
                aria-describedby={opts.hint ? `${key}-hint` : undefined}
              />
              {opts.hint && (
                <span id={`${key}-hint`} className="faint mt-1 block text-xs">
                  {opts.hint}
                </span>
              )}
              {opts.readOnly && (
                <span className="faint mt-1 block text-xs">
                  Contact support to change your sign-in email.
                </span>
              )}
            </label>
          ))}
        </div>

        <ErrorNote error={save.error} />
        {saved && !save.isPending && <p className="notice-ok">Profile saved.</p>}

        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <span className="faint text-xs">
            {user?.provider === 'GOOGLE' ? 'Signed in with Google' : `Member since ${stamp(user.createdAt)}`}
          </span>
        </div>
      </form>

      <section className="card space-y-2 p-4">
        <h2 className="font-bold">Your location</h2>
        <p className="muted text-sm">
          {user?.home?.city
            ? `Home is set to ${user.home.city}${user.home.country ? `, ${user.home.country}` : ''}.`
            : 'We do not know where you are yet, so “near me” results are guesses.'}
          {user?.lastLocation && (
            <>
              {' '}
              Last reading {stamp(user.lastLocation.at)} ({user.lastLocation.source.toLowerCase()}).
            </>
          )}
        </p>
        <LocationPicker />
      </section>

      <PasswordCard />
    </div>
  );
}

/*
 * Kept in its own component so a keystroke in the password boxes does not
 * re-render the profile form, and so the two never share error state — "current
 * password is wrong" appearing under the phone field would be baffling.
 */
function PasswordCard() {
  const { user, applyUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: (body) => api.changePassword(body),
    onSuccess: (data) => {
      // Stamping password_changed_at invalidates every token minted earlier,
      // including the one this request arrived with. Storing the fresh token is
      // what keeps this tab signed in while every other device is signed out.
      if (data?.token) tokenStore.set(data.token);
      if (data?.user) applyUser(data.user);
      setForm({ currentPassword: '', newPassword: '' });
      setDone(true);
    },
  });

  if (user?.provider === 'GOOGLE') {
    return (
      <section className="card p-4">
        <h2 className="font-bold">Password</h2>
        <p className="muted mt-1 text-sm">
          This account signs in with Google, so there is no password to change here.
        </p>
      </section>
    );
  }

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setDone(false);
  };

  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-bold">Password</h2>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate(form);
        }}
      >
        <label className="block text-sm">
          Current password
          <input
            className="field mt-1"
            type="password"
            required
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={set('currentPassword')}
          />
        </label>
        <label className="block text-sm">
          New password
          <input
            className="field mt-1"
            type="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            aria-describedby="new-pw-hint"
            value={form.newPassword}
            onChange={set('newPassword')}
          />
          <span id="new-pw-hint" className="faint mt-1 block text-xs">
            At least 10 characters, with an uppercase letter, a lowercase letter and a number.
          </span>
        </label>

        <div className="sm:col-span-2">
          <ErrorNote error={change.error} />
          {done && (
            <p className="notice-ok">
              Password changed. Other devices have been signed out.
            </p>
          )}
          <button className="btn-primary mt-2" disabled={change.isPending}>
            {change.isPending ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}
