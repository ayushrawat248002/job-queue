import { createServer } from "http";
import { Server } from "socket.io";
import IORedis from "ioredis";
import { redis } from "./redis.js";

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:3000",
      process.env.FRONTEND_URL
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
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
const subclient = new IORedis(process.env.REDIS_URL, {
  tls: {},
  maxRetriesPerRequest: null,
});

subclient.on("connect", () => console.log("SUB connected"));
subclient.on("ready", () => console.log("SUB ready"));
subclient.on("error", (err) => console.error("SUB error", err));
subclient.on("close", () => console.log("SUB closed"));
subclient.on("end", () => console.log("SUB ended"));


/* Subscribe to Redis events */
(async () => {
  try {
    await subclient.subscribe("job_event");
    console.log("✅ Subscribed to job_event");
  } catch (err) {
    console.error("Subscribe failed:", err);
  }
})();


/* Receive job events from Redis */
subclient.on("message", (channel, message) => {
  try {
    const data = JSON.parse(message);

    console.log("job event:", data);

    io.to(data.groupname).emit(
      "job_update",
      data.payload
    );

  } catch (error) {
    console.error("Invalid job event:", error);
  }
});


/* Socket connections */
io.on("connection", (socket) => {

  console.log("client connected", socket.id);


  socket.on("join", (content) => {

    socket.join(content.group);

    console.log(
      socket.id,
      "joined",
      content.group
    );

  });


  socket.on("disconnect", () => {
    console.log(
      "client disconnected",
      socket.id
    );
  });

});


/*
  Render assigns PORT dynamically.
  Local development uses 5000.
*/
const PORT = process.env.PORT || 5000;

httpServer.listen(process.env.PORT || 5000, "0.0.0.0", () => {
  console.log(`Socket server running on port ${PORT}`);
});