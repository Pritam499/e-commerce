# Ecommerce Application Monitoring Stack

This directory contains the complete monitoring stack for the ecommerce application using Prometheus, Loki, Grafana, and Vector.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │    │   Prometheus    │    │     Grafana     │
│   (Fastify)     │───▶│   Metrics       │───▶│  Dashboards     │
│                 │    │   Collection    │    │  & Alerts       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        ▲                      │
         ▼                        │                      │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Vector      │    │    Promtail     │    │      Loki       │
│  Log Processing │◀───│  Log Shipping   │───▶│  Log Aggregation │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Components

### Prometheus
- **Purpose**: Metrics collection and alerting
- **Port**: 9090
- **Configuration**: `prometheus.yml`
- **Alert Rules**: `alert_rules.yml`

### Loki
- **Purpose**: Log aggregation and querying
- **Port**: 3100
- **Configuration**: `loki-config.yml`

### Promtail
- **Purpose**: Log shipping from files to Loki
- **Configuration**: `promtail-config.yml`

### Vector
- **Purpose**: Advanced log processing and transformation
- **Port**: 8686
- **Configuration**: `vector.toml`

### Grafana
- **Purpose**: Visualization and dashboards
- **Port**: 3000
- **Admin Password**: admin
- **Dashboards**: Pre-configured ecommerce dashboards

### Alertmanager
- **Purpose**: Alert management and notification routing
- **Port**: 9093
- **Configuration**: `alertmanager.yml`

## Quick Start

1. **Start the monitoring stack**:
   ```bash
   docker-compose -f docker-compose.monitoring.yml up -d
   ```

2. **Access the services**:
   - **Grafana**: http://localhost:3000 (admin/admin)
   - **Prometheus**: http://localhost:9090
   - **Loki**: http://localhost:3100
   - **Alertmanager**: http://localhost:9093

3. **Verify the setup**:
   ```bash
   # Check if services are healthy
   curl http://localhost:3001/health

   # Check metrics endpoint
   curl http://localhost:3001/metrics
   ```

## Application Integration

### Metrics Collection

The application automatically exposes metrics at `/metrics` endpoint:

```bash
curl http://localhost:3001/metrics
```

Available metrics include:
- `http_request_duration_seconds` - HTTP request latency
- `http_requests_total` - Total HTTP requests by status
- `database_query_duration_seconds` - Database query performance
- `redis_operations_total` - Redis operations count
- `image_processing_duration_seconds` - Image processing time
- `rate_limit_hits_total` - Rate limiting events
- `business_operations_total` - Business logic metrics
- `application_errors_total` - Error tracking

### Health Checks

Multiple health check endpoints are available:

```bash
# Overall health
curl http://localhost:3001/health

# Detailed health with system metrics
curl http://localhost:3001/health/detailed

# Service-specific health checks
curl http://localhost:3001/health/database
curl http://localhost:3001/health/redis
curl http://localhost:3001/health/elasticsearch

# Kubernetes-style probes
curl http://localhost:3001/health/ready  # Readiness
curl http://localhost:3001/health/live   # Liveness
```

### Structured Logging

The application outputs structured JSON logs compatible with Loki:

```json
{
  "timestamp": "2024-01-28T10:00:00.000Z",
  "level": "info",
  "message": "User login successful",
  "service": "ecommerce-api",
  "hostname": "web-server-01",
  "pid": 12345,
  "environment": "production",
  "userId": "user_123",
  "method": "POST",
  "url": "/api/auth/login",
  "statusCode": 200
}
```

## Dashboards

### Pre-configured Dashboards

1. **Ecommerce Overview** (`ecommerce-overview.json`)
   - API health status
   - HTTP request metrics
   - Error rates and latency
   - Database performance
   - System resources (CPU, memory, disk)
   - Business metrics

2. **Ecommerce Logs** (`ecommerce-logs.json`)
   - Real-time log streaming
   - Error log filtering
   - Security event monitoring
   - Log level distribution
   - API request logs

### Custom Dashboards

Create additional dashboards by:

1. Accessing Grafana at http://localhost:3000
2. Clicking "Create" → "Dashboard"
3. Adding panels with Prometheus/Loki queries

Example queries:

```promql
# Request rate
rate(http_requests_total{job="ecommerce-api"}[5m])

# Error rate percentage
rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) * 100

# 95th percentile latency
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

```logql
# Recent errors
{service="ecommerce-api", level="error"} | json

# API requests with errors
{service="ecommerce-api"} | json | statusCode >= 400

# Security events
{job="ecommerce-security"} | json
```

## Alerting

### Pre-configured Alerts

- **API Down**: API becomes unreachable
- **High Error Rate**: Error rate exceeds 5%
- **High Latency**: 95th percentile latency > 2s
- **Database Down**: PostgreSQL becomes unreachable
- **High CPU/Memory Usage**: System resource thresholds
- **Slow Queries**: Database or search query performance
- **Rate Limiting**: Excessive rate limit hits

### Alertmanager Configuration

Alerts are routed based on severity:
- **Critical**: Immediate email notification
- **Warning**: Email after 30 seconds
- **Info**: Logged but no notification

## Log Processing Pipeline

1. **Application** → Structured JSON logs
2. **Promtail** → Collects logs from files and ships to Loki
3. **Vector** → Advanced processing, filtering, and enrichment
4. **Loki** → Log storage and querying
5. **Grafana** → Log visualization

### Vector Processing Features

- JSON parsing and field extraction
- Log sampling for high-volume logs
- Metadata enrichment
- Conditional routing based on log level
- Metrics generation from logs

## Monitoring Best Practices

### Metrics to Monitor

1. **Golden Signals**:
   - Latency (request duration)
   - Traffic (request rate)
   - Errors (error rate)
   - Saturation (resource utilization)

2. **Business Metrics**:
   - Order creation rate
   - User registration rate
   - Cart conversion rate
   - Revenue metrics

3. **Infrastructure Metrics**:
   - CPU, memory, disk usage
   - Network I/O
   - Database connections
   - Cache hit rates

### Log Aggregation Strategy

1. **Application Logs**: Structured JSON with context
2. **Security Logs**: Dedicated security event stream
3. **System Logs**: Infrastructure and container logs
4. **Audit Logs**: Compliance and user action tracking

### Alert Design

1. **Avoid Alert Fatigue**: Start with critical alerts only
2. **Progressive Escalation**: Warning → Critical based on duration
3. **Actionable Alerts**: Include context and suggested actions
4. **Test Alerts**: Regularly test alert configurations

## Troubleshooting

### Common Issues

1. **Metrics not appearing in Prometheus**:
   - Check if application is running and metrics endpoint is accessible
   - Verify Prometheus scrape configuration
   - Check Prometheus targets status

2. **Logs not appearing in Loki**:
   - Verify Promtail/Vector configuration
   - Check log file permissions
   - Ensure Loki is running and accessible

3. **Grafana dashboards not loading**:
   - Check datasource configurations
   - Verify Prometheus/Loki connectivity
   - Check dashboard JSON syntax

### Useful Commands

```bash
# View Prometheus targets
curl http://localhost:9090/api/v1/targets

# Query Prometheus metrics
curl "http://localhost:9090/api/v1/query?query=up"

# Query Loki logs
curl "http://localhost:3100/loki/api/v1/query?query={service=\"ecommerce-api\"}"

# View Vector metrics
curl http://localhost:8686/metrics

# Restart monitoring stack
docker-compose -f docker-compose.monitoring.yml restart
```

## Production Deployment

For production deployment:

1. **Configure external storage** for Prometheus and Loki
2. **Set up proper authentication** for Grafana
3. **Configure alerting channels** (email, Slack, PagerDuty)
4. **Set up log retention policies**
5. **Configure backup strategies**
6. **Set up monitoring for the monitoring stack itself**

## Security Considerations

1. **Network Security**: Run monitoring stack in isolated network
2. **Authentication**: Enable authentication for Grafana and Prometheus
3. **Data Privacy**: Ensure sensitive data is masked in logs
4. **Access Control**: Implement proper RBAC for dashboard access
5. **Log Encryption**: Encrypt logs at rest and in transit

## Performance Tuning

1. **Prometheus**: Adjust scrape intervals based on metric volume
2. **Loki**: Configure appropriate retention periods and chunk sizes
3. **Grafana**: Enable query caching and dashboard caching
4. **Vector**: Tune buffer sizes and processing threads

This monitoring stack provides comprehensive observability for your ecommerce application, enabling proactive issue detection and performance optimization.