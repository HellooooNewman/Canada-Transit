import { Module } from '@nestjs/common';
import { GtfsService } from './gtfs.service';
import { GtfsResolver } from './gtfs.resolver';
import { RealtimeService } from './realtime.service';
import { TransitHeatController } from './transit-heat.controller';
import { CensusBoundaryService } from './census-boundary.service';
import { PopulationHeatController } from './population-heat.controller';

@Module({
  controllers: [TransitHeatController, PopulationHeatController],
  providers: [GtfsService, GtfsResolver, RealtimeService, CensusBoundaryService],
  exports: [GtfsService, RealtimeService],
})
export class GtfsModule {}
