import { io } from "socket.io-client";

// URL del servidor Socket.io a probar
const SERVER_URL = "http://localhost:3000";

const socket = io(SERVER_URL, {
  reconnectionAttempts: 5,
  timeout: 5000,
  transports: ["websocket"],
})

socket.on("connect", () => {
  console.log(`✅ Conectado al servidor Socket.io con ID: ${socket.id}`)
  socket.emit("mensaje", { msg: "Hola servidor, soy el cliente" })
})

socket.on("mensaje_respuesta", (data) => {
  console.log("📩 Mensaje recibido del servidor:", data)
})

socket.on("connect_error", (err) => {
  console.error("❌ Error de conexión:", err.message)
})

socket.on("disconnect", (reason) => {
  console.warn("⚠️ Desconectado del servidor:", reason)
})
