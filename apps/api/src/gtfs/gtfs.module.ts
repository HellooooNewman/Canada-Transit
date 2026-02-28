import { Module } from '@nestjs/common';
import { GtfsService } from './gtfs.service';
import { GtfsResolver } from './gtfs.resolver';
import { RealtimeService } from './realtime.service';

@Module({
  providers: [GtfsService, GtfsResolver, RealtimeService],
  exports: [GtfsService, RealtimeService],
})
export class GtfsModule {}
