// Gates read access to a pending-submissions queue behind a shared secret.
// Fails closed: if ADMIN_KEY isn't configured on the server, every request
// is rejected rather than left open.
export function requireAdminKey(req, res, next) {
  const configured = process.env.ADMIN_KEY;
  const provided = req.get('x-admin-key');
  if (!configured || provided !== configured) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
