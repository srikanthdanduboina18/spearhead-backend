const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { requireAuth, requireRole, requireClientScope } = require("../middleware/auth");
const { logAudit } = require("../lib/audit");
const { createEnrollmentLink } = require("../lib/tokens");
const { sendMail, templates } = require("../lib/mailer");

const router = express.Router({ mergeParams: true });


const POLICY_TYPES = ["HEALTH", "ACCIDENT", "LIFE", "GRATUITY"];

const addEmployeeSchema = z.object({
  empCode: z.string().min(1),
  name: z.string().min(2),
  email: z.string().email(),
  mobile: z.string().optional(),
  dob: z.string().optional(),
  doj: z.string().optional(),
  designation: z.string().optional(),
  gender: z.string().optional(),
  policyTypes: z.array(z.enum(POLICY_TYPES)).min(1),
});
const updateEmployeeSchema = z.object({
  empCode: z.string().min(1),
  name: z.string().min(2),
  email: z.string().email(),
  mobile: z.string().optional(),
  dob: z.string().optional(),
  doj: z.string().optional(),
  designation: z.string().optional(),
  gender: z.string().optional(),
});

// GET /clients/:clientId/employees
router.get("/", async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: { clientId: req.params.clientId },
    include: { dependents: true, employeePolicies: { include: { policy: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(employees);
});

// POST /clients/:clientId/employees — add to census + auto-send pre-enrollment link.
router.post("/", async (req, res) => {
  try {
  const parse = addEmployeeSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
  const { policyTypes, ...data } = parse.data;

  const clientId = req.params.clientId;
  console.log("Client ID:", clientId);
  console.log("Policy Types:", policyTypes);
  const allPolicies = await prisma.policy.findMany();
  console.log("All Policies:", allPolicies);
  const policies = await prisma.policy.findMany({ where: { clientId, type: { in: policyTypes } } });
  if (policies.length !== policyTypes.length) {
    return res.status(400).json({ error: "One or more selected policy types don't exist yet for this client — create the policy first." });
  }
let employee;

try {
  employee = await prisma.employee.create({
    data: {
      clientId,
      empCode: data.empCode,
      name: data.name,
      email: data.email,
      mobile: data.mobile || null,
      dob: data.dob ? new Date(data.dob) : null,
      doj: data.doj ? new Date(data.doj) : null,
      designation: data.designation || null,
      gender: data.gender || null,
    },
  });

  // Assign selected policies to the employee
  await prisma.employeePolicy.createMany({
    data: policies.map((policy) => ({
      employeeId: employee.id,
      policyId: policy.id,
    })),
  });

} catch (err) {
  if (err.code === "P2002") {
    return res.status(400).json({
      error: "Employee Code already exists for this client.",
    });
  }

  throw err;
}

  const link = await createEnrollmentLink(employee.id);
  await sendMail({
     to: employee.email,
  subject: "Complete your group benefits enrollment",
  html: templates.enrollmentLink(employee.name, link),
  template: "enrollment-link",
  employeeId: employee.id,
  });

  //await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "employee.create", entity: "Employee", entityId: employee.id, after: employee });
  res.status(201).json(employee);

} catch (err) {
  console.error("POST Employee Error:");
  console.error(err);

  res.status(500).json({
    error: err.message,
  });
}
});
router.put("/:employeeId", async (req, res) => {
  try {
    const parse = updateEmployeeSchema.safeParse(req.body);

    if (!parse.success) {
      return res.status(400).json({
        error: parse.error.issues[0].message,
      });
    }

    const employee = await prisma.employee.update({
      where: {
        id: req.params.employeeId,
      },
      data: {
        empCode: parse.data.empCode,
        name: parse.data.name,
        email: parse.data.email,
        mobile: parse.data.mobile || null,
        dob: parse.data.dob ? new Date(parse.data.dob) : null,
        doj: parse.data.doj ? new Date(parse.data.doj) : null,
        designation: parse.data.designation || null,
        gender: parse.data.gender || null,
      },
    });

    res.json(employee);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});
// DELETE Employee
router.delete("/:employeeId", async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: {
        id: req.params.employeeId,
      },
    });

    if (!employee) {
      return res.status(404).json({
        error: "Employee not found.",
      });
    }

    await prisma.employee.delete({
      where: {
        id: req.params.employeeId,
      },
    });

    res.json({
      message: "Employee deleted successfully.",
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

// PATCH /clients/:clientId/employees/:employeeId/status — e.g. mark Removed after payroll sync confirmation.
const statusSchema = z.object({ status: z.enum(["INVITED", "SUBMITTED", "ENROLLED", "ACTIVE", "REMOVED"]), reason: z.string().optional() });
router.patch("/:employeeId/status", requireAuth, requireClientScope, requireRole("SUPER_ADMIN", "SERVICING_TEAM", "CLIENT_HR"), async (req, res) => {
  const parse = statusSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });

  const before = await prisma.employee.findUnique({ where: { id: req.params.employeeId } });
  if (!before || before.clientId !== req.params.clientId) return res.status(404).json({ error: "Employee not found." });

  const after = await prisma.employee.update({
    where: { id: req.params.employeeId },
    data: {
      status: parse.data.status,
      removedAt: parse.data.status === "REMOVED" ? new Date() : before.removedAt,
      removedReason: parse.data.status === "REMOVED" ? parse.data.reason || "Not in current payroll" : before.removedReason,
    },
  });

  //await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "employee.status.update", entity: "Employee", entityId: after.id, before, after });
  res.json(after);
});
// GET Submitted Enrollments
router.get("/submitted", async (req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      where: {
        status: "SUBMITTED",
      },
      include: {
        dependents: true,
        employeePolicies: {
          include: {
            policy: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(employees);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err.message,
    });
  }
});

module.exports = router;
