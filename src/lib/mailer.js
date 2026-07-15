const nodemailer = require("nodemailer");
const env = require("../config/env");
const prisma = require("./prisma");

// If SMTP creds are present, mail actually sends (works with AWS SES SMTP interface,
// SendGrid SMTP relay, or any standard SMTP provider). Otherwise it logs to the console
// so you can develop without a real mail account.
let transporter = null;
if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 587),
    secure: Number(env.SMTP_PORT) === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
}

/**
 * sendMail — sends (or logs) an email and always records it in EmailLog for the audit trail.
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string[]} [opts.cc]
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.template]
 * @param {string} [opts.employeeId]
 */
async function sendMail({ to, cc = [], subject, html, template, employeeId }) {
  const ccStr = cc.join(", ");

  if (transporter) {
    await transporter.sendMail({
      from: env.MAIL_FROM,
      to,
      cc: ccStr || undefined,
      subject,
      html,
    });
  } else {
    console.log(`\n[mailer:dev] To: ${to}${ccStr ? ` | CC: ${ccStr}` : ""}\nSubject: ${subject}\n${html}\n`);
  }

  await prisma.emailLog.create({
    data: {
      employeeId: employeeId || null,
      toEmail: to,
      ccEmails: ccStr || null,
      subject,
      template: template || null,
      status: transporter ? "sent" : "logged-dev-mode",
    },
  });
}

// ---- templates matching the notifications matrix in the design doc ----

const templates = {
  enrollmentLink: (name, link) => `
    <p>Hi ${name},</p>
    <p>You've been added to your company's group benefit scheme. Please complete your enrollment using the secure link below (valid for 15 minutes):</p>
    <p><a href="${link}">${link}</a></p>
    <p>— Spearhead Insurance Broking</p>`,

  enrollmentSubmitted: (name) => `
    <p>Hi ${name},</p>
    <p>Your enrollment details have been received and recorded. You'll be notified once your policy is issued.</p>
    <p>— Spearhead Insurance Broking</p>`,

  loginLink: (name, link) => `
    <p>Hi ${name},</p>
    <p>Here is your secure login link (valid for 15 minutes):</p>
    <p><a href="${link}">${link}</a></p>`,

  policyIssued: (name, policyNumber) => `
    <p>Hi ${name},</p>
    <p>Your Group Health policy (Policy #${policyNumber}) is now active. Your e-card will be available shortly.</p>`,

  payrollSyncResult: (month, added, removed) => `
    <p>Payroll sync for ${month} processed.</p>
    <p>Added: ${added.length} · Removed: ${removed.length}</p>`,
};

module.exports = { sendMail, templates };
