# TTC Viewer

A monorepo project for viewing and analyzing transit data across Canadian transit agencies, with census boundary and population density analysis.

## Project Structure

- **apps/api** - NestJS API server for GTFS data processing and queries
- **apps/web** - SvelteKit web application for the user interface
- **packages/shared** - Shared TypeScript utilities and types
- **prisma** - Database schema and migrations
- **scripts** - Build and data processing scripts

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm
- Docker & Docker Compose (for database and deployment)

### Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
```

### Database & Data Setup

Before running the application, you need to obtain the census data files and database:

#### Provide Census Data Files

The following data files are required but not included in the repository:

1. **Census Boundary Shapefile**: `lda_000b21a_e.zip`
2. **Population Data**: `population_dwelling_counts_da_2021.csv`

Place these files in `prisma/data/census/2021/` directory or provide your own path.

```bash
# Create the data directory
mkdir -p prisma/data/census/2021

# Copy or download your census files here
cp /path/to/lda_000b21a_e.zip prisma/data/census/2021/
cp /path/to/population_dwelling_counts_da_2021.csv prisma/data/census/2021/
```

#### Initialize the Database

```bash
# Run migrations
pnpm prisma migrate deploy

# Seed the database (optional)
pnpm prisma db seed
```

### Development

```bash
# Start the development environment
docker-compose up

# In another terminal, run the development servers
pnpm dev

# The web app will be available at http://localhost:5173
# The API will be available at http://localhost:3000
```

### Building for Production

```bash
# Build all packages
pnpm build

# Build Docker images
docker-compose build

# Start production containers
docker-compose up
```

## Environment Variables

### API Server

- `CENSUS_BOUNDARY_ZIP_PATH` - Path to census boundary shapefile zip (defaults to `prisma/data/census/2021/lda_000b21a_e.zip`)
- `CENSUS_POPULATION_CSV_PATH` - Path to population data CSV (defaults to `prisma/data/census/2021/population_dwelling_counts_da_2021.csv`)
- `DATABASE_URL` - PostgreSQL connection string

### Web App

- `VITE_API_URL` - API server URL (defaults to `http://localhost:3000`)

## Deployment

### Docker Deployment

The project includes Docker and Docker Compose configuration for containerized deployment.

#### Before Deploying:

1. **Prepare census data files**:

```bash
# Create the data directory
mkdir -p prisma/data/census/2021

# Obtain and place the required files
cp /path/to/lda_000b21a_e.zip prisma/data/census/2021/
cp /path/to/population_dwelling_counts_da_2021.csv prisma/data/census/2021/
```

The `docker-compose.yml` automatically mounts these files as read-only volumes in the API container.

2. Deploy using Docker Compose:

```bash
docker-compose up -d
```

### Scaling Considerations

- Census data is loaded on API startup (cached in memory)
- Population density queries use spatial indexing for performance
- Tile generation is cached per session

## Data Files

### Large Data Files Not in Repository

The following large data files are excluded from the repository but required for the application:

- `prisma/data/census/2021/lda_000b21a_e.zip` - Statistics Canada census boundary shapefiles (Local Dissemination Areas)
- `prisma/data/census/2021/population_dwelling_counts_da_2021.csv` - Census population and dwelling counts

You must provide these files before running the application. Place them in `prisma/data/census/2021/` and Docker Compose will mount them as volumes in the API container during deployment.

## License

See LICENSE file for details

## Contributing

Contributions are welcome! Please ensure all tests pass and code is properly formatted before submitting a pull request.
