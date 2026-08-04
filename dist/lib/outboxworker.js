import http from "http";
import "dotenv/config";

import Outbox from "../models/outbox.js";
import { redis } from "./redis.js";
import connectDB from "./mongodb.js";

const PORT = process.env.PORT || 5000;

console.log("REDIS_URL:", process.env.REDIS_URL);

/* -------------------- Health Server -------------------- */

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain",
    });
    return res.end("Outbox worker is running");
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Health server listening on port ${PORT}`);
});

/* -------------------- Outbox Worker -------------------- */

async function Outbox_worker() {
  const jobs = await Outbox.find({
    processed: false,
    processing: false,
  })
    .sort({ createdAt: 1 })
    .limit(100)
    .lean();

  if (!jobs.length) return;

  console.log(`Found ${jobs.length} jobs`);

  const ids = jobs.map((j) => j._id);

  // Claim jobs
  await Outbox.updateMany(
    {
      _id: { $in: ids },
      processing: false,
      processed: false,
    },
    {
      $set: {
        processid: process.pid,
        processing: true,
        processingAt: new Date(),
      },
    }
  );

  const claimed = await Outbox.find({
    processid: process.pid,
    processing: true,
    processed: false,
  }).lean();

  if (!claimed.length) {
    console.log("Another worker already claimed these jobs.");
    return;
  }

  const pipeline = redis.pipeline();

  for (const job of claimed) {
    pipeline.rpush("job_queue", JSON.stringify(job.payload));
  }

  await pipeline.exec();

  await Outbox.updateMany(
    {
      _id: {
        $in: claimed.map((j) => j._id),
      },
    },
    {
      $set: {
        processed: true,
        processedAt: new Date(),
      },
    }
  );

  console.log(`Queued ${claimed.length} jobs`);
}

/* -------------------- Recover Worker -------------------- */

async function recoverStuckJobs() {
  const lock = await redis.set(
    "recover_lock",
    "1",
    "EX",
    240,
    "NX"
  );

  if (!lock) return;

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const result = await Outbox.updateMany(
    {
      processing: true,
      processed: false,
      processingAt: { $lt: fiveMinutesAgo },
    },
    {
      $set: {
        processing: false,
        processid: null,
      },
    }
  );

  console.log(`[Recover] Released ${result.modifiedCount} stuck jobs`);
}

/* -------------------- Startup -------------------- */

async function start() {
  try {
    await connectDB();
    console.log("✅ MongoDB connected");

    console.log("Outbox worker started...");

    setInterval(async () => {
      try {
        await Outbox_worker();
      } catch (err) {
        console.error("Outbox worker error:", err);
      }
    }, 1000);

    setInterval(async () => {
      try {
        await recoverStuckJobs();
      } catch (err) {
        console.error("Recover worker error:", err);
      }
    }, 6000);
  } catch (err) {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  }
}

start();

/* -------------------- Process Events -------------------- */

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
  process.exit(1);
});