# API Rate Limiting & Security Gateway

A lightweight, self-contained API Gateway built with Node.js/Express that demonstrates the core patterns of a cloud API Gateway (like AWS API Gateway / Azure API Management) without needing a cloud account:

- **Token-based authentication** — JWT issued on login, verified on every protected request
- **Rate limiting** — per-user, per-role request throttling using `express-rate-limit`
- **Request logging** — every request logged to console and `logs/access.log` (stand-in for CloudWatch Logs / ELK ingestion)
- **Access policies** — role-based route allow-lists defined declaratively in `policies.json`

## Architecture

```
Client
  │
  ▼
POST /auth/login  →  issues JWT (role embedded in token)
  │
  ▼
GET /gateway/*
  │
  ├─► authenticateToken   (verifies JWT)
  ├─► enforceAccessPolicy (checks policies.json for role → route permission)
  ├─► dynamicRateLimiter  (role-based request quota)
  ▼
Downstream "microservice" route (orders / users / reports)
```

This mirrors a real cloud deployment where API Gateway sits in front of Lambda functions or microservices, using Cognito/JWT authorizers, usage plans (rate limiting), and resource policies (access control).

## Running locally

```bash
npm install
cp .env.example .env    # edit JWT_SECRET if you like
npm start
```

Server runs on `http://localhost:4000`.

## Try it

```bash
# 1. Log in as admin
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# copy the returned token, then:
curl http://localhost:4000/gateway/reports \
  -H "Authorization: Bearer <TOKEN>"

# Log in as a regular user (alice/alice123) and try /gateway/users — it will be blocked (403)
# because policies.json only allows "user" role to hit /gateway/orders.
```

Hit any protected route more than the allowed number of times within the rate-limit window and you'll get a `429 Too Many Requests`.

## Mapping to real cloud services

| This project              | Real cloud equivalent                         |
|----------------------------|------------------------------------------------|
| Express gateway            | AWS API Gateway / Azure API Management         |
| JWT auth middleware        | Cognito / Azure AD authorizer                  |
| `policies.json`            | IAM resource policies / usage plans            |
| `express-rate-limit`       | API Gateway throttling / usage plan quotas     |
| `logs/access.log`          | CloudWatch Logs / ELK log ingestion            |
| `/gateway/*` route handlers| Lambda functions / backend microservices       |

## Tech stack
Node.js, Express, jsonwebtoken, express-rate-limit, morgan
