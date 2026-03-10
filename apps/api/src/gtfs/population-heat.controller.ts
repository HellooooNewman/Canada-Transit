import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { CensusBoundaryService } from './census-boundary.service';

@Controller('map/population-heat')
export class PopulationHeatController {
  constructor(private readonly censusBoundaryService: CensusBoundaryService) {}

  @Get('health')
  getHealth() {
    return this.censusBoundaryService.getPopulationHeatHealth();
  }

  @Get(':z/:x/:y.bin')
  async getTile(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Query('v') versionKey: string | undefined,
    @Res() res: any,
  ) {
    const tile = await this.censusBoundaryService.getPopulationHeatTile({ z, x, y, versionKey });
    if (!tile) {
      res.status(204);
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(Buffer.alloc(0));
    }
    const payload = Buffer.from(tile.tileData);
    res.setHeader('Cache-Control', 'public, max-age=180');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(payload.byteLength));
    return res.send(payload);
  }
}
