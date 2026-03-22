import { redis } from "./redis.js";
import jobModel from "../models/jobModel.js";
import "dotenv/config";
import connectDB from "./mongodb.js";
import IORedis from "ioredis"
import { group } from "console";
console.log("REDIS_URL:", process.env.REDIS_URL);

// ----------------------
// Connect Mongo Properly
// ----------------------
(async () => {
  try {
    await connectDB();
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
})();

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
const publishClient = new IORedis(process.env.REDIS_URL);

const processJob = async (job) => {
  console.log(`Processing job ${job.jobId}`);

 const valid = await jobModel.findOneAndUpdate(
  { _id: job.jobId, status: "pending" },
  {
    $set: {
      status: "processing",
      startedAt: Date.now(),
      workerId: process.pid
    }
  },
  {returnDocument: "after" }
);

if (!valid) {
  throw new Error("Another worker already took this job");
}
  

  await publishClient.publish('job_event', JSON.stringify({
    groupname : 'user123',
    payload : {type : 'active', jobId : job.jobId}
  }))

  await redis.eval(luascript2, 1, 'job_stats', -1, 1, 0, 0)


  // 🔥 Simulate real work
  await new Promise((res) => setTimeout(res, 5000));

  await jobModel.updateOne(
    { _id: job.jobId, status: "processing" },
    { $set: { status: "complete" } }
  );

  await redis.eval(luaScript, 0, "jobs:completed");

  console.log(`✅ Job ${job.jobId} completed`);
  await publishClient.publish('job_event', JSON.stringify({
    groupname : 'user123',
    payload : {type : 'completed', jobId : job.jobId}
  }))

    await redis.eval(luascript2, 1, 'job_stats', 0, -1, 1, 0)


};

// ----------------------
// Worker Loop
// ----------------------
const workerLoop = async () => {
  console.log(`🚀 Worker PID ${process.pid} started`);

  while (true) {
    try {
      const rawJob = await redis.brpoplpush(
        "job_queue",
        "processing_queue",
        0
      );
       

      const job = JSON.parse(rawJob);

      await redis.zadd('lease', Date.now(), job.jobId)
      await redis.hset('job_payload', job.jobId, rawJob)
    await publishClient.publish('job_event', JSON.stringify({
      groupname : 'user123',
      payload : {
        jobId : job.jobId,
        type : 'pending'
      }
    }))

     await redis.eval(luascript2, 1, 'job_stats', 1, 0, 0, 0)
      try {
        console.log(job)
        await processJob(job);

        // Remove after success
        await redis.lrem(
          "processing_queue",
          1,
          rawJob );

      } catch (err) {
        if (err.message === "Another worker already took this job") {
           await redis.eval(luascript2, 1, 'job_stats', -1, 0, 0, 0)
          await redis.lrem(
          "processing_queue",
          1,
          rawJob
        );
  console.log("⚡ Duplicate claim ignored");
  continue;
}
 await redis.eval(luascript2, 1, 'job_stats', 0, -1, 0, 1)
        console.error(`❌ Job failed: ${err.message}`);

        await redis.eval(luaScript, 0, "jobs:failed");

        job.retry = (job.retry || 0) + 1;

        await redis.lrem(
          "processing_queue",
          1,
        rawJob
        );

        if (job.retry <= 3) {
           await jobModel.updateOne(
    { _id: job.jobId },
    { 
      $set: { 
        status: "pending",
        startedAt : null,
        workerId: null
      } 
    }
  );
     await publishClient.publish('job_event', JSON.stringify({
      groupname : 'user123',
      payload : {
        jobId : job.jobId,
        type : 'pending'
      }
    }))
     
          await new Promise((res) =>
            setTimeout(res, job.retry * 1000)
          );

          await redis.rpush("job_queue", rawJob);

          console.log(
            `🔁 Retrying job ${job.jobId}, attempt ${job.retry}`
          );
        } else {

  await redis.publish("job_event", JSON.stringify({
    groupname : 'user123',
    payload : {type : 'failed', jobId : job.jobId }
  }))
          await redis.rpush(
            "dead_job_queue",
           rawJob
          );

          console.log(
            `💀 Job ${job.jobId} moved to dead queue`
          );
        }
      }
    } catch (err) {
      console.error("Worker loop error:", err);
      await new Promise((res) => setTimeout(res, 1000));
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
 
  


// ----------------------
// Start Everything
// ----------------------
workerLoop();

setInterval(() => {
  recoverStuckJobs().catch(console.error);
}, 30 * 60 * 1000);
 // every 30 sec

  const  dead_queue = async() => {
                 await redis.del('dead_job_queue')
            }

 setInterval(()=> {
         dead_queue()
 },30*60*1000)


