import { redis } from "./redis";
const luaScript = `
local key = KEYS[1]

local capacity = tonumber(ARGV[1])
local refillrate = tonumber(ARGV[2])
local time = redis.call("TIME")
local now = tonumber(time[1]) * 1000

local bucket = redis.call("HMGET", key, "tokens", "lastrefill")

local tokens = tonumber(bucket[1])
local lastrefill = tonumber(bucket[2])

if tokens == nil then
    tokens = capacity
    lastrefill = now
end

local timelapsed = (now - lastrefill) / 1000
local refilltoken = timelapsed * refillrate

tokens = math.min(capacity, tokens + refilltoken)

local allowed = 0

if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
end

redis.call("HMSET", key, "tokens", tokens, "lastrefill", now)

if refillrate > 0 then
    local ttl = math.ceil(capacity / refillrate)
    redis.call("EXPIRE", key, ttl)
end

return { allowed, tokens }
`;
export const ratelimiter = async ({ key }) => {
    const capacity = 10;
    const refillrate = 1 / 10; // 1 request every 10 seconds after burst
    const result = await redis.eval(luaScript, 1, key, capacity, refillrate);
    return {
        success: result[0] === 1,
        tokensLeft: result[1],
    };
};
