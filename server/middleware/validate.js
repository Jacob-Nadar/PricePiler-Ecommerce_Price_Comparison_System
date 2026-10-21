const { isValidUrl } = require('../utils/httpClient');

function validateSearchQuery(req, _res, next) {
  const body = req.body || {};
  const q = String(req.query.q || body.q || '').trim();
  const category = String(req.query.category || body.category || '').trim();
  if (!q && !category) {
    return next({ status: 400, message: 'Search query "q" or "category" is required' });
  }
  if (q.length > 300) {
    return next({ status: 400, message: 'Search query is too long' });
  }
  next();
}

function validateProductSearchBody(req, _res, next) {
  const { name, brand, model, specifications, category } = req.body || {};
  if (!name || !String(name).trim()) {
    return next({ status: 400, message: 'Product name is required' });
  }
  if (
    specifications != null &&
    (typeof specifications !== 'object' || Array.isArray(specifications))
  ) {
    return next({ status: 400, message: 'specifications must be an object' });
  }
  const normalizedSpecifications = {};
  for (const [key, value] of Object.entries(specifications || {})) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return next({ status: 400, message: `specification "${key}" must be a string or number` });
    }
    const normalizedValue = String(value).trim();
    if (normalizedValue.length > 100) {
      return next({ status: 400, message: `specification "${key}" is too long` });
    }
    if (normalizedValue) normalizedSpecifications[key] = normalizedValue;
  }
  if (String(name).trim().length > 300) {
    return next({ status: 400, message: 'Product name is too long' });
  }
  req.body = {
    name: String(name).trim(),
    brand: brand ? String(brand).trim().slice(0, 100) : '',
    model: model ? String(model).trim().slice(0, 100) : '',
    category: category ? String(category).trim().slice(0, 100) : '',
    specifications: normalizedSpecifications,
    ...(req.body.fresh != null ? { fresh: req.body.fresh } : {}),
  };
  next();
}

function validateExtractUrl(req, _res, next) {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return next({ status: 400, message: 'url is required' });
  }
  if (!isValidUrl(url)) {
    return next({ status: 400, message: 'Invalid URL format' });
  }
  if (url.length > 2048) {
    return next({ status: 400, message: 'URL is too long' });
  }
  next();
}

// Compare requests carry the same shape as an advanced search, so they get the same
// checks (non-object or oversized spec values used to pass straight through here).
function validateCompareBody(req, res, next) {
  validateProductSearchBody(req, res, next);
}

module.exports = {
  validateSearchQuery,
  validateProductSearchBody,
  validateExtractUrl,
  validateCompareBody,
};
