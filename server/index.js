import express from "express";
import logger from "morgan";
import dotenv from "dotenv";
import multer from "multer";
import path from "path";
import { createClient } from "@libsql/client";
import { Server } from "socket.io";
import { createServer } from "node:http";

dotenv.config();

const port = process.env.PORT ?? 3001;

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {},
});

const db = createClient({
  url: "libsql://relative-corsair-davidq12.turso.io",
  authToken: process.env.DB_AUTH_TOKEN,
});

// Verificar y agregar la columna "image" si no existe
await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT,
    user TEXT
  )
`);

try {
  await db.execute(`
    ALTER TABLE messages ADD COLUMN image TEXT;
  `);
} catch (err) {
  if (!err.message.includes("duplicate column name")) {
    console.error("Error al agregar la columna 'image':", err);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // Carpeta para guardar imágenes
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Nombre único para cada archivo
  },
});

const upload = multer({ storage });

// Servir imágenes estáticas
app.use("/uploads", express.static("uploads"));

// Endpoint para subir imágenes
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).send("No se recibió ninguna imagen");
  }
  res.status(200).json({ imageUrl: `/uploads/${req.file.filename}` });
});

// Usuarios aleatorios
const usernames = ["Patrick", "Ademir", "Pleitez", "David", "Khaterine"];

io.on("connection", async (socket) => {
  console.log("Un usuario se ha conectado");

  // Nombre aleatorio para el usuario
  const username = usernames[Math.floor(Math.random() * usernames.length)];
  console.log(`El nombre del usuario es: ${username}`);

  socket.on("disconnect", () => {
    console.log("Un usuario se ha desconectado");
  });

  // Manejo de mensajes del chat
  socket.on("chat message", async ({ text, image }) => {
    console.log("Mensaje recibido:", { text, image }); // Registro de los datos recibidos

    try {
      const result = await db.execute({
        sql: "INSERT INTO messages (content, user, image) VALUES (:text, :username, :image)",
        args: { text, username, image },
      });

      io.emit("chat message", {
        text,
        image,
        id: result.lastInsertRowid.toString(),
        username,
      });
    } catch (err) {
      console.error("Error al guardar el mensaje:", err);
    }
  });

  // Cargar mensajes previos
  if (!socket.recovered) {
    try {
      const results = await db.execute({
        sql: "SELECT id, content, user, image FROM messages",
      });

      results.rows.forEach((row) => {
        socket.emit("chat message", {
          text: row.content,
          image: row.image,
          id: row.id.toString(),
          username: row.user,
        });
      });
    } catch (err) {
      console.error("Error al cargar mensajes:", err);
    }
  }
});

app.use(logger("dev"));

// Endpoint principal
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/client/index.html");
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
