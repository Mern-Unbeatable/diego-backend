# 🎓 DIEGO LMS — Backend API

> Multi-tenant Learning Management System backend built with **Express.js 5**, **Prisma (PostgreSQL)**, **Redis**, **Stripe**, and **JWT auth**. Supports SCORM/AICC/xAPI courses, licensing, company (B2B) purchases, certificates, quizzes, and more.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Express](https://img.shields.io/badge/express-5.x-black)
![Prisma](https://img.shields.io/badge/prisma-5.x-2D3748)
![License](https://img.shields.io/badge/license-ISC-blue)

---

## 📚 Table of Contents

1. [Overview](#-overview)
2. [Tech Stack](#-tech-stack)
3. [Architecture Concepts](#-architecture-concepts)
4. [Project Structure](#-project-structure)
5. [Quick Start](#-quick-start)
6. [Environment Variables](#-environment-variables)
7. [Available Scripts](#-available-scripts)
8. [API Conventions](#-api-conventions)
9. [Modules / Feature Map](#-modules--feature-map)
10. [Authentication & Authorization](#-authentication--authorization)
11. [Postman Collection](#-postman-collection)
12. [Further Documentation](#-further-documentation)

---

## 🧭 Overview

DIEGO is a multi-tenant LMS platform. A single backend instance serves multiple **Tenants** (white-labeled platforms), each of which can have their own courses, licensees, employees, and branding (subdomain / custom domain / logo / primary color).

Core domains modeled in the system:

- **Users & Auth** — multi-level RBAC (`PRIVATE_USER`, `COMPANY_ADMIN`, `COMPANY_EMPLOYEE`, `LICENSEE`, `PLATFORM_ADMIN`, `TUTOR`, `TEACHER`)
- **Courses & Lessons** — SCORM, AICC, xAPI, PDF, video, quizzes, checklists, LTI, slide decks
- **Enrollments & Progress** — lesson progress, SCORM session tracking, anti-cheat logging, auto-completion → certificate generation
- **Commerce** — single course purchase, packages, licenses, company bulk purchases, coupons, Stripe payments, invoices
- **Licensing** — licensees run their own branded course catalog under a tenant, earn a revenue share (`LicenseeIncome`)
- **Certificates** — auto-issued PDF certificates with QR code + timestamp proof
- **Support & Notifications** — support tickets, in-app notifications, severity alerts
- **i18n** — most user-facing content (titles, descriptions, messages) stored as `Json` to support `it`, `en`, `fr`, `zh`

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 5 |
| ORM | Prisma 5 (`@prisma/client`, `@prisma/adapter-pg`) |
| Database | PostgreSQL |
| Cache / Sessions | Redis |
| Auth | JWT (`jsonwebtoken`), `bcrypt`/`bcryptjs` |
| Validation | Zod 4 |
| Payments | Stripe |
| File storage | Cloudinary, Multer |
| PDF generation | `html-pdf-node` (certificates) |
| Email | Nodemailer |
| Scheduling | `node-cron` |
| Logging | Winston, Morgan |
| Monitoring | `swagger-stats` |
| Testing | Vitest, Supertest |
| Package manager | pnpm 10 |

---

## 🏗 Architecture Concepts

### Multi-tenancy
Almost every top-level entity (`Course`, `License`, `Payment`, `Package`, `Quiz`, `Coupon`, `Notification`, `Alert`, `SupportTicket`, `ArchiveSubscription`, `Certificate`, `Review`) carries an optional `tenantId`. Requests from `LICENSEE` and tenant-scoped users are automatically filtered by tenant via a `tenantGuard` middleware.

### Role-based access (`UserLevel`)
| Level | Description |
|---|---|
| `PRIVATE_USER` | Individual learner |
| `COMPANY_ADMIN` / `COMPANY_EMPLOYEE` | B2B company accounts |
| `LICENSEE` | Runs a branded catalog under a tenant, earns revenue share |
| `PLATFORM_ADMIN` | Full cross-tenant access |
| `TUTOR` / `TEACHER` | Assigned to specific courses |

### Enrollment lifecycle
`NOT_STARTED → IN_PROGRESS → COMPLETED` (or `EXPIRED` / `SUSPENDED`), driven by `LessonProgress` / `ScormSession` records. When all required lessons are completed, `enrollmentService.checkAndUpdateEnrollmentStatus()` auto-marks the enrollment `COMPLETED` and triggers async certificate generation.

### Commerce model
A `Payment` is the central commerce record — it can back a single-course `Enrollment`, a `License`, a `PackagePurchase`, a `CompanyCoursePurchase`, or an `ArchiveSubscription`, and produces an `Invoice`. Renewals are tracked separately (`CourseRenewal`, `LicenseRenewal`, `CompanyCoursePurchaseRenewal`) so pricing history isn't lost.

### i18n content
Fields like `courseTitle`, `description`, `name`, `message` are stored as Prisma `Json` — typically `{ "it": "...", "en": "...", "fr": "...", "zh": "..." }`. Frontend clients should resolve these using the current `SupportedLocale` and the `i18nMiddleware`.

---

## 📁 Project Structure

```
diego-backend/
├── prisma/
│   ├── migrations/
│   └── schema.prisma
├── src/
│   ├── config/                # db, logger, env config
│   ├── features/
│   │   ├── assignCourse/
│   │   ├── auth/
│   │   ├── certificate/
│   │   ├── course/
│   │   ├── coursePurchase/
│   │   ├── employee/
│   │   ├── enrollment/        # ✅ fully documented — see API docs
│   │   ├── lesson/
│   │   ├── license/
│   │   ├── licenseIncome/
│   │   ├── licensePlan/
│   │   ├── notification/
│   │   ├── package/
│   │   ├── payment/
│   │   ├── quiz/
│   │   ├── reviews/
│   │   ├── supportTicket/
│   │   └── user/
│   │       └── each feature/  # {feature}.controller.js, {feature}.service.js,
│   │                          # {feature}.routes.js, {feature}.validation.js
│   ├── generated/prisma/      # Prisma client output
│   ├── routes/                # route aggregator
│   ├── seeds/                 # admin.seeder.js, package.seeder.js
│   ├── shared/
│   │   └── globals/
│   │       ├── decorators/    # catchAsync
│   │       └── helpers/       # auth-middleware, tenant.middleware, i18n.middleware, response.handler
│   ├── app.js
│   ├── app.test.js
│   ├── bootstrap.js
│   ├── routes.js
│   └── server.js
├── uploads/
├── .env.dev
└── package.json
```

Every feature module follows the **same 4-file pattern**: `*.routes.js → *.controller.js → *.service.js`, validated by `*.validation.js` (Zod). This means once a frontend dev understands the Enrollment module (fully documented below), every other module behaves the same way structurally.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database
- Redis
- pnpm (`npm install -g pnpm`)

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd diego-backend

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
cp .env.dev .env
# Edit .env with your credentials

# 4. Generate Prisma Client
pnpm run prisma:generate

# 5. Run database migrations
pnpm run prisma:migrate

# 6. Seed the database
pnpm run seeds:admin      # Create admin account
pnpm run seeds:package    # Create subscription packages

# 7. Start development server
pnpm run dev
```

Server runs at **`http://localhost:5000/api/v1`**

---

## 🔐 Environment Variables

Create a `.env` file (copy from `.env.dev`) with at least:

```env
# Server
NODE_ENV=development
PORT=5000
API_PREFIX=/api/v1

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/diego_lms

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your_refresh_secret

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Cloudinary
CLOUDINARY_CLOUD_NAME=xxx
CLOUDINARY_API_KEY=xxx
CLOUDINARY_API_SECRET=xxx

# Email (Nodemailer)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=xxx
SMTP_PASS=xxx

# Frontend URL (used in emails / access links)
FRONTEND_URL=http://localhost:3000
```

> ⚠️ Ask your backend lead to confirm the exact variable names against `.env.dev` — this list is inferred from the dependency list (Stripe, Cloudinary, Redis, Nodemailer, JWT) and should be verified.

---

## 📜 Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Start development server with nodemon auto-reload |
| `pnpm start` | Start production server (`node src/bootstrap.js`) |
| `pnpm run build` | Generate Prisma Client |
| `pnpm run postinstall` | Auto-runs `prisma generate` after install |
| `pnpm run prisma:generate` | Generate Prisma Client |
| `pnpm run prisma:migrate` | Run database migrations (dev) |
| `pnpm run prisma:deploy` | Deploy migrations (production) |
| `pnpm run prisma:studio` | Open Prisma Studio GUI |
| `pnpm run seeds:admin` | Seed admin user |
| `pnpm run seeds:package` | Seed subscription packages |
| `pnpm run lint` | Run ESLint |
| `pnpm run lint:fix` | Auto-fix ESLint issues |
| `pnpm run format` | Format code with Prettier |
| `pnpm run test` | Run tests with Vitest |
| `pnpm run test:watch` | Run tests in watch mode |
| `pnpm run test:coverage` | Run tests with coverage report |

---

## 🔌 API Conventions

- **Base URL:** `http://localhost:5000/api/v1` (dev)
- **Auth:** `Authorization: Bearer <accessToken>` header on all protected routes
- **Content-Type:** `application/json`
- **Response envelope** (via `ResponseHandler`):

```json
{
  "success": true,
  "message": "Human readable message",
  "data": { }
}
```

Error responses follow the same envelope with `"success": false` and an `"error"` or `"message"` field describing what went wrong (validation errors surface Zod's issue array).

- **Pagination** (list endpoints): query params `page` (default 1), `limit` (default 20, max 100), returns:

```json
{
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 },
  "items": [ ]
}
```

- **Multi-tenant scoping:** `PLATFORM_ADMIN` sees everything (optionally filter with `?tenantId=`); `LICENSEE` and tenant-bound users are auto-scoped to their own `tenantId` — no need to pass it manually.
- **i18n fields:** any field typed `Json` in the schema (titles, descriptions, messages) may come back as an object keyed by locale (`{ "en": "...", "it": "..." }`) rather than a plain string.

---

## 🗺 Modules / Feature Map

| Module | Status | Notes |
|---|---|---|
| **enrollment** | ✅ Fully documented | See `API_DOCUMENTATION.md` + Postman |
| **course** | 🟡 Partial (sample response only) | List endpoint shape known from sample; CRUD endpoints to confirm |
| **auth** | ⬜ Pending source | Login/register/refresh/OTP endpoints — send `auth.routes.js` |
| **certificate** | ⬜ Pending source | `certificateService.autoGenerateOnCompletion` confirmed to exist |
| **coursePurchase** | ⬜ Pending source | |
| **employee** | ⬜ Pending source | |
| **lesson** | ⬜ Pending source | |
| **license** | ⬜ Pending source | |
| **licenseIncome** | ⬜ Pending source | |
| **licensePlan** | ⬜ Pending source | |
| **notification** | ⬜ Pending source | |
| **package** | ⬜ Pending source | |
| **payment** | ⬜ Pending source | Stripe-backed |
| **quiz** | ⬜ Pending source | |
| **reviews** | ⬜ Pending source | |
| **supportTicket** | ⬜ Pending source | |
| **user** | ⬜ Pending source | |
| **assignCourse** | ⬜ Pending source | |

> Send the `.controller.js` / `.routes.js` / `.validation.js` for any ⬜ module and it'll be added to `API_DOCUMENTATION.md` and the Postman collection in the exact same format as Enrollment.

---

## 🔑 Authentication & Authorization

All routes in `enrollment.routes.js` (and, by convention, every other feature) run through two global middlewares:

```js
router.use(authMiddleware.protect);   // validates JWT, attaches req.user
router.use(i18nMiddleware);           // resolves locale for Json fields
```

Elevated routes add:

```js
const adminGuard = authMiddleware.authorize('PLATFORM_ADMIN', 'LICENSEE');
router.use(adminGuard, tenantGuard);
```

**For the frontend:**
1. Obtain `accessToken` from the (pending) `auth` module's login endpoint.
2. Send it as `Authorization: Bearer <accessToken>` on every request.
3. A `403`/`401` on a `licensee/*` or admin route usually means the logged-in user's `level` isn't `PLATFORM_ADMIN` or `LICENSEE`, or their `tenantId` doesn't resolve.

---

## 📮 Postman Collection

Import `DIEGO_LMS.postman_collection.json` into Postman. It includes:

- Collection-level `{{baseUrl}}` and `{{accessToken}}` variables
- A **Enrollment** folder with all 14 endpoints, pre-filled example bodies matching the Zod schemas, and inline descriptions
- A **Courses** folder with the confirmed `GET /courses` list endpoint (from the sample response you shared)
- Placeholder folders for every other module, ready to fill in once source files are shared

Set `{{baseUrl}}` to `http://localhost:5000/api/v1` and `{{accessToken}}` after logging in.

---

## 📖 Further Documentation

- [`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md) — full endpoint-by-endpoint reference (request/response/auth/errors)
- `prisma/schema.prisma` — source of truth for all data shapes
- Prisma Studio (`pnpm run prisma:studio`) — browse live data during integration testing