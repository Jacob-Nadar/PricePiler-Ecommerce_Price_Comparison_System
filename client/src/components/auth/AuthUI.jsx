import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Icon from '../Icon';
import { Spinner } from '../ui';
import { useAuth } from '../../context/AuthContext';

export function AuthCard({ title, subtitle, children, footer }) {
  return (
    <div className="container-page flex min-h-[calc(100vh-4rem)] items-start justify-center py-10 sm:items-center">
      <div className="w-full max-w-md animate-slide-up">
        <div className="card p-6 shadow-lift sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, error, hint, id, children }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400" role="alert">
          <Icon name="alert" className="h-3.5 w-3.5" /> {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormMessage({ type = 'error', children }) {
  if (!children) return null;
  const tone =
    type === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
      : type === 'info'
        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
        : 'border-deal-500/30 bg-deal-50 text-deal-700 dark:bg-deal-500/10 dark:text-deal-500';
  return (
    <div className={`flex animate-fade-in items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${tone}`} role={type === 'error' ? 'alert' : 'status'}>
      <Icon name={type === 'error' ? 'alert' : type === 'info' ? 'info' : 'check'} className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function strength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

export function PasswordInput({ id, value, onChange, autoComplete, showStrength = false, invalid, placeholder }) {
  const [visible, setVisible] = useState(false);
  const score = strength(value);
  const labels = ['Too weak', 'Weak', 'Okay', 'Good', 'Strong'];
  const colors = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-deal-500', 'bg-deal-600'];
  return (
    <div>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={`input pr-11 ${invalid ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/10' : ''}`}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {showStrength && value && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i < score ? colors[score] : 'bg-slate-200 dark:bg-slate-700'}`} />
            ))}
          </div>
          <span className="text-xs text-slate-500">{labels[score]}</span>
        </div>
      )}
    </div>
  );
}

// Six single-digit boxes with paste, arrow-key and backspace support.
export function OtpInput({ value, onChange, disabled, autoFocus = true, invalid }) {
  const refs = useRef([]);
  // Latest value, updated synchronously: fast typing or autofill fires several
  // changes before React re-renders, and each must build on the previous one.
  const current = useRef(value);
  current.current = value;
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const commit = (next) => {
    current.current = next;
    onChange(next);
  };

  const setAt = (index, digit) => {
    const next = Array.from({ length: 6 }, (_, i) => current.current[i] || '');
    next[index] = digit;
    // Keep digits contiguous so the code string never has gaps.
    commit(next.join('').slice(0, 6));
  };

  const fillFrom = (index, text) => {
    const head = current.current.slice(0, index);
    const next = (head + text).slice(0, 6);
    commit(next);
    refs.current[Math.min(next.length, 5)]?.focus();
  };

  return (
    <div className="flex justify-between gap-2" onPaste={(e) => {
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      if (pasted) {
        e.preventDefault();
        current.current = '';
        fillFrom(0, pasted);
      }
    }}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? 6 : 1}
          aria-label={`Digit ${i + 1}`}
          className={`h-14 w-full min-w-0 rounded-xl border bg-white text-center font-display text-2xl font-bold text-slate-900 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:bg-slate-900 dark:text-white ${
            invalid ? 'border-rose-400' : 'border-slate-200 dark:border-slate-700'
          }`}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            // One-time-code autofill drops the whole code into the first box.
            if (typed.length > 1 && i === 0 && !digit) return fillFrom(0, typed);
            const d = typed.slice(-1);
            setAt(i, d);
            if (d && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !digit && i > 0) {
              setAt(i - 1, '');
              refs.current[i - 1]?.focus();
            } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

function useCountdown(seconds) {
  const [left, setLeft] = useState(seconds);
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [endsAt]);
  return [left, (next) => setEndsAt(Date.now() + next * 1000)];
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Code entry step shared by registration, login 2FA and password reset.
 * onVerify(code) must return a promise; errors show under the boxes.
 */
export function OtpStep({ email, purpose, expiresInSeconds = 300, resendInSeconds = 60, deliveryMode, onVerify, onResend, onBack, submitLabel = 'Verify', children }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [expiresLeft, resetExpiry] = useCountdown(expiresInSeconds);
  const [resendLeft, resetResend] = useCountdown(resendInSeconds);
  const [mode, setMode] = useState(deliveryMode);

  const submit = async (e) => {
    e?.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    try {
      await onVerify(code);
    } catch (err) {
      setError(err.message);
      // Server rejected the code: clear it. Local form errors keep the code.
      if (err.status) setCode('');
    } finally {
      setBusy(false);
    }
  };

  // Submit automatically once all six digits are in (unless more fields follow).
  useEffect(() => {
    if (code.length === 6 && !children) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const resend = async () => {
    setResending(true);
    setError('');
    try {
      const result = await onResend();
      resetExpiry(result.expiresInSeconds || 300);
      resetResend(result.resendInSeconds || 60);
      setMode(result.deliveryMode);
      setNotice('A new code has been sent.');
      setCode('');
    } catch (err) {
      setError(err.message);
      if (err.retryAfter) resetResend(err.retryAfter);
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="flex items-start gap-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900 dark:bg-brand-500/10 dark:text-brand-200">
        <Icon name="bell" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          We sent a 6-digit code to <strong className="break-all">{email}</strong>.
          {purpose === 'register' && ' Your account is created once you verify it.'}
        </span>
      </div>
      {mode === 'console' && (
        <FormMessage type="info">
          Email sending is not configured on this server yet, so the code was printed in the <strong>server terminal</strong>.
        </FormMessage>
      )}

      <OtpInput value={code} onChange={setCode} disabled={busy} invalid={Boolean(error)} />

      <div className="flex items-center justify-between text-xs">
        <span className={expiresLeft === 0 ? 'font-semibold text-rose-600' : 'text-slate-500 dark:text-slate-400'}>
          {expiresLeft === 0 ? 'Code expired — request a new one' : `Code expires in ${mmss(expiresLeft)}`}
        </span>
        <button
          type="button"
          onClick={resend}
          disabled={resendLeft > 0 || resending}
          className="font-semibold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-brand-300"
        >
          {resending ? 'Sending…' : resendLeft > 0 ? `Resend in ${resendLeft}s` : 'Resend code'}
        </button>
      </div>

      {children}

      <FormMessage type="error">{error}</FormMessage>
      {!error && <FormMessage type="success">{notice}</FormMessage>}

      <button type="submit" className="btn-primary w-full py-3" disabled={busy || code.length !== 6}>
        {busy && <Spinner />}
        {busy ? 'Verifying…' : submitLabel}
      </button>
      {onBack && (
        <button type="button" onClick={onBack} className="btn-ghost w-full">
          <Icon name="arrowLeft" className="h-4 w-4" /> Use a different email
        </button>
      )}
    </form>
  );
}

// Wraps pages that need a signed-in user; sends others to /login and back after.
export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

// Admin-only pages. The server enforces this too; this only avoids showing an empty page.
export function AdminRoute({ children }) {
  const { user } = useAuth();
  return (
    <ProtectedRoute>
      {user?.isAdmin ? (
        children
      ) : (
        <div className="container-page max-w-xl py-20 text-center">
          <Icon name="shield" className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Admins only</h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400">Your account does not have access to the admin panel.</p>
        </div>
      )}
    </ProtectedRoute>
  );
}

// Only allow in-app redirects after login (prevents open redirects via ?next=).
export function safeNext(value, fallback = '/dashboard') {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}
