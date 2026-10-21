import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { AuthCard, Field, FormMessage, OtpStep, PasswordInput, safeNext } from '../components/auth/AuthUI';
import { Spinner } from '../components/ui';
import { validateConfirm, validateEmail, validateName, validatePassword } from '../utils/validation';

export default function Register() {
  const { user, setUser, accounts } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState(null); // { email, expiresInSeconds, resendInSeconds, deliveryMode }

  if (user && !otp) return <Navigate to={next} replace />;

  const validate = (values) => ({
    fullName: validateName(values.fullName),
    email: validateEmail(values.email),
    password: validatePassword(values.password),
    confirmPassword: validateConfirm(values.password, values.confirmPassword),
  });

  const update = (key) => (e) => {
    const values = { ...form, [key]: e.target.value };
    setForm(values);
    if (touched[key] || (key === 'password' && touched.confirmPassword)) setErrors(validate(values));
  };
  const blur = (key) => () => {
    setTouched((t) => ({ ...t, [key]: true }));
    setErrors(validate(form));
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    setTouched({ fullName: true, email: true, password: true, confirmPassword: true });
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    setError('');
    try {
      const result = await authApi.register(form);
      setOtp(result);
    } catch (err) {
      setError(err.message);
      if (err.fields) setErrors((prev) => ({ ...prev, ...err.fields }));
    } finally {
      setBusy(false);
    }
  };

  if (otp) {
    return (
      <AuthCard title="Verify your email" subtitle="Enter the code to finish creating your account.">
        <OtpStep
          email={otp.email}
          purpose="register"
          expiresInSeconds={otp.expiresInSeconds}
          resendInSeconds={otp.resendInSeconds}
          deliveryMode={otp.deliveryMode}
          submitLabel="Verify & create account"
          onVerify={async (code) => {
            const result = await authApi.verifyRegistration(otp.email, code);
            setUser(result.user);
            toast(`Welcome to PricePiler, ${result.user.fullName.split(' ')[0]}!`);
            navigate(next, { replace: true });
          }}
          onResend={() => authApi.resendOtp(otp.email, 'register')}
          onBack={() => setOtp(null)}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Save products, track price history and get email alerts when prices drop or items come back in stock."
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
            Log in
          </Link>
        </>
      }
    >
      {accounts === 'unavailable' && (
        <div className="mb-4">
          <FormMessage type="info">Accounts are unavailable because the server’s database is not connected.</FormMessage>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="reg-name" label="Full name" error={touched.fullName && errors.fullName}>
          <input id="reg-name" className="input" value={form.fullName} onChange={update('fullName')} onBlur={blur('fullName')} autoComplete="name" placeholder="Priya Sharma" />
        </Field>
        <Field id="reg-email" label="Gmail address" error={touched.email && errors.email} hint="We’ll send a verification code to this address.">
          <input
            id="reg-email"
            type="email"
            className="input"
            value={form.email}
            onChange={update('email')}
            onBlur={blur('email')}
            autoComplete="email"
            placeholder="you@gmail.com"
            inputMode="email"
          />
        </Field>
        <Field id="reg-password" label="Password" error={touched.password && errors.password} hint="At least 8 characters with a letter and a number.">
          <PasswordInput id="reg-password" value={form.password} onChange={update('password')} autoComplete="new-password" showStrength invalid={Boolean(touched.password && errors.password)} />
        </Field>
        <Field id="reg-confirm" label="Confirm password" error={touched.confirmPassword && errors.confirmPassword}>
          <PasswordInput
            id="reg-confirm"
            value={form.confirmPassword}
            onChange={update('confirmPassword')}
            autoComplete="new-password"
            invalid={Boolean(touched.confirmPassword && errors.confirmPassword)}
          />
        </Field>
        <FormMessage type="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full py-3" disabled={busy || accounts === 'unavailable'}>
          {busy && <Spinner />}
          {busy ? 'Sending code…' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  );
}
