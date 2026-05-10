# API Documentation

Base URL: `http://localhost:4000` (dev) | `https://api.surewaka.com` (prod)

## Authentication

TODO: Document auth strategy (Better Auth / Clerk)

## Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |

### Deliveries

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/deliveries` | List deliveries (paginated) |
| POST | `/api/v1/deliveries` | Create a delivery request |
| GET | `/api/v1/deliveries/:id` | Get delivery by ID |
| PATCH | `/api/v1/deliveries/:id/status` | Update delivery status |

### Users

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/users/register` | Register a new user |
| GET | `/api/v1/users/me` | Get current user profile |

### Drivers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/drivers/nearby` | Find nearby available drivers |
| PATCH | `/api/v1/drivers/:id/availability` | Toggle driver availability |

### Carriers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/carriers` | List verified carriers |
| GET | `/api/v1/carriers/:id/quotes` | Get carrier quotes for a route |

## Response Format

All responses follow this shape:

```json
{
  "data": {},
  "error": null,
  "meta": { "page": 1, "total": 100 }
}
```

## Error Format

```json
{
  "data": null,
  "error": { "code": "VALIDATION_ERROR", "message": "Invalid email", "details": [] },
  "meta": null
}
```
