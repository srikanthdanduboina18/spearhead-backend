const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole, requireClientScope } = require("../middleware/auth");
const { logAudit } = require("../lib/audit");
const { sendMail, templates } = require("../lib/mailer");
const env = require("../config/env");

const router = express.Router({ mergeParams: true });

const syncSchema = z.object({
  month: z.string(), // "2026-07"
  activeCodes: z.array(z.string()).min(1),
});

// POST /clients/:clientId/payroll/sync — dry-run diff only; does NOT mutate employee status.
// Returns which employees would be flagged for removal and which incoming codes are new.
router.post("/sync", requireAuth, requireClientScope, requireRole("SUPER_ADMIN", "SERVICING_TEAM", "CLIENT_HR"), async (req, res) => {
  const parse = syncSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
  const { activeCodes } = parse.data;

  const currentActive = await prisma.employee.findMany({
    where: { clientId: req.params.clientId, status: { not: "REMOVED" } },
  });

  const toRemove = currentActive.filter((e) => !activeCodes.includes(e.empCode));
  const knownCodes = currentActive.map((e) => e.empCode);
  const newCodes = activeCodes.filter((c) => !knownCodes.includes(c));

  res.json({
    toRemove: toRemove.map((e) => ({ id: e.id, empCode: e.empCode, name: e.name })),
    newCodes,
  });
});

// POST /clients/:clientId/payroll/confirm — actually applies the removals and records the batch.
const confirmSchema = z.object({
  month: z.string(),
  removeEmployeeIds: z.array(z.string()).default([]),
  newCodes: z.array(z.string()).default([]),
});
router.post("/confirm", requireAuth, requireClientScope, requireRole("SUPER_ADMIN", "SERVICING_TEAM", "CLIENT_HR"), async (req, res) => {
  const parse = confirmSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
  const { month, removeEmployeeIds, newCodes } = parse.data;

  const removedCodes = [];
  for (const id of removeEmployeeIds) {
    const emp = await prisma.employee.findUnique({ where: { id } });
    if (!emp || emp.clientId !== req.params.clientId) continue;
    await prisma.employee.update({
      where: { id },
      data: { status: "REMOVED", removedAt: new Date(), removedReason: `Not in ${month} payroll` },
    });
    removedCodes.push(emp.empCode);
    await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "employee.status.update", entity: "Employee", entityId: id, after: { status: "REMOVED" } });
  }

  const batch = await prisma.payrollBatch.create({
    data: { clientId: req.params.clientId, month, uploadedBy: req.user.subjectId, addedCodes: newCodes, removedCodes },
  });

  const topHr = await prisma.hrNode.findFirst({ where: { clientId: req.params.clientId, parentId: null } });
  if (topHr) {
    await sendMail({
      to: topHr.email,
      cc: [env.SPEARHEAD_TEAM_EMAIL],
      subject: `Payroll sync processed — ${month}`,
      html: templates.payrollSyncResult(month, newCodes, removedCodes),
    });
  }

  res.status(201).json(batch);
});

module.exports = router;
