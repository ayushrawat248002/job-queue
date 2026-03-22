// dist/lib/redis.js
import IORedis from "ioredis";
import "dotenv/config"; // automatically loads .env

// Ensure REDIS_URL is set
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("❌ REDIS_URL is not set in environment variables. Exiting...");
  process.exit(1); // stop the worker early instead of crashing later
}

// Create Redis client with retry strategy
export const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: 5, // limit retries per command
  retryStrategy(times) {
    // exponential backoff: 50ms, 100ms, 200ms, etc.
    const delay = Math.min(times * 50, 2000);
    console.warn(`⚠️ Redis reconnect attempt #${times}, retrying in ${delay}ms`);
    return delay;
  },
});

redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

redis.on("close", () => {
  console.warn("⚠️ Redis connection closed");
});

redis.on("reconnecting", (delay) => {
  console.log(`🔄 Redis reconnecting in ${delay}ms...`);
});