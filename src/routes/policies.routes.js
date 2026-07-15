const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole, requireClientScope } = require("../middleware/auth");
const { logAudit } = require("../lib/audit");
const { sendMail, templates } = require("../lib/mailer");

const router = express.Router({ mergeParams: true });

const createPolicySchema = z.object({
  type: z.enum(["HEALTH", "ACCIDENT", "LIFE", "GRATUITY"]),
  insurer: z.string().min(2),
  tpa: z.string().optional(),
});

router.get("/", requireAuth, requireClientScope, async (req, res) => {
  const policies = await prisma.policy.findMany({ where: { clientId: req.params.clientId } });
  res.json(policies);
});

router.post("/", requireAuth, requireClientScope, requireRole("SUPER_ADMIN", "SERVICING_TEAM"), async (req, res) => {
  const parse = createPolicySchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });

  const policy = await prisma.policy.create({
    data: { ...parse.data, clientId: req.params.clientId, status: "PENDING_ISSUANCE" },
  });
  await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "policy.create", entity: "Policy", entityId: policy.id, after: policy });
  res.status(201).json(policy);
});

// POST /clients/:clientId/policies/:policyId/issue
// Assigns the insurer-issued policy number and flips SUBMITTED members opted into
// this policy type to ACTIVE — mirroring "collective issuance" from the design doc.
const issueSchema = z.object({ policyNumber: z.string().min(3), startDate: z.string().optional(), endDate: z.string().optional() });
router.post("/:policyId/issue", requireAuth, requireClientScope, requireRole("SUPER_ADMIN", "SERVICING_TEAM"), async (req, res) => {
  const parse = issueSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });

  const policy = await prisma.policy.findUnique({ where: { id: req.params.policyId } });
  if (!policy || policy.clientId !== req.params.clientId) return res.status(404).json({ error: "Policy not found." });

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.policy.update({
      where: { id: policy.id },
      data: {
        policyNumber: parse.data.policyNumber,
        status: "ISSUED",
        startDate: parse.data.startDate ? new Date(parse.data.startDate) : undefined,
        endDate: parse.data.endDate ? new Date(parse.data.endDate) : undefined,
      },
    });

    const memberLinks = await tx.employeePolicy.findMany({
      where: { policyId: policy.id },
      include: { employee: true },
    });

    for (const link of memberLinks) {
      if (link.employee.status === "SUBMITTED") {
        await tx.employee.update({ where: { id: link.employee.id }, data: { status: "ACTIVE" } });
      }
    }
    return { policy: p, memberLinks };
  });

  for (const link of updated.memberLinks) {
    if (link.employee.status === "SUBMITTED") {
      await sendMail({
        to: link.employee.email,
        subject: "Your policy is now active",
        html: templates.policyIssued(link.employee.name, updated.policy.policyNumber),
        employeeId: link.employee.id,
      });
    }
  }

  await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "policy.issue", entity: "Policy", entityId: policy.id, after: updated.policy });
  res.json(updated.policy);
});

module.exports = router;
