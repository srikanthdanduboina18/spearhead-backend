const express = require("express");
const { z } = require("zod");
const prisma = require("../lib/prisma");
const env = require("../config/env");
const { sendMail, templates } = require("../lib/mailer");
const { createLoginToken, consumeLoginToken, issueSessionJwt } = require("../lib/tokens");

const router = express.Router();

const requestLinkSchema = z.object({ email: z.string().email() });

// POST /auth/request-link — looks up the email across admins/HR/employees and mails a magic link.
// Always returns 200 with a generic message, whether or not the email exists,
// so the endpoint can't be used to enumerate registered users.
router.post("/request-link", async (req, res) => {
  const parse = requestLinkSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "A valid email is required." });
  const { email } = parse.data;

  const hr = await prisma.hrNode.findUnique({ where: { email } });
  const employee = !hr ? await prisma.employee.findFirst({ where: { email } }) : null;
  // Super Admins/Servicing Team would typically be a separate small internal table
  // or an allow-list of emails — omitted here for brevity, same pattern applies.

  if (hr) {
    const link = await createLoginToken("hr", hr.id);
    await sendMail({ to: hr.email, subject: "Your Spearhead login link", html: templates.loginLink(hr.name, link) });
  } else if (employee) {
    const link = await createLoginToken("employee", employee.id);
    await sendMail({ to: employee.email, subject: "Your Spearhead login link", html: templates.loginLink(employee.name, link), employeeId: employee.id });
  }

  return res.json({ message: "If that email is registered, a login link has been sent." });
});

// GET /auth/verify?token=...&type=hr|employee — consumes the token, sets session cookie.
router.get("/verify", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token." });

  try {
    const record = await consumeLoginToken(String(token));
    let role, clientId, subjectId = record.subjectId;

    if (record.subjectType === "hr") {
      const hr = await prisma.hrNode.findUnique({ where: { id: record.subjectId } });
      if (!hr) throw new Error("Account not found.");
      role = "CLIENT_HR";
      clientId = hr.clientId;
    } else if (record.subjectType === "employee") {
      const emp = await prisma.employee.findUnique({ where: { id: record.subjectId } });
      if (!emp) throw new Error("Account not found.");
      role = "EMPLOYEE";
      clientId = emp.clientId;
    } else {
      role = "SUPER_ADMIN";
    }

    const session = issueSessionJwt({ role, subjectId, clientId });
    res.cookie(env.SESSION_COOKIE_NAME, session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
    });
    return res.json({ role, clientId });
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie(env.SESSION_COOKIE_NAME);
  res.json({ message: "Logged out." });
});

module.exports = router;
