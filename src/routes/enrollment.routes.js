const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const { consumeEnrollmentLink, markEnrollmentLinkUsed } = require("../lib/tokens");
const { sendMail, templates } = require("../lib/mailer");
const env = require("../config/env");

const router = express.Router();

const RELATIONS = ["Spouse", "Son", "Daughter", "Parent", "Parent-in-law"];

const dependentSchema = z.object({
  relation: z.enum(RELATIONS),
  name: z.string().min(1),
  dob: z.string().optional(),
  gender: z.string().optional(),
});

const submitSchema = z.object({
  name: z.string().min(2),
  dob: z.string(),
  gender: z.string(),
  maritalStatus: z.string(),
  dependents: z.array(dependentSchema).default([]),
});

// GET /enrollment/:token — fetch the employee + which policies they're opted into,
// so the frontend knows whether to render the dependents section (Health only).
router.get("/:token", async (req, res) => {
  try {
    const link = await consumeEnrollmentLink(req.params.token); // does not mark used — read-only fetch
    const employee = await prisma.employee.findUnique({
      where: { id: link.employeeId },
      include: { employeePolicies: { include: { policy: true } }, dependents: true },
    });
    if (!employee) return res.status(404).json({ error: "Enrollment record not found." });

    res.json({
      employee: {
        id: employee.id,
        empCode: employee.empCode,
        name: employee.name,
        email: employee.email,
        status: employee.status,
        policyTypes: employee.employeePolicies.map((ep) => ep.policy.type),
      },
    });
  } catch (e) {
    res.status(410).json({ error: e.message });
  }
});

// POST /enrollment/:token — submit the form. Single-use: the link is marked used on success.
router.post("/:token", async (req, res) => {
  const parse = submitSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.issues[0].message });

  let link;
  try {
    link = await consumeEnrollmentLink(req.params.token);
  } catch (e) {
    return res.status(410).json({ error: e.message });
  }

  const employee = await prisma.employee.findUnique({
    where: { id: link.employeeId },
    include: { employeePolicies: { include: { policy: true } } },
  });
  if (!employee) return res.status(404).json({ error: "Enrollment record not found." });
  if (employee.status !== "INVITED") {
    return res.status(409).json({ error: "This enrollment has already been submitted." });
  }

  const hasHealth = employee.employeePolicies.some((ep) => ep.policy.type === "HEALTH");
  const { name, dob, gender, maritalStatus, dependents } = parse.data;

  if (!hasHealth && dependents.length > 0) {
    return res.status(400).json({ error: "Dependents can only be added under a Group Health policy." });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.update({
      where: { id: employee.id },
      data: { name, dob: new Date(dob), gender, maritalStatus, status: "SUBMITTED" },
    });
    if (hasHealth && dependents.length) {
      await tx.dependent.createMany({
        data: dependents.map((d) => ({
          employeeId: employee.id,
          relation: d.relation,
          name: d.name,
          dob: d.dob ? new Date(d.dob) : null,
          gender: d.gender || null,
        })),
      });
    }
    return emp;
  });

  await markEnrollmentLinkUsed(link.id);

  // notify employee + Spearhead servicing team + the client's top HR contact
  const topHr = await prisma.hrNode.findFirst({ where: { clientId: employee.clientId, parentId: null } });
  const cc = [env.SPEARHEAD_TEAM_EMAIL, topHr?.email].filter(Boolean);
  await sendMail({
    to: employee.email,
    cc,
    subject: "Enrollment submitted — confirmation",
    html: templates.enrollmentSubmitted(name),
    employeeId: employee.id,
  });

  res.json(updated);
});

module.exports = router;
