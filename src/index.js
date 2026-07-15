const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const env = require("./config/env");

const authRoutes = require("./routes/auth.routes");
const clientsRoutes = require("./routes/clients.routes");
const hierarchyRoutes = require("./routes/hierarchy.routes");
const employeesRoutes = require("./routes/employees.routes");
const enrollmentRoutes = require("./routes/enrollment.routes");
const policiesRoutes = require("./routes/policies.routes");
const payrollRoutes = require("./routes/payroll.routes");

const app = express();

const allowedOrigins = [
  env.APP_BASE_URL, // Production frontend (Vercel)
];

app.use(
  cors({
    origin(origin, callback) {
      // Allow tools like Postman or server-to-server requests
      if (!origin) {
        return callback(null, true);
      }

      // Allow any localhost port during development
      if (/^http:\/\/localhost:\d+$/.test(origin)) {
        return callback(null, true);
      }

      // Allow your production frontend
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

// Magic-link requests are the most abuse-prone endpoint — rate-limit hard.
const linkLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: "Too many attempts. Try again later." } });
app.use("/auth/request-link", linkLimiter);

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/clients", clientsRoutes);
// nested, client-scoped resources
app.use("/clients/:clientId/hierarchy", hierarchyRoutes);
app.use("/clients/:clientId/employees", employeesRoutes);
app.use("/clients/:clientId/policies", policiesRoutes);
app.use("/clients/:clientId/payroll", payrollRoutes);
// public, token-based (the emailed link hits this directly, no session needed)
app.use("/enrollment", enrollmentRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found." }));

// centralized error handler — keeps stack traces out of API responses
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(env.PORT, () => console.log(`Spearhead EB API listening on :${env.PORT}`));
