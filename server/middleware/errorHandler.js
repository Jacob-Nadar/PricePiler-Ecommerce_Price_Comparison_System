function notFound(req, res) {
  res.status(404).json({ success: false, error: 'Resource not found', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  // Only surface messages the code set deliberately (an explicit err.status).
  // Anything else is an unexpected failure whose raw message could reveal
  // internals (SQL text, stack details), so it is replaced with a generic one;
  // the full error is still logged server-side below.
  const message = err.status ? err.message || 'Request failed' : 'Internal server error';
  if (process.env.NODE_ENV !== 'production') {
    console.error('[error]', err);
  }
  res.status(status).json({ success: false, error: message });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { notFound, errorHandler, asyncHandler };
