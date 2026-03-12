import { INestApplication, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    const startTime = Date.now();
    this.logger.log('[PrismaService] Connecting to database...');
    await this.$connect();
    const durationMs = Date.now() - startTime;
    this.logger.log(`[PrismaService] Database connected in ${durationMs}ms`);
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
