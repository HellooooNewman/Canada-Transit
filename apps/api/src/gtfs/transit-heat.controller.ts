import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { GtfsService } from './gtfs.service';

@Controller('map/transit-heat')
export class TransitHeatController {
  constructor(private readonly gtfsService: GtfsService) {}

  @Get('version')
  getVersion() {
    return this.gtfsService.getLatestTransitHeatVersion();
  }

  @Get('health')
  getHealth() {
    return this.gtfsService.getTransitHeatHealth();
  }

  @Get(':z/:x/:y.bin')
  async getTile(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Query('v') versionKey: string | undefined,
    @Res() res: any,
  ) {
    const tile = await this.gtfsService.getTransitHeatTile({ z, x, y, versionKey });
    if (!tile) {
      res.status(204);
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(Buffer.alloc(0));
    }
    const payload = Buffer.from(tile.tileData);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(payload.byteLength));
    return res.send(payload);
  }
}
