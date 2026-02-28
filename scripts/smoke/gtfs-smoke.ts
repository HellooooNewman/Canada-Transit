import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const minAgencies = Number.parseInt(process.env.SMOKE_MIN_AGENCIES ?? '1', 10);
  const agencies = await prisma.agency.findMany({
    where: { status: 'EXISTING' },
    include: {
      feedVersions: {
        where: { isActive: true },
        orderBy: { importedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { displayName: 'asc' },
  });

  if (agencies.length < minAgencies) {
    throw new Error(`Expected at least ${minAgencies} agencies, found ${agencies.length}.`);
  }

  const checked = agencies.slice(0, Math.min(agencies.length, 3));
  for (const agency of checked) {
    const feedVersion = agency.feedVersions[0];
    if (!feedVersion) {
      throw new Error(`Agency ${agency.slug} has no active feed version.`);
    }

    const [routeCount, stopCount, tripCount] = await Promise.all([
      prisma.gtfsRoute.count({ where: { feedVersionId: feedVersion.id } }),
      prisma.gtfsStop.count({ where: { feedVersionId: feedVersion.id } }),
      prisma.gtfsTrip.count({ where: { feedVersionId: feedVersion.id } }),
    ]);

    if (routeCount === 0 || stopCount === 0 || tripCount === 0) {
      throw new Error(
        `Agency ${agency.slug} has incomplete GTFS core data (routes=${routeCount}, stops=${stopCount}, trips=${tripCount}).`,
      );
    }

    console.log(
      `[smoke] ${agency.slug}: feedVersion=${feedVersion.id} routes=${routeCount} stops=${stopCount} trips=${tripCount}`,
    );
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
