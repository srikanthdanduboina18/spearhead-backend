const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole, requireClientScope } = require("../middleware/auth");
const { logAudit } = require("../lib/audit");
const { createLoginToken } = require("../lib/tokens");
const { sendMail, templates } = require("../lib/mailer");

const router = express.Router({ mergeParams: true });

const hrNodeSchema = z.object({
  name: z.string().min(2),
  designation: z.string().optional(),
  email: z.string().email(),
  mobile: z.string().optional(),
  scope: z.string().optional(),
  parentId: z.string().nullable().optional(),
});

// GET /clients/:clientId/hierarchy
router.get("/", requireAuth, requireClientScope, async (req, res) => {
  const nodes = await prisma.hrNode.findMany({ where: { clientId: req.params.clientId } });
  res.json(nodes);
});

// POST /clients/:clientId/hierarchy — Super Admin, Servicing Team, or the top HR node of that client.
router.post("/", requireAuth, requireClientScope, requireRole("SUPER_ADMIN", "SERVICING_TEAM", "CLIENT_HR"), async (req, res) => {
  const parse = hrNodeSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });

  const node = await prisma.hrNode.create({
    data: { ...parse.data, clientId: req.params.clientId },
  });

  const link = await createLoginToken("hr", node.id);
  await sendMail({ to: node.email, subject: "Your Spearhead HR portal access", html: templates.loginLink(node.name, link) });

  await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "hrNode.create", entity: "HrNode", entityId: node.id, after: node });
  res.status(201).json(node);
});

module.exports = router;
