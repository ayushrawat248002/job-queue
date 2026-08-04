import { redis } from "./redis.js";
import jobModel from "../models/jobModel.js";
import "dotenv/config";
import connectDB from "./mongodb.js";
import IORedis from "ioredis"
import { group } from "console";
import http from "http";

console.log("REDIS_URL:", process.env.REDIS_URL);

const PORT = process.env.PORT || 5001;
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("Outbox worker is running");
  }

  res.writeHead(404);
  res.end();
});




// ----------------------
// Connect Mongo Properly
// ----------------------




// ----------------------
// Redis Logging
// ----------------------
redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("❌ Redis error:", err));
redis.on("close", () => console.warn("⚠️ Redis connection closed"));

// ----------------------
// Lua Time Bucket Script
// ----------------------
const luaScript = `
local prefix = ARGV[1]
local time = redis.call("TIME")
local now = tonumber(time[1])

local hourBucket = math.floor(now / 3600) * 3600
local twoMinBucket = math.floor(now / 120) * 120

local hourKey = prefix .. ":hour:" .. hourBucket
local twoMinKey = prefix .. ":2min:" .. twoMinBucket

local hourCount = redis.call("INCR", hourKey)
if hourCount == 1 then
    redis.call("EXPIRE", hourKey, 7200)
end

local twoMinCount = redis.call("INCR", twoMinKey)
if twoMinCount == 1 then
    redis.call("EXPIRE", twoMinKey, 7200)
end

return {hourKey, twoMinKey}
`;

const luascript2 = `
local key = KEYS[1]

local pending = redis.call("HINCRBY", key, "pending", ARGV[1])
local active = redis.call("HINCRBY", key, "active", ARGV[2])
local completed = redis.call("HINCRBY", key, "completed", ARGV[3])
local failed = redis.call("HINCRBY", key, "failed", ARGV[4])

local payload =
'{"groupname":"user123","payload":{' ..
'"type":"stats",' ..
'"pending":'..pending..',' ..
'"active":'..active..',' ..
'"completed":'..completed..',' ..
'"failed":'..failed..
'}}'

redis.call("PUBLISH", "job_event", payload)

`

// ----------------------
// Job Processor
// ----------------------
const publishClient = new IORedis(process.env.REDIS_URL, {
  tls: {},
});

const processJob = async (job) => {
  console.log("====================================");
  console.log(`🚀 Starting processing for Job ${job.jobId}`);
  console.log(`👷 Worker PID: ${process.pid}`);

  console.log("🔒 Attempting to claim job...");

  const valid = await jobModel.findOneAndUpdate(
    {
      _id: job.jobId,
      status: "pending",
    },
    {
      $set: {
        status: "processing",
        startedAt: Date.now(),
        workerId: process.pid,
      },
    },
    {
      returnDocument: "after",
    }
  );

  if (!valid) {
    console.log(`⚠️ Job ${job.jobId} already claimed by another worker`);
    throw new Error("Another worker already took this job");
  }

  console.log("✅ Job successfully claimed");
  console.log(valid);

  console.log("📢 Publishing ACTIVE event...");

  await publishClient.publish(
    "job_event",
    JSON.stringify({
      groupname: "user123",
      payload: {
        type: "active",
        jobId: job.jobId,
      },
    })
  );

  console.log("✅ Active event published");

  console.log("📊 Updating Redis job stats...");

  await redis.eval(
    luascript2,
    1,
    "job_stats",
    -1,
    1,
    0,
    0
  );

  console.log("✅ Redis stats updated");

  console.log("⏳ Simulating job execution (5 seconds)...");

  await new Promise((res) => setTimeout(res, 5000));

  console.log("💾 Updating Mongo status to COMPLETE...");

  const updateResult = await jobModel.updateOne(
    {
      _id: job.jobId,
      status: "processing",
    },
    {
      $set: {
        status: "complete",
      },
    }
  );

  console.log("Mongo Update Result:", updateResult);

  console.log("📈 Updating completion bucket...");

  await redis.eval(
    luaScript,
    0,
    "jobs:completed"
  );

  console.log("✅ Completion bucket updated");

  console.log("📢 Publishing COMPLETED event...");

  await publishClient.publish(
    "job_event",
    JSON.stringify({
      groupname: "user123",
      payload: {
        type: "completed",
        jobId: job.jobId,
      },
    })
  );

  console.log("✅ Completed event published");

  console.log("📊 Updating final Redis stats...");

  await redis.eval(
    luascript2,
    1,
    "job_stats",
    0,
    -1,
    1,
    0
  );

  console.log("✅ Final stats updated");

  console.log(`🎉 Job ${job.jobId} COMPLETED successfully`);
  console.log("====================================");
};

// ----------------------
// Worker Loop
// ----------------------
const workerLoop = async () => {
  console.log(`🚀 Worker PID ${process.pid} started`);

  while (true) {
    try {
      console.log("⏳ Waiting for job...");

      const rawJob = await redis.brpoplpush(
        "job_queue",
        "processing_queue",
        0
      );

      console.log("📥 Job popped from job_queue");

      const job = JSON.parse(rawJob);

      console.log(`🆔 Job ID: ${job.jobId}`);
      console.log(`🔁 Retry Count: ${job.retry ?? 0}`);

      await publishClient.publish(
        "job_event",
        JSON.stringify({
          groupname: "user123",
          payload: {
            jobId: job.jobId,
            type: "pending",
          },
        })
      );

      console.log("📢 Published pending event");

      await redis.eval(luascript2, 1, "job_stats", 1, 0, 0, 0);

      console.log("📊 Pending stats updated");

      try {
        console.log(`⚙️ Processing job ${job.jobId}`);

        await processJob(job);

        console.log(`✅ Job ${job.jobId} processed successfully`);

        await redis.lrem(
          "processing_queue",
          1,
          rawJob
        );

        console.log(`🗑 Removed ${job.jobId} from processing queue`);

      } catch (err) {

        console.error(`❌ processJob failed for ${job.jobId}`);
        console.error(err);

        if (err.message === "Another worker already took this job") {

          console.log(`⚡ Duplicate claim detected for ${job.jobId}`);

          await redis.eval(
            luascript2,
            1,
            "job_stats",
            -1,
            0,
            0,
            0
          );

          await redis.lrem(
            "processing_queue",
            1,
            rawJob
          );

          console.log(`🗑 Duplicate removed from processing queue`);

          continue;
        }

        await redis.eval(
          luascript2,
          1,
          "job_stats",
          0,
          -1,
          0,
          1
        );

        console.log("📊 Active -> Failed stats updated");

        await redis.eval(
          luaScript,
          0,
          "jobs:failed"
        );

        console.log("📈 Failure bucket updated");

        job.retry = (job.retry || 0) + 1;

        console.log(`🔁 Retry count now ${job.retry}`);

        await redis.lrem(
          "processing_queue",
          1,
          rawJob
        );

        console.log("🗑 Removed failed job from processing queue");

        if (job.retry <= 3) {

          console.log(`♻️ Resetting Mongo status for ${job.jobId}`);

          await jobModel.updateOne(
            { _id: job.jobId },
            {
              $set: {
                status: "pending",
                startedAt: null,
                workerId: null,
              },
            }
          );

          console.log("✅ Mongo reset complete");

          await publishClient.publish(
            "job_event",
            JSON.stringify({
              groupname: "user123",
              payload: {
                jobId: job.jobId,
                type: "pending",
              },
            })
          );

          console.log(`📢 Published retry event for ${job.jobId}`);

          console.log(`⏱ Waiting ${job.retry} second(s) before retry`);

          await new Promise((res) =>
            setTimeout(res, job.retry * 1000)
          );

          await redis.rpush(
            "job_queue",
            JSON.stringify(job)
          );

          console.log(
            `🔁 Job ${job.jobId} pushed back to queue (Attempt ${job.retry})`
          );

        } else {

          console.log(`💀 Retry limit exceeded for ${job.jobId}`);

          await publishClient.publish(
            "job_event",
            JSON.stringify({
              groupname: "user123",
              payload: {
                type: "failed",
                jobId: job.jobId,
              },
            })
          );

          console.log("📢 Published failed event");

          await redis.rpush(
            "dead_job_queue",
            JSON.stringify(job)
          );

          console.log(
            `☠️ Job ${job.jobId} moved to dead queue`
          );
        }
      }

      console.log("--------------------------------------------");

    } catch (err) {

      console.error("💥 Worker loop crashed");
      console.error(err);

      console.log("😴 Sleeping for 1 second...");

      await new Promise((res) =>
        setTimeout(res, 1000)
      );
    }
  }
};

// ----------------------
// Recover Stuck Jobs

const recoverStuckJobs = async () => {
  const lock = await redis.set("recover_lock", "1", "EX", 10, "NX");
  if (!lock) return;

  console.log("♻️ RECOVERY STARTED");

  const Timeout = 1000 * 60 * 2;

  // 1️⃣ Find expired jobs in Mongo
  const expiredJobs = await jobModel.find({
    status: "processing",
    startedAt: { $lt: Date.now() - Timeout }
  }).lean();

  if (!expiredJobs.length) {
    console.log("No expired jobs");
    return;
  }

  // Normalize IDs as strings
  const expiredIdSet = new Set(
    expiredJobs.map(j => j._id.toString())
  );

  // 2️⃣ Reset Mongo state first
  await jobModel.updateMany(
    {
      _id: { $in: expiredJobs.map(j => j._id) },
      status: "processing",
      startedAt: { $lt: Date.now() - Timeout }
    },
    { $set: { status: "pending", 
      startedAt : null
    } }
  );

  // 3️⃣ Check Redis processing queue
const stuckJobs = await redis.lrange("processing_queue", 0, -1);
const stuckIds = stuckJobs.map(j => JSON.parse(j).jobId.toString());

const mongoJobs = await jobModel.find({
  _id: { $in: stuckIds }
}).lean();

const mongoMap = new Map(
  mongoJobs.map(j => [j._id.toString(), j])
);

  let recovered = 0;
for (const rawJob of stuckJobs) {
  const job = JSON.parse(rawJob);
  const id = job.jobId.toString();
  const mongoJob = mongoMap.get(id);

  if (!mongoJob || mongoJob.status !== "processing") {
    await redis.lrem("processing_queue", 1, rawJob);
    continue;
  }
  

  if (expiredIdSet.has(id)) {
     await redis.eval(luascript2, 1, 'job_stats', 1, -1, 0, 0)
    await redis.lrem("processing_queue", 1, rawJob);
    await redis.rpush("job_queue", rawJob);
    recovered++;
  }
}

  console.log(`♻️ Recovered ${recovered} stuck jobs`);
};

const dead_queue = async () => {
  await redis.del("dead_job_queue");
};

  const start = async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB connected");

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Health server listening on port ${PORT}`);
    });

    await workerLoop();

    setInterval(() => {
      await recoverStuckJobs()
    }, 30 * 60 * 1000);

    setInterval(dead_queue, 30 * 60 * 1000);

  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();




