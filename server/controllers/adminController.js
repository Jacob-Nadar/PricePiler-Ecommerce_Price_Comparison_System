const { asyncHandler } = require('../middleware/errorHandler');
const admin = require('../services/adminService');
const { AlertError } = require('../services/alertService');

const fail = (res, status, error) => res.status(status).json({ success: false, error });
const ok = (res, data) => res.json({ success: true, data });

function handle(fn) {
  return asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof admin.AdminError || err instanceof AlertError) return fail(res, err.status, err.message);
      throw err;
    }
  });
}

const idParam = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    fail(res, 400, 'Invalid id.');
    return null;
  }
  return id;
};

const query = (req) => ({
  search: typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : '',
  page: req.query.page,
  pageSize: req.query.pageSize,
  status: req.query.status,
  type: req.query.type,
  role: req.query.role,
  filter: req.query.filter,
});

module.exports = {
  overview: handle(async (_req, res) => ok(res, await admin.overview())),

  listUsers: handle(async (req, res) => ok(res, await admin.listUsers(query(req)))),
  getUser: handle(async (req, res) => {
    const id = idParam(req, res);
    if (id) ok(res, await admin.getUser(id));
  }),
  updateUser: handle(async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    const action = req.body?.action;
    if (action === 'disable' || action === 'enable') await admin.setUserDisabled(req.user.id, id, action === 'disable', req.ip);
    else if (action === 'sign_out') await admin.signOutUser(req.user.id, id, req.ip);
    else if (action === 'unlock') await admin.unlockUser(req.user.id, id, req.ip);
    else return fail(res, 400, 'Unknown action.');
    ok(res, { updated: true });
  }),
  deleteUser: handle(async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    await admin.deleteUser(req.user.id, id, req.ip);
    ok(res, { deleted: true });
  }),

  listPriceAlerts: handle(async (req, res) => ok(res, await admin.listPriceAlerts(query(req)))),
  listStockAlerts: handle(async (req, res) => ok(res, await admin.listStockAlerts(query(req)))),
  updateAlert: (kind) =>
    handle(async (req, res) => {
      const id = idParam(req, res);
      if (!id) return;
      await admin.updateAlert(req.user.id, kind, id, req.body?.action, req.ip);
      ok(res, { updated: true });
    }),
  deleteAlert: (kind) =>
    handle(async (req, res) => {
      const id = idParam(req, res);
      if (!id) return;
      await admin.deleteAlert(req.user.id, kind, id, req.ip);
      ok(res, { deleted: true });
    }),

  listListings: handle(async (req, res) => ok(res, await admin.listListings(query(req)))),
  checkListing: handle(async (req, res) => {
    const id = idParam(req, res);
    if (!id) return;
    await admin.checkListingNow(req.user.id, id, req.ip);
    ok(res, { scheduled: true });
  }),

  listNotifications: handle(async (req, res) => ok(res, await admin.listNotifications(query(req)))),
  listAudit: handle(async (req, res) => ok(res, await admin.listAudit(query(req)))),
};
