import { createServer } from "http";
import { Server } from "socket.io";
import IORedis from "ioredis";
import { redis } from "./redis.js";

const httpServer = createServer();

const io = new Server(httpServer,{
  cors:{ origin:"http://localhost:3000"}
});

/* Redis connection monitoring */
redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("ready", () => {
  console.log("🚀 Redis ready");
});

redis.on("error", (err) => {
  console.error("❌ Redis error:", err);
});

redis.on("close", () => {
  console.warn("⚠️ Redis connection closed");
});

/* Subscriber client */
const subclient = new IORedis(process.env.REDIS_URL);

subclient.subscribe("job_event");

subclient.on("message",(channel,message)=>{

  const data = JSON.parse(message);

  console.log("job event:",data);

  io.to(data.groupname).emit("job_update",data.payload);

});

/* Socket connections */
io.on("connection",(socket)=>{

  console.log("client connected",socket.id);

  socket.on("join",(content)=>{
    socket.join(content.group);
    console.log(socket.id,"joined",content.group);
  });

  socket.on("disconnect",()=>{
    console.log("client disconnected",socket.id);
  });

});

httpServer.listen(5000,()=>{
  console.log("Socket server running on port 5000");
});