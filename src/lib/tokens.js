const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const prisma = require("./prisma");

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Creates a single-use magic-link token for an HR node, employee, or admin.
 * The raw token is only ever returned here (to embed in the email link) —
 * only its hash is persisted, so a DB leak doesn't leak usable tokens.
 */
async function createLoginToken(subjectType, subjectId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.MAGIC_LINK_TTL_MIN * 60 * 1000);
  await prisma.loginToken.create({
    data: { subjectType, subjectId, tokenHash: hashToken(raw), expiresAt },
  });
  return `${env.APP_BASE_URL}/verify?token=${raw}&type=${subjectType}`;
}

async function consumeLoginToken(raw) {
  const tokenHash = hashToken(raw);
  const record = await prisma.loginToken.findUnique({ where: { tokenHash } });
  if (!record) throw new Error("Invalid or unknown link.");
  if (record.usedAt) throw new Error("This link has already been used.");
  if (record.expiresAt < new Date()) throw new Error("This link has expired — request a new one.");

  await prisma.loginToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return record; // { subjectType, subjectId }
}

/** Same pattern, dedicated table for the enrollment flow specifically. */
async function createEnrollmentLink(employeeId) {
  const raw = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days for first-enrollment links
  await prisma.enrollmentLink.create({
    data: { employeeId, tokenHash: hashToken(raw), expiresAt },
  });
  return `${env.APP_BASE_URL}/enroll?token=${raw}`;
}

async function consumeEnrollmentLink(raw) {
  const tokenHash = hashToken(raw);
  const record = await prisma.enrollmentLink.findUnique({ where: { tokenHash } });
  if (!record) throw new Error("Invalid or unknown link.");
  if (record.expiresAt < new Date()) throw new Error("This link has expired — ask HR to resend it.");
  return record; // usedAt intentionally NOT set here — set it on successful form submission
}

async function markEnrollmentLinkUsed(id) {
  await prisma.enrollmentLink.update({ where: { id }, data: { usedAt: new Date() } });
}

/** Session JWT issued after a magic link is successfully verified. */
function issueSessionJwt(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.SESSION_TTL_HOURS}h` });
}

function verifySessionJwt(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = {
  createLoginToken,
  consumeLoginToken,
  createEnrollmentLink,
  consumeEnrollmentLink,
  markEnrollmentLinkUsed,
  issueSessionJwt,
  verifySessionJwt,
};
