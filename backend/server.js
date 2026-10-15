const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

function normalizarTexto(valor, maxLength = 255) {
  if (typeof valor !== "string") return "";
  return valor.trim().slice(0, maxLength);
}

function escaparHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function validarNumero(value, min, max, campo) {
  if (value === undefined || value === null || value === "") return null;
  const numero = Number(value);
  if (!Number.isFinite(numero) || numero < min || numero > max) {
    throw new Error(`${campo} debe estar entre ${min} y ${max}.`);
  }
  return numero;
}

async function conectarBD() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  });

  for (let intento = 1; intento <= 30; intento++) {
    try {
      await pool.query("SELECT 1");
      return pool;
    } catch (error) {
      console.error(`Base de datos no disponible (intento ${intento}/30):`, error.message);
      if (intento < 30) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  throw new Error("No se pudo conectar a la base de datos.");
}

async function migrarEsquema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS libros (
      id INT AUTO_INCREMENT PRIMARY KEY,
      titulo VARCHAR(255) NOT NULL,
      autor VARCHAR(255) NOT NULL,
      anio INT NULL,
      genero VARCHAR(50) NOT NULL DEFAULT 'General',
      calificacion INT NOT NULL DEFAULT 0,
      isbn VARCHAR(20) NULL,
      portada TEXT NULL,
      leido BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  const [columnas] = await pool.query("SHOW COLUMNS FROM libros");
  const nombresColumnas = columnas.map((columna) => columna.Field);

  if (!nombresColumnas.includes("genero")) {
    await pool.query("ALTER TABLE libros ADD COLUMN genero VARCHAR(50) NOT NULL DEFAULT 'General'");
  }

  if (!nombresColumnas.includes("calificacion")) {
    await pool.query("ALTER TABLE libros ADD COLUMN calificacion INT NOT NULL DEFAULT 0");
  }

  if (!nombresColumnas.includes("isbn")) {
    await pool.query("ALTER TABLE libros ADD COLUMN isbn VARCHAR(20) NULL");
  }

  if (!nombresColumnas.includes("portada")) {
    await pool.query("ALTER TABLE libros ADD COLUMN portada TEXT NULL");
  }

  await pool.query(`
    UPDATE libros
    SET genero = COALESCE(NULLIF(genero, ''), 'General')
    WHERE genero IS NULL OR genero = ''
  `);

  await pool.query(`
    UPDATE libros
    SET calificacion = 0
    WHERE calificacion IS NULL OR calificacion < 1 OR calificacion > 5
  `);

}

function obtenerFiltro(req) {
  const filtro = normalizarTexto(String(req.query.filtro || "todos")).toLowerCase();
  return ["todos", "leidos", "pendientes"].includes(filtro) ? filtro : "todos";
}

function construirConsultaLibros({ busqueda, filtro }) {
  let sql = "SELECT * FROM libros";
  const condiciones = [];
  const valores = [];

  if (busqueda) {
    condiciones.push("(titulo LIKE ? OR autor LIKE ? OR genero LIKE ?)");
    const term = `%${busqueda}%`;
    valores.push(term, term, term);
  }

  if (filtro === "leidos") {
    condiciones.push("leido = TRUE");
  } else if (filtro === "pendientes") {
    condiciones.push("leido = FALSE");
  }

  if (condiciones.length) {
    sql += " WHERE " + condiciones.join(" AND ");
  }

  sql += " ORDER BY id DESC";

  return { sql, valores };
}

async function iniciar() {
  const pool = await conectarBD();
  await migrarEsquema(pool);

  app.get("/health", async (req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch (error) {
      console.error("Error en comprobación de salud:", error);
      res.status(503).json({ ok: false, error: "La base de datos no está disponible." });
    }
  });

  app.get("/libros", async (req, res) => {
    try {
      const busqueda = normalizarTexto(String(req.query.search || ""));
      const filtro = obtenerFiltro(req);
      const { sql, valores } = construirConsultaLibros({ busqueda, filtro });
      const [filas] = await pool.query(sql, valores);
      res.json(filas);
    } catch (error) {
      console.error("Error al listar libros:", error);
      res.status(500).json({ ok: false, error: "No se pudo cargar la lista de libros." });
    }
  });

  app.get("/libros/buscar", async (req, res) => {
    try {
      const busqueda = normalizarTexto(String(req.query.search || ""));
      const filtro = obtenerFiltro(req);
      const { sql, valores } = construirConsultaLibros({ busqueda, filtro });
      const [filas] = await pool.query(sql, valores);
      res.json(filas);
    } catch (error) {
      console.error("Error en búsqueda:", error);
      res.status(500).json({ ok: false, error: "No se pudo realizar la búsqueda." });
    }
  });

  app.get("/estadisticas", async (req, res) => {
    try {
      const [resultado] = await pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN leido = TRUE THEN 1 ELSE 0 END) AS leidos,
          SUM(CASE WHEN leido = FALSE THEN 1 ELSE 0 END) AS pendientes,
          ROUND(AVG(CASE WHEN calificacion > 0 THEN calificacion ELSE NULL END), 1) AS media
        FROM libros
      `);

      const stats = resultado[0] || {};
      res.json({
        total: Number(stats.total || 0),
        leidos: Number(stats.leidos || 0),
        pendientes: Number(stats.pendientes || 0),
        media: stats.media === null ? 0 : Number(stats.media),
      });
    } catch (error) {
      console.error("Error al calcular estadísticas:", error);
      res.status(500).json({ ok: false, error: "No se pudieron cargar las estadísticas." });
    }
  });

  app.get("/libros/isbn/:isbn", async (req, res) => {
    try {
      const isbn = String(req.params.isbn || "").replace(/[^\dXx]/g, "");
      if (!isbn) {
        return res.status(400).json({ ok: false, error: "ISBN no válido." });
      }

      const response = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
      if (!response.ok) {
        return res.status(404).json({ ok: false, error: "No se encontró información para ese ISBN." });
      }

      const data = await response.json();
      const portada = data?.covers && data.covers[0] ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg` : null;

      res.json({
        ok: true,
        libro: {
          titulo: data?.title || "",
          autor: Array.isArray(data?.authors) && data.authors[0]?.name ? data.authors[0].name : "",
          anio: data?.publish_date ? Number(String(data.publish_date).match(/(\d{4})/)?.[1] || 0) || null : null,
          genero: "General",
          calificacion: null,
          portada,
          isbn,
        },
      });
    } catch (error) {
      console.error("Error al consultar ISBN:", error);
      res.status(500).json({ ok: false, error: "No se pudo consultar el ISBN." });
    }
  });

  app.post("/libros", async (req, res) => {
    try {
      const titulo = normalizarTexto(req.body?.titulo || "", 255);
      const autor = normalizarTexto(req.body?.autor || "", 255);
      const genero = normalizarTexto(req.body?.genero || "General", 50) || "General";
      const anio = validarNumero(req.body?.anio, 0, 2100, "Año");
      const calificacion = validarNumero(req.body?.calificacion, 1, 5, "Calificación");
      const isbn = normalizarTexto(String(req.body?.isbn || ""), 20);
      const portada = normalizarTexto(String(req.body?.portada || ""), 500);

      if (!titulo) {
        return res.status(400).json({ ok: false, error: "El título es obligatorio." });
      }

      if (!autor) {
        return res.status(400).json({ ok: false, error: "El autor es obligatorio." });
      }

      if (anio === null && req.body?.anio !== undefined && req.body?.anio !== null && req.body?.anio !== "") {
        return res.status(400).json({ ok: false, error: "El año debe estar entre 0 y 2100." });
      }

      if (calificacion === null && req.body?.calificacion !== undefined && req.body?.calificacion !== null && req.body?.calificacion !== "") {
        return res.status(400).json({ ok: false, error: "La calificación debe estar entre 1 y 5." });
      }

      const [resultado] = await pool.query(
        "INSERT INTO libros (titulo, autor, anio, genero, calificacion, isbn, portada, leido) VALUES (?, ?, ?, ?, ?, ?, ?, FALSE)",
        [titulo, autor, anio, genero, calificacion ?? 0, isbn || null, portada || null]
      );

      const [libro] = await pool.query("SELECT * FROM libros WHERE id = ?", [resultado.insertId]);
      res.status(201).json({ ok: true, libro: libro[0] });
    } catch (error) {
      console.error("Error al crear libro:", error);
      res.status(500).json({ ok: false, error: error.message || "No se pudo crear el libro." });
    }
  });

  app.put("/libros/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ ok: false, error: "ID no válido." });
      }

      const titulo = normalizarTexto(req.body?.titulo || "", 255);
      const autor = normalizarTexto(req.body?.autor || "", 255);
      const genero = normalizarTexto(req.body?.genero || "General", 50) || "General";
      const anio = validarNumero(req.body?.anio, 0, 2100, "Año");
      const calificacion = validarNumero(req.body?.calificacion, 1, 5, "Calificación");
      const isbn = normalizarTexto(String(req.body?.isbn || ""), 20);
      const portada = normalizarTexto(String(req.body?.portada || ""), 500);

      if (!titulo) {
        return res.status(400).json({ ok: false, error: "El título es obligatorio." });
      }

      if (!autor) {
        return res.status(400).json({ ok: false, error: "El autor es obligatorio." });
      }

      if (anio === null && req.body?.anio !== undefined && req.body?.anio !== null && req.body?.anio !== "") {
        return res.status(400).json({ ok: false, error: "El año debe estar entre 0 y 2100." });
      }

      if (calificacion === null && req.body?.calificacion !== undefined && req.body?.calificacion !== null && req.body?.calificacion !== "") {
        return res.status(400).json({ ok: false, error: "La calificación debe estar entre 1 y 5." });
      }

      await pool.query(
        `UPDATE libros SET titulo = ?, autor = ?, anio = ?, genero = ?, calificacion = ?, isbn = ?, portada = ? WHERE id = ?`,
        [titulo, autor, anio, genero, calificacion ?? 0, isbn || null, portada || null, id]
      );

      const [libros] = await pool.query("SELECT * FROM libros WHERE id = ?", [id]);
      res.json({ ok: true, libro: libros[0] });
    } catch (error) {
      console.error("Error al editar libro:", error);
      res.status(500).json({ ok: false, error: error.message || "No se pudo editar el libro." });
    }
  });

  app.put("/libros/:id/leido", async (req, res) => {
    try {
      await pool.query("UPDATE libros SET leido = NOT leido WHERE id = ?", [req.params.id]);
      const [libros] = await pool.query("SELECT * FROM libros WHERE id = ?", [req.params.id]);
      res.json({ ok: true, libro: libros[0] });
    } catch (error) {
      console.error("Error al cambiar estado:", error);
      res.status(500).json({ ok: false, error: "No se pudo cambiar el estado del libro." });
    }
  });

  app.delete("/libros/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ ok: false, error: "ID no válido." });
      }

      await pool.query("DELETE FROM libros WHERE id = ?", [id]);
      res.json({ ok: true });
    } catch (error) {
      console.error("Error al eliminar libro:", error);
      res.status(500).json({ ok: false, error: "No se pudo eliminar el libro." });
    }
  });

  app.use((err, req, res, next) => {
    console.error("Error no controlado:", err);
    res.status(500).json({ ok: false, error: "Error interno del servidor." });
  });

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`API de booksoftware en puerto ${port}`));
}

iniciar().catch((error) => {
  console.error("Fallo al iniciar backend:", error);
  process.exit(1);
});
