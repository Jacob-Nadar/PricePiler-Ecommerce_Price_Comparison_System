import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { AuthCard, Field, FormMessage, OtpStep, PasswordInput, safeNext } from '../components/auth/AuthUI';
import { Spinner } from '../components/ui';
import { validateEmail } from '../utils/validation';

export default function Login() {
  const { user, setUser, accounts } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState(null);

  if (user && !otp) return <Navigate to={next} replace />;

  const finish = (signedIn) => {
    setUser(signedIn);
    toast(`Welcome back, ${signedIn.fullName.split(' ')[0]}!`);
    navigate(next, { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    const errors = { email: validateEmail(email), password: password ? '' : 'Password is required.' };
    setFieldErrors(errors);
    if (errors.email || errors.password) return;
    setBusy(true);
    setError('');
    try {
      const result = await authApi.login(email.trim(), password);
      if (result.otpRequired) setOtp(result);
      else finish(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (otp) {
    return (
      <AuthCard title="Two-step verification" subtitle="Your account asks for an email code on every sign-in.">
        <OtpStep
          email={otp.email}
          purpose="login"
          expiresInSeconds={otp.expiresInSeconds}
          resendInSeconds={otp.resendInSeconds}
          deliveryMode={otp.deliveryMode}
          submitLabel="Verify & log in"
          onVerify={async (code) => finish((await authApi.verifyLogin(otp.email, code)).user)}
          onResend={() => authApi.resendOtp(otp.email, 'login')}
          onBack={() => setOtp(null)}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Log in to manage your saved products and price alerts."
      footer={
        <>
          New to PricePiler?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
            Create an account
          </Link>
        </>
      }
    >
      {params.get('next') && (
        <div className="mb-4">
          <FormMessage type="info">Please log in to continue.</FormMessage>
        </div>
      )}
      {accounts === 'unavailable' && (
        <div className="mb-4">
          <FormMessage type="info">Accounts are unavailable because the server’s database is not connected.</FormMessage>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="login-email" label="Email" error={fieldErrors.email}>
          <input id="login-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@gmail.com" inputMode="email" />
        </Field>
        <Field id="login-password" label="Password" error={fieldErrors.password}>
          <PasswordInput id="login-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
            Forgot password?
          </Link>
        </div>
        <FormMessage type="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full py-3" disabled={busy || accounts === 'unavailable'}>
          {busy && <Spinner />}
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthCard>
  );
}
