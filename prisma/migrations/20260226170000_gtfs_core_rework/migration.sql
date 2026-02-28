-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DataProvenance" AS ENUM ('OFFICIAL', 'DERIVED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('EXISTING', 'UNDER_CONSTRUCTION', 'PLANNED', 'CANCELLED', 'DECOMMISSIONED');

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'CA',
    "subdivisionCode" TEXT,
    "timezone" TEXT,
    "defaultLang" TEXT,
    "website" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsFeedSource" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "basePath" TEXT NOT NULL,
    "zipPath" TEXT,
    "extractedPath" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsFeedSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsImportRun" (
    "id" TEXT NOT NULL,
    "feedSourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsFeedVersion" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "feedSourceId" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "versionHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsFeedVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsFeedInfo" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "feedPublisherName" TEXT,
    "feedPublisherUrl" TEXT,
    "feedLang" TEXT,
    "defaultLang" TEXT,
    "feedStartDate" TEXT,
    "feedEndDate" TEXT,
    "feedVersion" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsFeedInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsAgency" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "agencyId" TEXT,
    "agencyName" TEXT NOT NULL,
    "agencyUrl" TEXT NOT NULL,
    "agencyTimezone" TEXT NOT NULL,
    "agencyLang" TEXT,
    "agencyPhone" TEXT,
    "agencyFareUrl" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsAgency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsCalendar" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "monday" BOOLEAN NOT NULL,
    "tuesday" BOOLEAN NOT NULL,
    "wednesday" BOOLEAN NOT NULL,
    "thursday" BOOLEAN NOT NULL,
    "friday" BOOLEAN NOT NULL,
    "saturday" BOOLEAN NOT NULL,
    "sunday" BOOLEAN NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsCalendarDate" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "exceptionType" INTEGER NOT NULL,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsCalendarDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsRoute" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "agencyId" TEXT,
    "routeShortName" TEXT,
    "routeLongName" TEXT,
    "routeDesc" TEXT,
    "routeType" INTEGER NOT NULL,
    "routeUrl" TEXT,
    "routeColor" TEXT,
    "routeTextColor" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsStop" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "stopCode" TEXT,
    "stopName" TEXT NOT NULL,
    "stopDesc" TEXT,
    "stopLat" DOUBLE PRECISION,
    "stopLon" DOUBLE PRECISION,
    "zoneId" TEXT,
    "stopUrl" TEXT,
    "locationType" INTEGER,
    "parentStation" TEXT,
    "wheelchairBoarding" INTEGER,
    "platformCode" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsTrip" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "serviceId" TEXT,
    "tripHeadsign" TEXT,
    "tripShortName" TEXT,
    "directionId" INTEGER,
    "blockId" TEXT,
    "shapeId" TEXT,
    "wheelchairAccessible" INTEGER,
    "bikesAllowed" INTEGER,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsStopTime" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "arrivalTime" TEXT,
    "departureTime" TEXT,
    "stopId" TEXT NOT NULL,
    "stopSequence" INTEGER NOT NULL,
    "stopHeadsign" TEXT,
    "pickupType" INTEGER,
    "dropOffType" INTEGER,
    "shapeDistTraveled" DOUBLE PRECISION,
    "timepoint" INTEGER,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsStopTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsShapePoint" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "shapeId" TEXT NOT NULL,
    "shapePtLat" DOUBLE PRECISION NOT NULL,
    "shapePtLon" DOUBLE PRECISION NOT NULL,
    "shapePtSequence" INTEGER NOT NULL,
    "shapeDistTraveled" DOUBLE PRECISION,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsShapePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsFareAttribute" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "fareId" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "currencyType" TEXT,
    "paymentMethod" INTEGER,
    "transfers" INTEGER,
    "agencyId" TEXT,
    "transferDuration" INTEGER,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsFareAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsFareRule" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "fareId" TEXT NOT NULL,
    "routeId" TEXT,
    "originId" TEXT,
    "destinationId" TEXT,
    "containsId" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsFareRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsFrequency" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "headwaySecs" INTEGER,
    "exactTimes" INTEGER,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsFrequency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsTransfer" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "fromStopId" TEXT NOT NULL,
    "toStopId" TEXT NOT NULL,
    "transferType" INTEGER,
    "minTransferTime" INTEGER,
    "fromRouteId" TEXT,
    "toRouteId" TEXT,
    "fromTripId" TEXT,
    "toTripId" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsLevel" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "levelIndex" DOUBLE PRECISION,
    "levelName" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsPathway" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "pathwayId" TEXT NOT NULL,
    "fromStopId" TEXT,
    "toStopId" TEXT,
    "pathwayMode" INTEGER,
    "isBidirectional" INTEGER,
    "length" DOUBLE PRECISION,
    "traversalTime" INTEGER,
    "stairCount" INTEGER,
    "maxSlope" DOUBLE PRECISION,
    "minWidth" DOUBLE PRECISION,
    "signpostedAs" TEXT,
    "reversedSignpostedAs" TEXT,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsPathway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtfsRawTableRow" (
    "id" TEXT NOT NULL,
    "feedVersionId" TEXT NOT NULL,
    "tableName" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rowData" JSONB NOT NULL,
    "source" "DataProvenance" NOT NULL,
    "status" "LifecycleStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GtfsRawTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_slug_key" ON "Agency"("slug");
CREATE INDEX "Agency_displayName_idx" ON "Agency"("displayName");
CREATE INDEX "GtfsFeedSource_agencyId_enabled_idx" ON "GtfsFeedSource"("agencyId", "enabled");
CREATE UNIQUE INDEX "GtfsFeedSource_agencyId_sourceKey_key" ON "GtfsFeedSource"("agencyId", "sourceKey");
CREATE INDEX "GtfsImportRun_feedSourceId_startedAt_idx" ON "GtfsImportRun"("feedSourceId", "startedAt");
CREATE INDEX "GtfsFeedVersion_agencyId_isActive_idx" ON "GtfsFeedVersion"("agencyId", "isActive");
CREATE UNIQUE INDEX "GtfsFeedVersion_agencyId_versionHash_key" ON "GtfsFeedVersion"("agencyId", "versionHash");
CREATE UNIQUE INDEX "GtfsFeedInfo_feedVersionId_key" ON "GtfsFeedInfo"("feedVersionId");
CREATE INDEX "GtfsAgency_feedVersionId_agencyName_idx" ON "GtfsAgency"("feedVersionId", "agencyName");
CREATE UNIQUE INDEX "GtfsAgency_feedVersionId_agencyName_agencyId_key" ON "GtfsAgency"("feedVersionId", "agencyName", "agencyId");
CREATE INDEX "GtfsCalendar_feedVersionId_startDate_endDate_idx" ON "GtfsCalendar"("feedVersionId", "startDate", "endDate");
CREATE UNIQUE INDEX "GtfsCalendar_feedVersionId_serviceId_key" ON "GtfsCalendar"("feedVersionId", "serviceId");
CREATE INDEX "GtfsCalendarDate_feedVersionId_date_idx" ON "GtfsCalendarDate"("feedVersionId", "date");
CREATE UNIQUE INDEX "GtfsCalendarDate_feedVersionId_serviceId_date_key" ON "GtfsCalendarDate"("feedVersionId", "serviceId", "date");
CREATE INDEX "GtfsRoute_feedVersionId_routeType_routeShortName_idx" ON "GtfsRoute"("feedVersionId", "routeType", "routeShortName");
CREATE INDEX "GtfsRoute_feedVersionId_agencyId_idx" ON "GtfsRoute"("feedVersionId", "agencyId");
CREATE UNIQUE INDEX "GtfsRoute_feedVersionId_routeId_key" ON "GtfsRoute"("feedVersionId", "routeId");
CREATE INDEX "GtfsStop_feedVersionId_parentStation_idx" ON "GtfsStop"("feedVersionId", "parentStation");
CREATE INDEX "GtfsStop_feedVersionId_stopName_idx" ON "GtfsStop"("feedVersionId", "stopName");
CREATE INDEX "GtfsStop_feedVersionId_stopLat_stopLon_idx" ON "GtfsStop"("feedVersionId", "stopLat", "stopLon");
CREATE UNIQUE INDEX "GtfsStop_feedVersionId_stopId_key" ON "GtfsStop"("feedVersionId", "stopId");
CREATE INDEX "GtfsTrip_feedVersionId_routeId_directionId_idx" ON "GtfsTrip"("feedVersionId", "routeId", "directionId");
CREATE INDEX "GtfsTrip_feedVersionId_serviceId_idx" ON "GtfsTrip"("feedVersionId", "serviceId");
CREATE INDEX "GtfsTrip_feedVersionId_shapeId_idx" ON "GtfsTrip"("feedVersionId", "shapeId");
CREATE UNIQUE INDEX "GtfsTrip_feedVersionId_tripId_key" ON "GtfsTrip"("feedVersionId", "tripId");
CREATE INDEX "GtfsStopTime_feedVersionId_stopId_arrivalTime_idx" ON "GtfsStopTime"("feedVersionId", "stopId", "arrivalTime");
CREATE INDEX "GtfsStopTime_feedVersionId_tripId_stopSequence_idx" ON "GtfsStopTime"("feedVersionId", "tripId", "stopSequence");
CREATE UNIQUE INDEX "GtfsStopTime_feedVersionId_tripId_stopSequence_key" ON "GtfsStopTime"("feedVersionId", "tripId", "stopSequence");
CREATE INDEX "GtfsShapePoint_feedVersionId_shapeId_shapePtSequence_idx" ON "GtfsShapePoint"("feedVersionId", "shapeId", "shapePtSequence");
CREATE UNIQUE INDEX "GtfsShapePoint_feedVersionId_shapeId_shapePtSequence_key" ON "GtfsShapePoint"("feedVersionId", "shapeId", "shapePtSequence");
CREATE INDEX "GtfsFareAttribute_feedVersionId_agencyId_idx" ON "GtfsFareAttribute"("feedVersionId", "agencyId");
CREATE UNIQUE INDEX "GtfsFareAttribute_feedVersionId_fareId_key" ON "GtfsFareAttribute"("feedVersionId", "fareId");
CREATE INDEX "GtfsFareRule_feedVersionId_fareId_idx" ON "GtfsFareRule"("feedVersionId", "fareId");
CREATE INDEX "GtfsFareRule_feedVersionId_routeId_idx" ON "GtfsFareRule"("feedVersionId", "routeId");
CREATE INDEX "GtfsFrequency_feedVersionId_tripId_idx" ON "GtfsFrequency"("feedVersionId", "tripId");
CREATE INDEX "GtfsTransfer_feedVersionId_fromStopId_toStopId_idx" ON "GtfsTransfer"("feedVersionId", "fromStopId", "toStopId");
CREATE UNIQUE INDEX "GtfsLevel_feedVersionId_levelId_key" ON "GtfsLevel"("feedVersionId", "levelId");
CREATE INDEX "GtfsPathway_feedVersionId_fromStopId_toStopId_idx" ON "GtfsPathway"("feedVersionId", "fromStopId", "toStopId");
CREATE UNIQUE INDEX "GtfsPathway_feedVersionId_pathwayId_key" ON "GtfsPathway"("feedVersionId", "pathwayId");
CREATE INDEX "GtfsRawTableRow_feedVersionId_tableName_idx" ON "GtfsRawTableRow"("feedVersionId", "tableName");
CREATE UNIQUE INDEX "GtfsRawTableRow_feedVersionId_tableName_rowIndex_key" ON "GtfsRawTableRow"("feedVersionId", "tableName", "rowIndex");

-- AddForeignKey
ALTER TABLE "GtfsFeedSource" ADD CONSTRAINT "GtfsFeedSource_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsImportRun" ADD CONSTRAINT "GtfsImportRun_feedSourceId_fkey" FOREIGN KEY ("feedSourceId") REFERENCES "GtfsFeedSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsFeedVersion" ADD CONSTRAINT "GtfsFeedVersion_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsFeedVersion" ADD CONSTRAINT "GtfsFeedVersion_feedSourceId_fkey" FOREIGN KEY ("feedSourceId") REFERENCES "GtfsFeedSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsFeedVersion" ADD CONSTRAINT "GtfsFeedVersion_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "GtfsImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsFeedInfo" ADD CONSTRAINT "GtfsFeedInfo_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsAgency" ADD CONSTRAINT "GtfsAgency_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsCalendar" ADD CONSTRAINT "GtfsCalendar_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsCalendarDate" ADD CONSTRAINT "GtfsCalendarDate_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsRoute" ADD CONSTRAINT "GtfsRoute_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsStop" ADD CONSTRAINT "GtfsStop_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsTrip" ADD CONSTRAINT "GtfsTrip_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsTrip" ADD CONSTRAINT "GtfsTrip_feedVersionId_routeId_fkey" FOREIGN KEY ("feedVersionId", "routeId") REFERENCES "GtfsRoute"("feedVersionId", "routeId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsTrip" ADD CONSTRAINT "GtfsTrip_feedVersionId_serviceId_fkey" FOREIGN KEY ("feedVersionId", "serviceId") REFERENCES "GtfsCalendar"("feedVersionId", "serviceId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GtfsStopTime" ADD CONSTRAINT "GtfsStopTime_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsStopTime" ADD CONSTRAINT "GtfsStopTime_feedVersionId_tripId_fkey" FOREIGN KEY ("feedVersionId", "tripId") REFERENCES "GtfsTrip"("feedVersionId", "tripId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsStopTime" ADD CONSTRAINT "GtfsStopTime_feedVersionId_stopId_fkey" FOREIGN KEY ("feedVersionId", "stopId") REFERENCES "GtfsStop"("feedVersionId", "stopId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsShapePoint" ADD CONSTRAINT "GtfsShapePoint_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsFareAttribute" ADD CONSTRAINT "GtfsFareAttribute_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsFareRule" ADD CONSTRAINT "GtfsFareRule_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsFrequency" ADD CONSTRAINT "GtfsFrequency_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsTransfer" ADD CONSTRAINT "GtfsTransfer_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsLevel" ADD CONSTRAINT "GtfsLevel_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsPathway" ADD CONSTRAINT "GtfsPathway_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GtfsRawTableRow" ADD CONSTRAINT "GtfsRawTableRow_feedVersionId_fkey" FOREIGN KEY ("feedVersionId") REFERENCES "GtfsFeedVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
