const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole } = require("../middleware/auth");
const { logAudit } = require("../lib/audit");

const router = express.Router();

const createClientSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).max(12),
  gstin: z.string().optional(),
  address: z.string().optional(),
});

// GET /clients — Super Admin/Servicing Team see all; HR/Employee never hit this route.
router.get("/", requireAuth, requireRole("SUPER_ADMIN", "SERVICING_TEAM"), async (req, res) => {
  const clients = await prisma.client.findMany({
  orderBy: { createdAt: "desc" },
  include: {
    employees: true,
    hrNodes: true,
    policies: true,
  },
});
  res.json(clients);
});

router.get("/", async (req, res) => {
  if (!["SUPER_ADMIN", "SERVICING_TEAM"].includes(req.user.role) && req.user.clientId !== req.params.clientId) {
    return res.status(403).json({ error: "You don't have access to this client." });
  }
  const client = await prisma.client.findUnique({
    where: { id: req.params.clientId },
    include: { hrNodes: true, policies: true },
  });
  if (!client) return res.status(404).json({ error: "Client not found." });
  res.json(client);
});

router.post("/", async (req, res) => {
  const parse = createClientSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });

  //const client = await prisma.client.create({ data: parse.data });
  //await logAudit({ actorType: "admin", actorId: req.user.subjectId, action: "client.create", entity: "Client", entityId: client.id, after: client });
  //res.status(201).json(client);
});

module.exports = router;
