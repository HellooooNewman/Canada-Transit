-- Precomputed transit heat tiles for smooth, zoom-stable map overlays.
CREATE TABLE "TransitHeatTile" (
  "id" TEXT NOT NULL,
  "versionKey" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "z" INTEGER NOT NULL,
  "x" INTEGER NOT NULL,
  "y" INTEGER NOT NULL,
  "gridSize" INTEGER NOT NULL,
  "tileData" BYTEA NOT NULL,
  "maxValue" DOUBLE PRECISION NOT NULL,
  "sourceMeta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TransitHeatTile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransitHeatTile_versionKey_z_x_y_key"
  ON "TransitHeatTile"("versionKey", "z", "x", "y");

CREATE INDEX "TransitHeatTile_isActive_z_x_y_idx"
  ON "TransitHeatTile"("isActive", "z", "x", "y");

CREATE INDEX "TransitHeatTile_versionKey_z_idx"
  ON "TransitHeatTile"("versionKey", "z");
