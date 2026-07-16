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

// GET /clients - Return all clients
router.get("/", async (req, res) => {
  try {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        employees: true,
        hrNodes: true,
        policies: true,
      },
    });

    res.json(clients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch clients." });
  }
});

// GET /clients/:clientId - Return a single client
router.get("/:clientId", async (req, res) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: req.params.clientId },
      include: {
        hrNodes: true,
        policies: true,
        employees: true,
      },
    });

    if (!client) {
      return res.status(404).json({ error: "Client not found." });
    }

    res.json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch client." });
  }
});

router.post("/", async (req, res) => {
  const parse = createClientSchema.safeParse(req.body);

  if (!parse.success) {
    return res.status(400).json({
      error: parse.error.issues[0].message,
    });
  }

  try {
    const client = await prisma.client.create({
      data: parse.data,
    });

    res.status(201).json(client);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Failed to create client.",
    });
  }
});
module.exports = router;
