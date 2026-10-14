SET NAMES utf8mb4;

-- BookSoftware: base de datos y datos de ejemplo
-- Compatible con el backend (tabla "libros")

CREATE DATABASE IF NOT EXISTS booksoftware
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE booksoftware;

-- Tabla principal
CREATE TABLE IF NOT EXISTS libros (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  titulo        VARCHAR(255) NOT NULL,
  autor         VARCHAR(255) NOT NULL,
  anio          INT,
  genero        VARCHAR(50) NOT NULL DEFAULT 'General',
  calificacion  INT NOT NULL DEFAULT 0,
  isbn          VARCHAR(20) NULL,
  portada       TEXT NULL,
  leido         BOOLEAN NOT NULL DEFAULT FALSE
);

-- Datos de ejemplo
INSERT INTO libros (titulo, autor, anio, genero, calificacion, isbn, portada, leido) VALUES
  ('Cien años de soledad', 'Gabriel García Márquez', 1967, 'Novela', 5, '9780307474728', 'https://covers.openlibrary.org/b/isbn/9780307474728-L.jpg', TRUE),
  ('Don Quijote de la Mancha', 'Miguel de Cervantes', 1605, 'Clásico', 5, '9788420412149', 'https://covers.openlibrary.org/b/isbn/9788420412149-L.jpg', FALSE),
  ('El principito', 'Antoine de Saint-Exupéry', 1943, 'Ficción', 4, '9780156012195', 'https://covers.openlibrary.org/b/isbn/9780156012195-L.jpg', TRUE),
  ('1984', 'George Orwell', 1949, 'Ciencia Ficción', 5, '9780451524935', 'https://covers.openlibrary.org/b/isbn/9780451524935-L.jpg', FALSE),
  ('La sombra del viento', 'Carlos Ruiz Zafón', 2001, 'Historia', 4, '9788408044555', 'https://covers.openlibrary.org/b/isbn/9788408044555-L.jpg', FALSE),
  ('Rayuela', 'Julio Cortázar', 1963, 'Novela', 4, '9788437604948', 'https://covers.openlibrary.org/b/isbn/9788437604948-L.jpg', FALSE),
  ('El túnel', 'Ernesto Sábato', 1948, 'Biografía', 3, '9789500716150', 'https://covers.openlibrary.org/b/isbn/9789500716150-L.jpg', TRUE);

-- Consultas útiles para probar
SELECT * FROM libros;
SELECT titulo, autor FROM libros WHERE leido = TRUE;
SELECT titulo, autor FROM libros WHERE leido = FALSE ORDER BY anio;
SELECT * FROM libros WHERE autor LIKE '%Orwell%';
SELECT leido, COUNT(*) AS total FROM libros GROUP BY leido;
