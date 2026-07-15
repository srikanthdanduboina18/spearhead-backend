const env = require("../config/env");
const { verifySessionJwt } = require("../lib/tokens");

/**
 * requireAuth — reads the session cookie, verifies it, attaches req.user.
 * req.user shape: { role: 'SUPER_ADMIN'|'SERVICING_TEAM'|'CLIENT_HR'|'EMPLOYEE', subjectId, clientId? }
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated. Request a new login link." });
  try {
    req.user = verifySessionJwt(token);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired or invalid. Request a new login link." });
  }
}

/** requireRole(['SUPER_ADMIN', 'SERVICING_TEAM']) — call after requireAuth. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do this." });
    }
    next();
  };
}

/**
 * requireClientScope — ensures a CLIENT_HR or EMPLOYEE user can only touch data
 * belonging to their own client. SUPER_ADMIN / SERVICING_TEAM bypass this check.
 * Expects the target clientId to be resolvable from req.params.clientId,
 * or attach req.resolvedClientId earlier in the chain for nested resources.
 */
function requireClientScope(req, res, next) {
  if (["SUPER_ADMIN", "SERVICING_TEAM"].includes(req.user.role)) return next();

  const targetClientId = req.params.clientId || req.resolvedClientId;
  if (!targetClientId || targetClientId !== req.user.clientId) {
    return res.status(403).json({ error: "You don't have access to this client's data." });
  }
  next();
}

/** requireSelf — an EMPLOYEE may only act on their own employeeId. */
function requireSelf(paramName = "employeeId") {
  return (req, res, next) => {
    if (["SUPER_ADMIN", "SERVICING_TEAM", "CLIENT_HR"].includes(req.user.role)) return next();
    if (req.user.role === "EMPLOYEE" && req.params[paramName] === req.user.subjectId) return next();
    return res.status(403).json({ error: "You can only access your own record." });
  };
}

module.exports = { requireAuth, requireRole, requireClientScope, requireSelf };
