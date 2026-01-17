# Container Resource Limits

This guide explains the container resource limits configured for the QCKSTRT platform and how to tune them for your environment.

## Why Resource Limits Matter

Without resource limits, a single container can:
- Consume all host memory, causing the host to crash
- Starve other containers of CPU, degrading performance
- Create memory leaks that go undetected until system failure
- Make capacity planning impossible

## Resource Configuration

Docker Compose V2 uses the `deploy.resources` syntax to configure limits and reservations.

### Limits vs Reservations

- **Limits**: Hard ceiling - container cannot exceed these values
- **Reservations**: Minimum guaranteed resources - Docker ensures these are available

```yaml
deploy:
  resources:
    limits:
      cpus: '1.0'      # Maximum CPU cores
      memory: 512M     # Maximum memory
    reservations:
      cpus: '0.25'     # Guaranteed CPU cores
      memory: 256M     # Guaranteed memory
```

## Default Resource Allocations

### Development Stack (docker-compose.yml)

| Service | CPU Limit | Memory Limit | CPU Reserved | Memory Reserved |
|---------|-----------|--------------|--------------|-----------------|
| supabase-db | 2.0 | 1024M | 0.5 | 512M |
| supabase-auth | 0.5 | 256M | 0.1 | 128M |
| supabase-rest | 0.5 | 256M | 0.1 | 128M |
| supabase-storage | 0.5 | 256M | 0.1 | 128M |
| supabase-imgproxy | 1.0 | 512M | 0.25 | 256M |
| supabase-kong | 0.5 | 256M | 0.1 | 128M |
| supabase-studio | 0.5 | 512M | 0.1 | 256M |
| supabase-meta | 0.25 | 128M | 0.05 | 64M |
| inbucket | 0.25 | 128M | 0.05 | 64M |
| ollama | 4.0 | 4096M | 1.0 | 1024M |

**Total Reserved**: ~2.4 CPU cores, ~2.8GB memory

### Frontend Stack (apps/frontend/docker-compose.yaml)

| Service | CPU Limit | Memory Limit | CPU Reserved | Memory Reserved |
|---------|-----------|--------------|--------------|-----------------|
| nextjs | 1.0 | 512M | 0.25 | 256M |
| nginx | 0.25 | 128M | 0.05 | 64M |

**Total Reserved**: ~0.3 CPU cores, ~320MB memory

## Tuning Guidelines

### When to Increase Limits

1. **Database (supabase-db)**: Increase memory for larger datasets or complex queries
2. **Ollama**: Increase memory for larger language models (7B+ models need 8GB+)
3. **Image Proxy**: Increase CPU/memory for high-volume image processing
4. **Next.js**: Increase memory for SSR-heavy applications

### When to Decrease Limits

1. **Development machines with limited RAM**: Reduce Ollama memory if not using LLM features
2. **CI/CD environments**: Use minimal limits to run more parallel jobs

### Signs You Need More Resources

- OOM (Out of Memory) kills in `docker logs`
- Container restarts due to health check failures
- High CPU throttling visible in `docker stats`
- Slow response times during normal operation

## Monitoring Resource Usage

### Real-time Monitoring

```bash
# Watch all container resources
docker stats

# Watch specific containers
docker stats qckstrt-supabase-db qckstrt-ollama
```

### Check for OOM Kills

```bash
# Check if a container was killed due to memory
docker inspect <container_name> | grep -i oom

# View recent container events
docker events --since 24h --filter event=oom
```

### Resource Usage Over Time

For production environments, consider:
- Prometheus with cAdvisor for metrics collection
- Grafana for visualization
- Alert rules for approaching limits

## Production Considerations

### Kubernetes Migration

When deploying to Kubernetes, these limits translate to:

```yaml
resources:
  limits:
    cpu: "500m"      # 0.5 CPU cores
    memory: "256Mi"  # 256 megabytes
  requests:
    cpu: "100m"      # 0.1 CPU cores (reservation)
    memory: "128Mi"  # 128 megabytes (reservation)
```

### Scaling Strategies

1. **Vertical Scaling**: Increase limits for individual containers
2. **Horizontal Scaling**: Run multiple replicas (requires Kubernetes or Swarm)
3. **Offloading**: Use managed services (e.g., AWS RDS for PostgreSQL)

### Memory Recommendations by Workload

| Workload Type | PostgreSQL | Ollama | Next.js |
|---------------|------------|--------|---------|
| Development | 512M-1G | 2-4G | 256-512M |
| Small Production | 2-4G | 4-8G | 512M-1G |
| Medium Production | 4-8G | 8-16G | 1-2G |
| Large Production | 8-16G+ | Dedicated GPU | 2-4G |

## GPU Support for Ollama

For significantly better LLM performance, enable GPU support:

```yaml
ollama:
  deploy:
    resources:
      limits:
        cpus: '4.0'
        memory: 4096M
      reservations:
        cpus: '1.0'
        memory: 1024M
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

Requirements:
- NVIDIA GPU with CUDA support
- nvidia-docker runtime installed
- Docker configured to use nvidia runtime

## Troubleshooting

### Container Won't Start

```bash
# Check if resources are available
docker info | grep -i memory
docker info | grep -i cpu

# Reduce reservations if host has limited resources
```

### Container Keeps Restarting

```bash
# Check container logs for OOM or errors
docker logs <container_name> --tail 100

# Check exit code (137 = OOM killed)
docker inspect <container_name> --format='{{.State.ExitCode}}'
```

### Slow Performance

```bash
# Check if CPU is being throttled
docker stats --no-stream

# Look for high CPU % with low limit
# Consider increasing CPU limit
```

## Related Documentation

- [Docker Setup Guide](./docker-setup.md)
- [Supabase Setup Guide](./supabase-setup.md)
- [LLM Configuration](./llm-configuration.md)
