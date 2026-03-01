-- Improve bbox lookups for mapRouteLines shape sampling.
CREATE INDEX "GtfsShapePoint_feedVersionId_shapePtLat_shapePtLon_idx"
  ON "GtfsShapePoint"("feedVersionId", "shapePtLat", "shapePtLon");
