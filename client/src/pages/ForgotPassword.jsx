import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { AuthCard, Field, FormMessage, OtpStep, PasswordInput } from '../components/auth/AuthUI';
import { Spinner } from '../components/ui';
import { validateConfirm, validateEmail, validatePassword } from '../utils/validation';

export default function ForgotPassword() {
  const { setUser } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwErrors, setPwErrors] = useState({});

  const request = async (e) => {
    e.preventDefault();
    const problem = validateEmail(email);
    setEmailError(problem);
    if (problem) return;
    setBusy(true);
    setError('');
    try {
      const result = await authApi.forgotPassword(email.trim());
      setOtp({ ...result, email: email.trim().toLowerCase() });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (otp) {
    return (
      <AuthCard title="Set a new password" subtitle={otp.message}>
        <OtpStep
          email={otp.email}
          purpose="reset"
          expiresInSeconds={otp.expiresInSeconds}
          resendInSeconds={otp.resendInSeconds}
          deliveryMode={otp.deliveryMode}
          submitLabel="Reset password"
          onBack={() => setOtp(null)}
          onResend={() => authApi.resendOtp(otp.email, 'reset')}
          onVerify={async (code) => {
            const errors = { password: validatePassword(password), confirm: validateConfirm(password, confirm) };
            setPwErrors(errors);
            if (errors.password || errors.confirm) throw new Error('Please fix the password fields.');
            await authApi.resetPassword({ email: otp.email, code, password, confirmPassword: confirm });
            setUser(null);
            toast('Password updated — please log in with your new password');
            navigate('/login', { replace: true });
          }}
        >
          <Field id="reset-password" label="New password" error={pwErrors.password} hint="At least 8 characters with a letter and a number.">
            <PasswordInput id="reset-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" showStrength invalid={Boolean(pwErrors.password)} />
          </Field>
          <Field id="reset-confirm" label="Confirm new password" error={pwErrors.confirm}>
            <PasswordInput id="reset-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" invalid={Boolean(pwErrors.confirm)} />
          </Field>
        </OtpStep>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we’ll send you a code to reset it."
      footer={
        <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-300">
          Back to log in
        </Link>
      }
    >
      <form onSubmit={request} className="space-y-4" noValidate>
        <Field id="forgot-email" label="Email" error={emailError}>
          <input id="forgot-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@gmail.com" />
        </Field>
        <FormMessage type="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full py-3" disabled={busy}>
          {busy && <Spinner />}
          {busy ? 'Sending…' : 'Send reset code'}
        </button>
      </form>
    </AuthCard>
  );
}
