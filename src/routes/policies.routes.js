const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const {
  requireAuth,
  requireRole,
  requireClientScope,
} = require("../middleware/auth");
const { logAudit } = require("../lib/audit");
const { sendMail, templates } = require("../lib/mailer");

const router = express.Router({ mergeParams: true });

// -------------------- Schemas --------------------

const createPolicySchema = z.object({
  type: z.enum(["HEALTH", "ACCIDENT", "LIFE", "GRATUITY"]),
  insurer: z.string().min(2),
  tpa: z.string().optional(),
});

const updatePolicySchema = z.object({
  type: z.enum(["HEALTH", "ACCIDENT", "LIFE", "GRATUITY"]),
  insurer: z.string().min(2),
  tpa: z.string().optional(),
});

const issueSchema = z.object({
  policyNumber: z.string().min(3),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// -------------------- GET Policies --------------------

router.get("/", async (req, res) => {
  try {
    const policies = await prisma.policy.findMany({
      where: {
        clientId: req.params.clientId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(policies);
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

// -------------------- CREATE Policy --------------------

router.post("/", async (req, res) => {
  try {
    const parse = createPolicySchema.safeParse(req.body);

    if (!parse.success) {
      return res.status(400).json({
        error: parse.error.issues[0].message,
      });
    }

    const policy = await prisma.policy.create({
      data: {
        ...parse.data,
        clientId: req.params.clientId,
        status: "PENDING_ISSUANCE",
      },
    });

    res.status(201).json(policy);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

// -------------------- UPDATE Policy --------------------

router.put("/:policyId", async (req, res) => {
  try {
    const parse = updatePolicySchema.safeParse(req.body);

    if (!parse.success) {
      return res.status(400).json({
        error: parse.error.issues[0].message,
      });
    }

    const policy = await prisma.policy.update({
      where: {
        id: req.params.policyId,
      },
      data: {
        type: parse.data.type,
        insurer: parse.data.insurer,
        tpa: parse.data.tpa || null,
      },
    });

    res.json(policy);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

// -------------------- DELETE Policy --------------------

router.delete("/:policyId", async (req, res) => {
  try {
    const policy = await prisma.policy.findUnique({
      where: {
        id: req.params.policyId,
      },
    });

    if (!policy) {
      return res.status(404).json({
        error: "Policy not found.",
      });
    }

    await prisma.policy.delete({
      where: {
        id: req.params.policyId,
      },
    });

    res.json({
      message: "Policy deleted successfully.",
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

// -------------------- ISSUE Policy --------------------

router.post("/:policyId/issue", async (req, res) => {
  try {
    const parse = issueSchema.safeParse(req.body);

    if (!parse.success) {
      return res.status(400).json({
        error: parse.error.issues[0].message,
      });
    }

    const policy = await prisma.policy.findUnique({
      where: {
        id: req.params.policyId,
      },
    });

    if (!policy || policy.clientId !== req.params.clientId) {
      return res.status(404).json({
        error: "Policy not found.",
      });
    }

    const updated = await prisma.$transaction(async (tx) => {

      const p = await tx.policy.update({
        where: {
          id: policy.id,
        },
        data: {
          policyNumber: parse.data.policyNumber,
          status: "ISSUED",
          startDate: parse.data.startDate
            ? new Date(parse.data.startDate)
            : undefined,
          endDate: parse.data.endDate
            ? new Date(parse.data.endDate)
            : undefined,
        },
      });

      const memberLinks = await tx.employeePolicy.findMany({
        where: {
          policyId: policy.id,
        },
        include: {
          employee: true,
        },
      });

      for (const link of memberLinks) {
        if (link.employee.status === "SUBMITTED") {
          await tx.employee.update({
            where: {
              id: link.employee.id,
            },
            data: {
              status: "ACTIVE",
            },
          });
        }
      }

      return {
        policy: p,
        memberLinks,
      };
    });

    for (const link of updated.memberLinks) {
      if (link.employee.status === "SUBMITTED") {
        await sendMail({
          to: link.employee.email,
          subject: "Your policy is now active",
          html: templates.policyIssued(
            link.employee.name,
            updated.policy.policyNumber
          ),
          employeeId: link.employee.id,
        });
      }
    }

    res.json(updated.policy);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

module.exports = router;