import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (axios.isCancel(err)) {
      const cancelled = new Error('Request cancelled');
      cancelled.cancelled = true;
      return Promise.reject(cancelled);
    }
    let message = err.response?.data?.error || err.message || 'Something went wrong. Please try again.';
    if (!err.response && err.code === 'ECONNABORTED') {
      message = 'The stores took too long to respond. Please try again.';
    } else if (!err.response) {
      message = 'Cannot reach the PricePiler server. Make sure the backend is running on port 5000.';
    }
    const error = new Error(message);
    error.status = err.response?.status;
    // Field-level validation errors and OTP details for forms.
    error.fields = err.response?.data?.fields || null;
    error.code = err.response?.data?.code || null;
    error.retryAfter = err.response?.data?.retryAfter || null;
    error.attemptsLeft = err.response?.data?.attemptsLeft ?? null;
    return Promise.reject(error);
  }
);

export const healthCheck = () => api.get('/health').then((r) => r.data);

export const searchProducts = (q, category = '', { signal, fresh } = {}) =>
  api
    .get('/products/search', { params: { q, category, ...(fresh ? { fresh: 1 } : {}) }, signal })
    .then((r) => r.data);

export const searchProductsAdvanced = (payload, { signal, fresh } = {}) =>
  api.post('/products/search', { ...payload, ...(fresh ? { fresh: true } : {}) }, { signal }).then((r) => r.data);

export const extractUrl = (url, { signal } = {}) =>
  api.post('/products/extract-url', { url }, { signal }).then((r) => r.data);

export const compareProduct = (payload, { signal, fresh } = {}) =>
  api.post('/products/compare', { ...payload, ...(fresh ? { fresh: true } : {}) }, { signal }).then((r) => r.data);

export const getOfferHistory = (offers, { signal, range = 'all' } = {}) =>
  api
    .post(
      '/products/history',
      {
        range,
        offers: offers
          .filter((o) => o.storeSlug && o.productUrl)
          .map(({ storeSlug, storeName, productUrl }) => ({ storeSlug, storeName, productUrl })),
      },
      { signal }
    )
    .then((r) => r.data);

export const getProduct = (id) => api.get(`/products/${id}`).then((r) => r.data);

export const getPriceHistory = (id, range = 'all') =>
  api.get(`/products/${id}/price-history`, { params: { range } }).then((r) => r.data);

// ---------- auth ----------
const data = (r) => r.data.data;

export const authApi = {
  me: () => api.get('/auth/me').then(data),
  register: (body) => api.post('/auth/register', body).then(data),
  verifyRegistration: (email, code) => api.post('/auth/register/verify', { email, code }).then(data),
  resendOtp: (email, purpose) => api.post('/auth/otp/resend', { email, purpose }).then(data),
  login: (email, password) => api.post('/auth/login', { email, password }).then(data),
  verifyLogin: (email, code) => api.post('/auth/login/verify', { email, code }).then(data),
  logout: () => api.post('/auth/logout').then(data),
  forgotPassword: (email) => api.post('/auth/password/forgot', { email }).then(data),
  resetPassword: (body) => api.post('/auth/password/reset', body).then(data),
  updateProfile: (body) => api.patch('/auth/me', body).then(data),
};

// ---------- signed-in user's data ----------
// Identity-only snapshot of a product the user is looking at. The server stores
// names and store URLs; it fetches prices itself and never trusts client prices.
export function productPayload(product) {
  return {
    product: {
      name: product.name,
      brand: product.brand || '',
      category: product.category || '',
      imageUrl: product.imageUrl || '',
      specifications: product.specifications || {},
    },
    offers: (product.offers || [])
      .filter((o) => o.storeSlug && o.productUrl)
      .slice(0, 20)
      .map((o) => ({
        storeSlug: o.storeSlug,
        productUrl: o.productUrl,
        title: o.title || o.name || product.name,
        externalId: o.externalId,
        imageUrl: o.imageUrl,
        specifications: o.specifications,
      })),
  };
}

export const adminApi = {
  overview: () => api.get('/admin/overview').then(data),
  users: (params) => api.get('/admin/users', { params }).then(data),
  user: (id) => api.get(`/admin/users/${id}`).then(data),
  userAction: (id, action) => api.patch(`/admin/users/${id}`, { action }).then(data),
  deleteUser: (id) => api.delete(`/admin/users/${id}`).then(data),
  alerts: (kind, params) => api.get(`/admin/alerts/${kind}`, { params }).then(data),
  alertAction: (kind, id, action) => api.patch(`/admin/alerts/${kind}/${id}`, { action }).then(data),
  deleteAlert: (kind, id) => api.delete(`/admin/alerts/${kind}/${id}`).then(data),
  listings: (params) => api.get('/admin/listings', { params }).then(data),
  checkListing: (id) => api.post(`/admin/listings/${id}/check`).then(data),
  notifications: (params) => api.get('/admin/notifications', { params }).then(data),
  audit: (params) => api.get('/admin/audit', { params }).then(data),
};

export const accountApi = {
  dashboard: () => api.get('/me/dashboard').then(data),
  saved: () => api.get('/me/saved').then(data),
  save: (product, clientKey) => api.post('/me/saved', { ...productPayload(product), clientKey }).then(data),
  unsave: (productId) => api.delete(`/me/saved/${productId}`).then(data),
  priceAlerts: () => api.get('/me/alerts/price').then(data),
  createPriceAlert: (product, { targetPrice, offer }) =>
    api
      .post('/me/alerts/price', {
        ...productPayload(product),
        targetPrice,
        ...(offer ? { scope: 'retailer', storeSlug: offer.storeSlug, productUrl: offer.productUrl } : { scope: 'all' }),
      })
      .then(data),
  updatePriceAlert: (id, body) => api.patch(`/me/alerts/price/${id}`, body).then(data),
  deletePriceAlert: (id) => api.delete(`/me/alerts/price/${id}`).then(data),
  stockAlerts: () => api.get('/me/alerts/stock').then(data),
  createStockAlert: (product, offer) =>
    api
      .post('/me/alerts/stock', { ...productPayload(product), storeSlug: offer.storeSlug, productUrl: offer.productUrl })
      .then(data),
  updateStockAlert: (id, body) => api.patch(`/me/alerts/stock/${id}`, body).then(data),
  deleteStockAlert: (id) => api.delete(`/me/alerts/stock/${id}`).then(data),
  notifications: (offset = 0, limit = 20) => api.get('/me/notifications', { params: { offset, limit } }).then(data),
};

export default api;
