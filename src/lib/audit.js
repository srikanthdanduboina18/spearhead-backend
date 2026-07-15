const prisma = require("./prisma");

/**
 * Call this from any route that creates/updates/deletes a record so there's
 * a durable audit trail — expected of an insurance intermediary handling
 * PII and policy data.
 */
async function logAudit({ actorType, actorId, action, entity, entityId, before = null, after = null }) {
  await prisma.auditLog.create({
    data: { actorType, actorId, action, entity, entityId, before, after },
  });
}

module.exports = { logAudit };
