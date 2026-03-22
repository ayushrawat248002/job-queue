import Outbox from "../models/outbox.js";
import { redis } from "./redis.js";
import "dotenv/config";
console.log("REDIS_URL:sadsadasvvcvcvcvcvcvcvc", process.env.REDIS_URL);
import connectDB from './mongodb.js'
import "dotenv/config";


  try {
     connectDB()
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }


const Outbox_worker = async () => { 

    const jobs = await Outbox.find({
        processed: false,
        processing: false
    }).sort({ createdAt: 1 }).limit(100).lean(); // include all fields

    if (!jobs.length) return;

    const ids = jobs.map(j => j._id);
  
    // Mark them as processing
    await Outbox.updateMany(
        { _id: { $in: ids }, processing: false, processed: false },
        { $set: { processid : process.pid,   processing: true, processingAt: Date.now() } }
    );

    const claimed = await Outbox.find({
        processid : process.pid,
        processing: true,
        processed: false
    }).lean();
     
    if(claimed.length === 0){
      console.log('other worker already claimed it');
      return;
    }
       console.log(claimed,' claimedjobs')
   const pipeline = redis.pipeline()

for (const job of claimed) {
  pipeline.rpush("job_queue", JSON.stringify(job.payload))
}

await pipeline.exec()

    const queueLength = await redis.llen('job_queue');
    console.log('Job queue length:', queueLength);

    // Mark them as processed
    await Outbox.updateMany(
        { _id: { $in: claimed.map(j => j._id) } },
        { $set: { processed: true, processedAt: Date.now() } }
    );
};


const recoverStuckJobs = async () => {
  try {
    const lock = await redis.set("recover_lock", "1", "EX", 240, "NX");
    if (!lock) return;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const result = await Outbox.updateMany(
      { processing: true, processed: false, processingAt: { $lt: fiveMinutesAgo } },
      { $set: { processing: false, processid : null } }
    );

    console.log(`[Recover] Released ${result.modifiedCount} stuck jobs`);
  } catch (err) {
    console.error("[Recover] Error:", err);
          }
};

// Run intervals


  setInterval(recoverStuckJobs, 6000);
  setInterval(Outbox_worker, 300);


console.log("Outbox worker started...");