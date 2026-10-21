// Client-side checks mirror the server's rules (server/services/authService.js);
// the server always re-validates.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email) {
  const value = String(email || '').trim();
  if (!value) return 'Email address is required.';
  if (!EMAIL.test(value) || value.length > 254) return 'Enter a valid email address.';
  return '';
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (new TextEncoder().encode(value).length > 72) return 'Password must be at most 72 characters.';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Password must include at least one letter and one number.';
  return '';
}

export function validateName(name) {
  const value = String(name || '').trim();
  if (value.length < 2) return 'Please enter your full name.';
  if (value.length > 100) return 'Name must be at most 100 characters.';
  if (!/^[\p{L}\p{M}' .-]+$/u.test(value)) return 'Name can only contain letters, spaces, apostrophes, dots and hyphens.';
  return '';
}

export function validateConfirm(password, confirm) {
  if (!confirm) return 'Please confirm your password.';
  return password === confirm ? '' : 'Passwords do not match.';
}
