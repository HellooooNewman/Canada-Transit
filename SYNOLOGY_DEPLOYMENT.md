# Synology Deployment Guide

## Prerequisites

1. **Docker Hub Account**: Push your built images to Docker Hub
2. **Synology NAS**: With SSH access enabled
3. **GitHub Secrets**: Configure these in your repository settings

## GitHub Secrets Setup

Add these secrets to your repository (`Settings > Secrets and variables > Actions`):

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token (create at https://hub.docker.com/settings/security) |
| `SYNOLOGY_HOST` | IP or hostname of your Synology NAS |
| `SYNOLOGY_PORT` | SSH port (usually 22) |
| `SYNOLOGY_USER` | SSH user (usually `root` or your NAS user) |
| `SYNOLOGY_SSH_KEY` | Private SSH key for Synology access |

### Generate SSH Key for Synology

```bash
# On your local machine
ssh-keygen -t ed25519 -f synology_key -N ""

# Copy public key to Synology
ssh-copy-id -i synology_key.pub user@synology-ip

# Get the private key (add to GitHub Secrets)
cat synology_key
```

## Synology NAS Setup

### 1. Create the deployment directory

SSH into your Synology:

```bash
ssh user@synology-ip
sudo mkdir -p /volume1/docker/ttc-viewer/data
sudo chmod 755 /volume1/docker/ttc-viewer
```

### 2. Copy docker-compose.yml to Synology

```bash
scp -P 22 docker-compose.synology.yml user@synology-ip:/volume1/docker/ttc-viewer/docker-compose.yml
```

### 3. Copy your data folder (if needed)

```bash
scp -r prisma/data/* user@synology-ip:/volume1/docker/ttc-viewer/data/
```

### 4. Update docker-compose.yml with your Docker Hub username

On the Synology NAS:

```bash
ssh user@synology-ip
sudo nano /volume1/docker/ttc-viewer/docker-compose.yml

# Replace "yourusername" with your actual Docker Hub username
# Save with Ctrl+O, Enter, Ctrl+X
```

## Deployment Flow

### Automatic Deployment (on push to main)

1. Push to `main` branch
2. GitHub Actions automatically:
   - Builds API and Web images
   - Pushes images to Docker Hub
   - SSHes into Synology
   - Pulls latest images
   - Restarts containers with `docker compose up -d`

### Manual Deployment

Trigger the workflow manually in GitHub -> Actions -> Build and Deploy to Synology -> Run workflow

## Deployment Commands on Synology

If you need to manually deploy:

```bash
ssh user@synology-ip
cd /volume1/docker/ttc-viewer
docker compose pull      # Pull latest images
docker compose up -d     # Start/restart containers
docker compose logs      # View logs
```

## Rollback Strategy

### Option 1: Use Tag-Based Rollback

In `docker-compose.yml`, change the image tag:

```yaml
api:
  image: yourusername/ttc-api:1.0.4  # Previous working version
web:
  image: yourusername/ttc-web:1.0.4
```

Then redeploy:

```bash
cd /volume1/docker/ttc-viewer
docker compose pull
docker compose up -d
```

### Option 2: GitHub Actions Workflow Dispatch

Modify `.github/workflows/deploy.yml` to add inputs for tag selection:

```yaml
on:
  workflow_dispatch:
    inputs:
      api_tag:
        description: 'API image tag'
        default: 'latest'
      web_tag:
        description: 'Web image tag'
        default: 'latest'
```

Then adjust the SSH deployment script to use these tags.

## Database Persistence

- PostgreSQL data is stored in the Docker volume `pgdata`
- Application data files are in `/volume1/docker/ttc-viewer/data`
- This directory is read-only mounted in the API container

## Troubleshooting

### Images not updating

```bash
# Force pull fresh images
docker compose pull --no-parallel
docker compose up -d --force-recreate
```

### View container logs

```bash
docker compose logs -f api     # API logs
docker compose logs -f web     # Web logs
docker compose logs -f postgres # Database logs
```

### Reset everything

```bash
docker compose down
docker system prune -a

# Then redeploy
docker compose pull
docker compose up -d
```

## References

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Synology Docker Guide](https://www.synology.com/en-us/knowledgebase/DSM/help/Docker/docker)
