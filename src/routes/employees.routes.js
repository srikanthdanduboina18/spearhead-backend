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

// GET /clients/:clientId/employees
router.get("/", requireAuth, requireClientScope, async (req, res) => {
  const employees = await prisma.employee.findMany({
    where: { clientId: req.params.clientId },
    include: { dependents: true, employeePolicies: { include: { policy: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(employees);
});

// POST /clients/:clientId/employees — add to census + auto-send pre-enrollment link.
router.post("/", requireAuth, requireClientScope, requireRole("SUPER_ADMIN", "SERVICING_TEAM", "CLIENT_HR"), async (req, res) => {
  const parse = addEmployeeSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });
  const { policyTypes, ...data } = parse.data;

  const clientId = req.params.clientId;
  const policies = await prisma.policy.findMany({ where: { clientId, type: { in: policyTypes } } });
  if (policies.length !== policyTypes.length) {
    return res.status(400).json({ error: "One or more selected policy types don't exist yet for this client — create the policy first." });
  }

  const employee = await prisma.employee.create({
    data: {
      clientId,
      empCode: data.empCode,
      name: data.name,
      email: data.email,
      mobile: data.mobile,
      dob: data.dob ? new Date(data.dob) : null,
      doj: data.doj ? new Date(data.doj) : null,
      designation: data.designation,
      gender: data.gender,
      status: "INVITED",
      employeePolicies: { create: policies.map((p) => ({ policyId: p.id })) },
    },
  });

  const link = await createEnrollmentLink(employee.id);
  await sendMail({
    to: employee.email,
    subject: "Complete your group benefits enrollment",
    html: templates.enrollmentLink(employee.name, link),
    employeeId: employee.id,
  });

  await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "employee.create", entity: "Employee", entityId: employee.id, after: employee });
  res.status(201).json(employee);
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

  await logAudit({ actorType: req.user.role.toLowerCase(), actorId: req.user.subjectId, action: "employee.status.update", entity: "Employee", entityId: after.id, before, after });
  res.json(after);
});

module.exports = router;
