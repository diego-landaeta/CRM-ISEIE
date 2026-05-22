-- ============================================================
-- Migracion 009: Categorias y subcategorias de productos
-- Cada proyecto puede personalizar el label del "tipo" (ej:
-- Fono Aprende = "Formacion", Nutricionista IA = "Plan", etc)
-- y tener categorias (+ subcategorias) para organizar productos.
-- ============================================================

BEGIN;

-- Label configurable por proyecto (ej: "Formacion", "Plan", "Servicio")
ALTER TABLE projects ADD COLUMN IF NOT EXISTS producto_label VARCHAR(50) NOT NULL DEFAULT 'Producto';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS producto_label_plural VARCHAR(50) NOT NULL DEFAULT 'Productos';

-- Categorias por proyecto (ej: "Cursos online", "Presenciales", "Talleres")
CREATE TABLE IF NOT EXISTS product_categories (
  id          SERIAL        PRIMARY KEY,
  project_id  INTEGER       NOT NULL,
  parent_id   INTEGER,
  nombre      VARCHAR(100)  NOT NULL,
  orden       INTEGER       NOT NULL DEFAULT 0,
  active      BOOLEAN       NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_pc_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_parent  FOREIGN KEY (parent_id) REFERENCES product_categories(id) ON DELETE SET NULL,
  CONSTRAINT uq_pc_project_nombre UNIQUE (project_id, parent_id, nombre)
);

CREATE INDEX idx_pc_project ON product_categories (project_id, active);
CREATE INDEX idx_pc_parent ON product_categories (parent_id);

-- FK en products a categoria (opcional; puede no tenerla)
ALTER TABLE products ADD COLUMN IF NOT EXISTS categoria_id INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategoria_id INTEGER;
ALTER TABLE products ADD CONSTRAINT fk_products_categoria
  FOREIGN KEY (categoria_id) REFERENCES product_categories(id) ON DELETE SET NULL;
ALTER TABLE products ADD CONSTRAINT fk_products_subcategoria
  FOREIGN KEY (subcategoria_id) REFERENCES product_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_products_categoria ON products (categoria_id);

COMMENT ON TABLE product_categories IS 'Categorias y subcategorias de productos por proyecto (auto-referencial via parent_id)';
COMMENT ON COLUMN projects.producto_label IS 'Label singular personalizado (ej Formacion, Plan, Servicio)';

COMMIT;
