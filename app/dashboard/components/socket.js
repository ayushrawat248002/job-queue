import { io } from "socket.io-client";

const socketurl = process.env.NEXT_PUBLIC_SOCKET_URL;

export const socket = io(
  socketurl || "http://localhost:5000",
  {
    autoConnect: false,
    transports: ["websocket"]
  }
);