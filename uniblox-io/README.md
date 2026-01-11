# E-commerce Store

A full-stack e-commerce application with cart, checkout, and intelligent discount code functionality.

> 📖 For detailed system architecture and implementation details, see [system.md](./system.md)

## Features

### Store APIs

- Add items to cart
- View cart items
- Update cart item quantities
- Remove items from cart
- Checkout with discount code support
- View order history
- Preview discount before applying

### Admin APIs

- Generate discount codes (when conditions are met)
- View statistics (items purchased, total amount, discount codes, total discount)

### Discount System

- **Automatic Generation**: Discount codes are generated automatically when conditions are met
- **Nth Order Requirement**: Every 3rd order (configurable via `NTH_ORDER_DISCOUNT` env var) per customer
- **Purchase Threshold**: Customer must have purchased at least 5 items and $300 total across all orders
- **Single Use**: Each discount code can be used only once
- **10% Discount**: Applies to the entire order
- **Per-Customer**: Each customer has their own order count and discount eligibility
- **Order Numbering**: Each customer's orders are numbered starting from 1 (Order #1, Order #2, etc.)

## Technology Stack

- **Backend**: Fastify (TypeScript)
- **Database**: PostgreSQL with Drizzle ORM
- **Frontend**: Next.js (TypeScript)
- **Validation**: Zod schemas
- **ID Generation**: CUID2 (string-based IDs)
- **Containerization**: Docker

## Prerequisites

- Node.js 20+
- pnpm
- Docker and Docker Compose

## Environment Files Quick Reference

### Backend: `uniblox-io/backend/.env.development`

Copy from `.env.example` or create with:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/ecommerce
PORT=3001
NTH_ORDER_DISCOUNT=3
```

### Frontend: `uniblox-io/frontend/.env.local`

Copy from `.env.example` or create with:

```env
HOST=localhost
PORT=3000
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```

> 💡 **Tip**: Copy `.env.example` to `.env.development` (backend) or `.env.local or .env` (frontend) before running setup commands.

## Quick Start

### 1. Backend Setup

#### Step 1: Install Dependencies

```bash
cd uniblox-io/backend
pnpm i
```

#### Step 2: Create Environment File

Create `.env.development` file in the `backend` directory:

**Option 1: Copy from .env.example (Recommended)**

```bash
cd uniblox-io/backend
cp .env.example .env.development
```

**Option 2: Using command line**

```bash
cd uniblox-io/backend
cat > .env.development << EOF
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/ecommerce
PORT=3001
NTH_ORDER_DISCOUNT=3
EOF
```

**Option 3: Manually create the file**

Create a file named `.env.development` in `uniblox-io/backend/` and paste the following:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/ecommerce
PORT=3001
NTH_ORDER_DISCOUNT=3
```

**What each variable does:**

- `DATABASE_URL`: PostgreSQL connection string (port 5435 matches Docker compose)
- `PORT`: Backend server port (default: 3001)
- `NTH_ORDER_DISCOUNT`: Number of orders required before discount code generation (default: 3)

#### Step 3: Start Docker Containers

```bash
cd uniblox-io/backend
docker compose up -d
```

This starts PostgreSQL on port `5435`.

#### Step 4: Run Database Migrations

```bash
cd uniblox-io/backend
pnpm with-dev-env pnpm db:push
```

This creates all database tables with the current schema.

#### Step 5: Seed Database

```bash
cd uniblox-io/backend
pnpm with-dev-env pnpm seed
```

This seeds:

- 4 product categories
- 20 products (5 per category)

#### Step 6: Start Development Server

```bash
cd uniblox-io/backend
pnpm dev
```

The backend API will be available at `http://localhost:3001`

### 2. Frontend Setup

#### Step 1: Install Dependencies

```bash
cd uniblox-io/frontend
pnpm i
```

#### Step 2: Create Environment File

Create `.env.local` file in the `frontend` directory:

**Option 1: Copy from .env.example (Recommended)**

```bash
cd uniblox-io/frontend
cp .env.example .env.local
```

**Option 2: Using command line**

```bash
cd uniblox-io/frontend
cat > .env.local << EOF
HOST=localhost
PORT=3000
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
EOF
```

**Option 3: Manually create the file**

Create a file named `.env.local` in `uniblox-io/frontend/` and paste the following:

```env
HOST=localhost
PORT=3000
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**What each variable does:**

- `HOST`: Frontend server host (default: localhost)
- `PORT`: Frontend server port (default: 3000)
- `API_URL`: Backend API URL (server-side usage)
- `NEXT_PUBLIC_API_URL`: Backend API URL (must start with `NEXT_PUBLIC_` to be accessible in browser)

> **Note**: If you don't create this file, the frontend will use the default value `http://localhost:3001`

#### Step 3: Start Development Server

```bash
cd uniblox-io/frontend
pnpm dev
```

The frontend will be available at `http://localhost:3000`

## Complete Setup Workflow

```bash
# Backend
cd uniblox-io/backend
pnpm i
# Create .env.development file (see Step 2 above)
docker compose up -d
pnpm with-dev-env pnpm db:push
pnpm with-dev-env pnpm seed
pnpm dev

# Frontend (in a new terminal)
cd uniblox-io/frontend
pnpm i
# Create .env.local file (see Step 2 above)
pnpm dev
```

## API Endpoints

### Store APIs

#### Add Item to Cart

```http
POST /api/cart?customerId={uuid}
Content-Type: application/json

{
  "productId": "string",
  "quantity": 1
}
```

#### Get Cart Items

```http
GET /api/cart?customerId={uuid}
```

#### Update Cart Item

```http
PUT /api/cart/{cartItemId}?customerId={uuid}
Content-Type: application/json

{
  "quantity": 2
}
```

#### Remove Cart Item

```http
DELETE /api/cart/{cartItemId}?customerId={uuid}
```

#### Checkout

```http
POST /api/checkout
Content-Type: application/json

{
  "customerId": "uuid",
  "discountCode": "ABC12345" // optional
}
```

#### Get All Orders

```http
GET /api/orders?customerId={uuid}
```

#### Get Order by ID

```http
GET /api/orders/{orderId}
```

#### Preview Discount

```http
POST /api/cart/preview-discount
Content-Type: application/json

{
  "customerId": "uuid",
  "discountCode": "ABC12345",
  "subtotal": 100.00
}
```

#### Check Discount Eligibility

```http
GET /api/discounts/eligible?customerId={uuid}
```

### Admin APIs

#### Generate Discount Code

```http
POST /api/admin/discounts/generate
Content-Type: application/json

{
  "customerId": "uuid"
}
```

**Response** (if conditions met):

```json
{
  "success": true,
  "data": {
    "id": "string",
    "code": "ABC12345",
    "discountPercentage": 10,
    "isUsed": false,
    "isAvailable": true
  }
}
```

**Error** (if conditions not met):

```json
{
  "success": false,
  "error": "You have placed 2 order(s). Complete 1 more order(s) to reach your 3rd order..."
}
```

#### Get Statistics

```http
GET /api/admin/stats
```

**Response**:

```json
{
  "success": true,
  "data": {
    "totalItemsPurchased": 5,
    "totalPurchaseAmount": 300.0,
    "discountCodes": [
      {
        "id": "string",
        "code": "ABC12345",
        "discountPercentage": 10,
        "isUsed": false,
        "isAvailable": true,
        "orderNumberGenerated": 3,
        "createdAt": "2024-01-01T00:00:00Z"
      }
    ],
    "totalDiscountAmount": 50.0
  }
}
```

## Database Schema

All tables use **string-based IDs** (CUID2) instead of serial integers.

- **categories**: id (string), name, description, created_at, updated_at
- **products**: id (string), category_id (string), name, description, price, stock, image, created_at, updated_at
- **customers**: id (string, UUID), name, email (unique), created_at, updated_at
- **cart_items**: id (string), customer_id (string), product_id (string), quantity, created_at, updated_at
- **orders**: id (string), customer_id (string), discount_code_id (string, nullable), subtotal, discount_amount, total, status, created_at, updated_at
- **order_items**: id (string), order_id (string), product_id (string), quantity, price, created_at, updated_at
- **discount_codes**: id (string), code (unique), discount_percentage, is_used, is_available, customer_id (string, nullable), order_number_generated, created_at, updated_at

## Discount Logic

### Automatic Generation Conditions

A discount code is automatically generated when **ALL** of the following conditions are met:

1. **Nth Order**: Customer has placed at least 3 orders (configurable via `NTH_ORDER_DISCOUNT`)
2. **Purchase Stats**: Customer has purchased at least 5 items and $300 total across all orders
3. **No Unused Coupon**: Customer doesn't have an unused coupon already
4. **Previous Coupon Used**: If customer has previous coupons, at least one must be used
5. **Order Gap**: At least 3 orders have been placed since the last coupon was generated

### Manual Generation

Admin can manually generate a discount code via API. The same conditions apply, with detailed error messages if conditions aren't met.

### Discount Application

- 10% discount applies to the entire order subtotal
- Each code can be used only once
- Code is marked as used and unavailable after checkout
- New codes are generated automatically when conditions are met again

### Per-Customer Logic

- Each customer has their own order count (starting from 1)
- Order numbers are per-customer: Customer A's Order #1, Order #2, etc.
- Discount eligibility is tracked per customer
- Purchase stats are calculated per customer

## Environment Variables

### Backend (.env.development)

**Quick Setup:**

```bash
cd uniblox-io/backend
cp .env.example .env.development
```

**Or create manually** `uniblox-io/backend/.env.development`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/ecommerce
PORT=3001
NTH_ORDER_DISCOUNT=3
```

**Variable Descriptions:**

- `DATABASE_URL`: PostgreSQL connection string (port 5435 matches Docker compose)
- `PORT`: Backend server port (default: 3001)
- `NTH_ORDER_DISCOUNT`: Value of n for nth order discount (default: 3)

### Frontend (.env.local)

**Quick Setup:**

```bash
cd uniblox-io/frontend
cp .env.example .env.local
```

**Or create manually** `uniblox-io/frontend/.env.local`:

```env
HOST=localhost
PORT=3000
API_URL=http://localhost:3001
NEXT_PUBLIC_API_URL=http://localhost:3001
```

**Variable Descriptions:**

- `HOST`: Frontend server host (default: localhost)
- `PORT`: Frontend server port (default: 3000)
- `API_URL`: Backend API URL (server-side usage)
- `NEXT_PUBLIC_API_URL`: Backend API URL (must start with `NEXT_PUBLIC_` to be accessible in browser)

> **Note**: Next.js uses `.env.local` for local development. If you don't create this file, the frontend will use the default value `http://localhost:3001`

## Development Workflow

1. **Start Docker**: `docker compose up -d`
2. **Run Migrations**: `pnpm with-dev-env pnpm db:push`
3. **Seed Data**: `pnpm with-dev-env pnpm seed`
4. **Start Backend**: `pnpm dev`
5. **Start Frontend**: `cd ../frontend && pnpm dev`

## Project Structure

```
uniblox-io/
├── backend/
│   ├── src/
│   │   ├── drizzle/
│   │   │   ├── schema.ts          # Database schema (string IDs)
│   │   │   ├── relations.ts       # Table relationships
│   │   │   └── migrations/        # Migration files
│   │   ├── seed.ts                # Seed data (categories & products)
│   │   ├── lib/
│   │   │   └── db/                # Database connection
│   │   ├── modules/               # Business logic modules
│   │   │   ├── cart/
│   │   │   ├── order/
│   │   │   ├── discount/
│   │   │   └── admin/
│   │   ├── routes/                # API routes
│   │   └── index.ts               # Entry point
│   ├── .env.development           # Environment variables
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── package.json
└── frontend/
    ├── src/
    │   ├── app/                   # Next.js pages
    │   ├── components/           # React components
    │   └── lib/                  # API client
    └── package.json
```

## Key Features

- ✅ String-based IDs (CUID2) for all tables
- ✅ Per-customer order numbering (Order #1, #2, etc.)
- ✅ Automatic discount code generation
- ✅ Purchase threshold validation (5 items, $300)
- ✅ Single-use discount codes
- ✅ Real-time cart updates
- ✅ Order history tracking
- ✅ Admin statistics dashboard

## Notes

- All IDs are string-based (CUID2), not integers
- Order numbers are per-customer, not system-wide
- Discount codes are generated automatically after checkout if conditions are met
- Admin can manually generate codes if conditions are satisfied
- All API responses follow a consistent format with `success` and `data`/`error` fields

## License

ISC
