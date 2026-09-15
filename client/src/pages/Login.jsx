import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const PASSWORD_RULE = 'At least 10 characters, with an uppercase letter, a lowercase letter and a number.';

const weakPassword = (v) =>
  v.length < 10 || !/[a-z]/.test(v) || !/[A-Z]/.test(v) || !/\d/.test(v);

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams(); // Added to read URL parameters
  
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', fullName: '', phone: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const destination = location.state?.from?.pathname ?? '/';

  // Catch OAuth errors sent back from the Express server via the URL
  useEffect(() => {
    const urlError = searchParams.get('error');
    if (urlError) {
      if (urlError === 'OAuthFailed') {
        setError('Google Sign-In failed. Please try again or use your email.');
      } else if (urlError === 'AccessDenied') {
        setError('Google login was cancelled.');
      } else {
        setError(urlError);
      }
    }
  }, [searchParams]);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const switchTo = (next) => {
    setMode(next);
    setError(null);
  };

  async function submit(e) {
    e.preventDefault();
    setError(null);

    if (mode === 'register' && weakPassword(form.password)) {
      setError(PASSWORD_RULE);
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await login({ email: form.email.trim(), password: form.password });
      } else {
        const phone = form.phone.trim();
        await register({
          email: form.email.trim(),
          password: form.password,
          fullName: form.fullName.trim(),
          ...(phone ? { phone } : {}),
        });
      }
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Bypasses the form completely to avoid accidental form submissions
  const handleGoogleAuth = () => {
    window.location.href = `/api/auth/google?redirect=${encodeURIComponent(destination)}`;
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 py-6">
      <header>
        <h1 className="text-2xl font-black">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="muted mt-1 text-sm">
          {location.state?.from
            ? 'Sign in to hold your seats — your selection is still there.'
            : 'You can keep browsing without an account.'}
        </p>
      </header>

      <form className="card space-y-3 p-4" onSubmit={submit}>
        {mode === 'register' && (
          <>
            <label className="block text-sm">
              Full name
              <input
                className="field mt-1"
                required
                minLength={2}
                value={form.fullName}
                onChange={set('fullName')}
                autoComplete="name"
              />
            </label>
            <label className="block text-sm">
              Phone (for WhatsApp invoices)
              <input
                className="field mt-1"
                type="tel"
                value={form.phone}
                onChange={set('phone')}
                autoComplete="tel"
              />
            </label>
          </>
        )}

        <label className="block text-sm">
          Email
          <input
            className="field mt-1"
            type="email"
            required
            value={form.email}
            onChange={set('email')}
            autoComplete="email"
          />
        </label>

        <label className="block text-sm">
          Password
          <input
            className="field mt-1"
            type="password"
            required
            minLength={mode === 'register' ? 10 : undefined}
            maxLength={128}
            value={form.password}
            onChange={set('password')}
            aria-describedby={mode === 'register' ? 'pw-rule' : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && (
            <span id="pw-rule" className="faint mt-1 block text-xs">
              {PASSWORD_RULE}
            </span>
          )}
        </label>

        {error && (
          <p className="notice-error bg-red-50 text-red-700 p-2 rounded text-sm" role="alert">
            {error}
          </p>
        )}

        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Just a moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <div className="faint flex items-center gap-3 py-1 text-xs">
          <span className="h-px flex-1 bg-sand-100 dark:bg-ink-700" />
          or
          <span className="h-px flex-1 bg-sand-100 dark:bg-ink-700" />
        </div>

        {/* Changed from an <a> tag to a <button> to explicitly prevent form conflicts */}
        <button
          type="button"
          onClick={handleGoogleAuth}
          className="btn-ghost w-full"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-center text-sm">
        {mode === 'login' ? (
          <>
            New here?{' '}
            <button type="button" className="font-semibold underline" onClick={() => switchTo('register')}>
              Create an account
            </button>
          </>
        ) : (
          <>
            Already have one?{' '}
            <button type="button" className="font-semibold underline" onClick={() => switchTo('login')}>
              Sign in
            </button>
          </>
        )}
      </p>

      <p className="faint text-center text-xs">
        <Link to="/" className="underline">
          Keep browsing as a guest
        </Link>
      </p>
    </div>
  );
}