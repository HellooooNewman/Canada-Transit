# Seed-to-UI Field Matrix

This matrix tracks GTFS-core seeded data and current UI exposure after the GTFS-first hard cutover.

## Ingestion Metadata

| Entity | Seeded/Stored Fields | API Exposed | UI Shown |
|---|---|---|---|
| `Agency` | `slug`, `displayName`, `countryCode`, `subdivisionCode`, `timezone` | `agencies` | Agencies page + selectors |
| `GtfsFeedSource` | source type/path metadata | Not directly | Not directly |
| `GtfsImportRun` | status, timings, row counts, validation stats | Not directly | Not directly |
| `GtfsFeedVersion` | version hash, active flag, import timestamp | Included via `agencies` | Agencies page summary |

## Static GTFS Core

| Entity | High-value fields in seed | API Exposed | UI Shown |
|---|---|---|---|
| `GtfsRoute` | `routeId`, `agencyId`, `routeType`, names/colors | `gtfsRoutes` | GTFS explorer + map summary |
| `GtfsStop` | `stopId`, `stopName`, `stopLat`, `stopLon`, accessibility fields | `gtfsStops` | GTFS explorer + map stop count |
| `GtfsTrip` | `tripId`, `routeId`, `serviceId`, `directionId`, accessibility fields | `gtfsTrips` | GTFS explorer summary |
| `GtfsStopTime` | trip-stop sequencing + timing fields | `gtfsStopTimes` | API-only in current UI |
| `GtfsShapePoint` | shape geometry points | `gtfsShapes` | API-only in current UI |
| `GtfsFareAttribute` / `GtfsFareRule` | legacy fare tables | `gtfsTableRows(tableName: \"fare_attributes\"/\"fare_rules\")` | API-only |
| `GtfsFrequency` | headway-based service rows | `gtfsTableRows(tableName: \"frequencies\")` | API-only |
| `GtfsTransfer` | transfer constraints | `gtfsTableRows(tableName: \"transfers\")` | API-only |
| `GtfsLevel` / `GtfsPathway` | station indoor topology | `gtfsTableRows(tableName: \"levels\"/\"pathways\")` | API-only |
| `GtfsRawTableRow` | any unmodeled/extension table rows | `gtfsTableRows(tableName: \"<extension_name>\")` | API-only |
| `GtfsCalendar` / `GtfsCalendarDate` | service windows and exceptions | API-internal for now | Not shown directly |
| `GtfsFeedInfo` | feed publisher/version metadata | API-internal for now | Not shown directly |

## Deferred To Future Phases

| Area | Status |
|---|---|
| GTFS-RT vehicle snapshots | Deferred |
| GTFS-RT trip updates | Deferred |
| Alerts and outage analytics | Deferred |
| Ridership and TTC-specific overlays | Removed from phase 1 |
