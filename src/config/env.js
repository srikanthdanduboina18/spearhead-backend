require("dotenv").config();

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.warn(`[env] Missing ${name} — set it in .env before going to production.`);
  }
  return v;
}

module.exports = {
  PORT: process.env.PORT || 4000,
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET", "dev-only-change-me"),
  SESSION_COOKIE_NAME: "spearhead_session",
  MAGIC_LINK_TTL_MIN: 15,
  SESSION_TTL_HOURS: 24,
  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:5173",
  MAIL_FROM: process.env.MAIL_FROM || "no-reply@spearhead.example",
  SPEARHEAD_TEAM_EMAIL: process.env.SPEARHEAD_TEAM_EMAIL || "servicing@spearhead.example",
  // SMTP / SES / SendGrid — fill in for real sending. Falls back to console logging if absent.
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
};
