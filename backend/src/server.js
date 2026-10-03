import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import express from "express";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import { config } from "./config/env.js";
import { db } from "./db.js";

import studentRoutes from "./routes/studentRoutes.js";
import candidateRoutes from "./routes/candidateRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";
import voterRoutes from "./routes/voterRoutes.js";
import resultsRoutes from "./routes/resultsRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import registrationCodeRoutes from "./routes/registrationCodeRoutes.js";
import distributionRoutes from "./routes/distributionRoutes.js";
import eventRoutes from "./routes/eventRoutes.js";
import contractRoutes from "./routes/contractRoutes.js";
import codeRoutes from "./routes/codeRoutes.js";
import reminderRoutes from "./routes/reminderRoutes.js";

import { startBlockchainSync } from "./blockchain/sync.js";
import { startReminderJob } from "./services/reminderService.js";
import { setIO } from "./socket.js";

// Startup self-checks (non-fatal warnings)
async function startupChecks() {
  const required = [
    ["DATABASE_URL", config.db],
    ["RPC_URL", config.rpc],
    ["CONTRACT_ADDRESS_V3", config.contractV3],
    ["PRIVATE_KEY", config.privateKey],
  ];
  for (const [name, value] of required) {
    if (!value) console.warn(`[startup] Missing env var: ${name}`);
  }

  if (!config.db) {
    console.error("[startup] DATABASE_URL is not set — DB-backed routes will fail.");
    return;
  }

  try {
    const res = await db.query("SELECT current_database() AS db, version() AS version");
    console.log(`[startup] DB OK → ${res.rows[0].db} (${res.rows[0].version.split(",")[0]})`);

    const tableCheck = await db.query(
      "SELECT to_regclass('public.students') AS students, " +
        "EXISTS (SELECT 1 FROM information_schema.columns " +
        "WHERE table_name='students' AND column_name='password_hash') AS has_pwd_col"
    );
    const row = tableCheck.rows[0];
    if (!row.students) {
      console.warn("[startup] 'students' table missing. Run schema/students.sql");
    } else if (!row.has_pwd_col) {
      console.warn("[startup] 'students.password_hash' missing. Run schema/student_portal_auth.sql");
    }
  } catch (err) {
    console.error("[startup] DB connection failed:", err.message);
  }
}

// Parse comma-separated origins, falling back to the single origin.
const origins = config.corsOrigin === "*"
  ? "*"
  : config.corsOrigin.split(",").map(s => s.trim());

const app = express();
const httpServer = createServer(app);

// --- Security middleware ---
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(morgan("short"));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — try again later." },
  // The browser sends a CORS preflight before a cross-origin POST. Counting
  // it meant each login attempt cost two requests against the budget, and the
  // preflight itself could be answered with a 429 -- which the browser then
  // reports as "Failed to fetch" because it never sends the real POST.
  skip: (req) => req.method === "OPTIONS",
});

// CORS must run before the limiters. Mounted after them, a 429 was built
// without Access-Control-Allow-Origin, so a browser could not read the
// message and surfaced it as an opaque TypeError instead.
app.use(cors({ origin: origins, credentials: true }));

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

const io = new Server(httpServer, {
  path: "/socket.io/",
  cors: {
    origin: origins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
  allowEIO3: true,
  pingInterval: 25000,
  pingTimeout: 20000,
});

// Serve locally-stored profile photos (fallback when Pinata isn't configured).
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.use("/api/students", studentRoutes);
app.use("/api/candidates", candidateRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/voters", voterRoutes);
app.use("/api/results", resultsRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", registrationCodeRoutes);
app.use("/api/distribution", distributionRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/contract", contractRoutes);
app.use("/api/codes", codeRoutes);
app.use("/api/admin", reminderRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// Make io accessible to controllers
setIO(io);

// 🔥 START SYNC ENGINE with Socket.io
startBlockchainSync(io);

io.on("connection", (socket) => {
  console.log("Real-time dashboard client connected:", socket.id);
});

httpServer.listen(config.port, () => {
  console.log(`Server running on port ${config.port} (Real-time enabled)`);
  startupChecks();
  startReminderJob();
});
