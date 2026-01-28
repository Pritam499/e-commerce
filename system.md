# E-commerce Store System Design & Implementation

> 📖 This document provides detailed system architecture, implementation details, and business logic. For quick setup instructions, see [README.md](./README.md)

## System Architecture

### Technology Stack

- **Backend**: Fastify (TypeScript)
- **Database**: PostgreSQL with Drizzle ORM
- **Validation**: Zod schemas
- **Frontend**: Next.js (TypeScript)
- **ID Generation**: CUID2 (@paralleldrive/cuid2) - String-based IDs
- **Containerization**: Docker

### High-Level Architecture

```
┌─────────────┐
│   Next.js   │  Frontend (UI)
│   Frontend  │
└──────┬──────┘
       │ HTTP/REST
       ▼
┌─────────────────────────────────┐
│      Fastify API Server         │
│  ┌───────────────────────────┐  │
│  │   Routes (src/routes/)    │  │
│  │  - /api/cart              │  │
│  │  - /api/checkout          │  │
│  │  - /api/orders            │  │
│  │  - /api/admin/discounts   │  │
│  │  - /api/admin/stats       │  │
│  └───────────┬───────────────┘  │
│              │                   │
│  ┌───────────▼───────────────┐  │
│  │  Modules (src/modules/)   │  │
│  │  - cart/                  │  │
│  │  - order/                 │  │
│  │  - discount/              │  │
│  │  - admin/                 │  │
│  └───────────┬───────────────┘  │
│              │                   │
│  ┌───────────▼───────────────┐  │
│  │  Libs (src/lib/)          │  │
│  │  - db/                    │  │
│  └───────────┬───────────────┘  │
└──────────────┼───────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│      PostgreSQL Database        │
│  ┌───────────────────────────┐  │
│  │  Drizzle Schema            │  │
│  │  - categories (string id) │  │
│  │  - products (string id)   │  │
│  │  - customers (UUID)        │  │
│  │  - cart_items (string id)  │  │
│  │  - orders (string id)      │  │
│  │  - order_items (string id) │  │
│  │  - discount_codes (string) │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## Functional Requirements

### Customer APIs

#### 1. Add to Cart (`POST /api/cart`)

- Add product to customer's cart
- Update quantity if item already exists
- Validate product exists and is available
- Auto-create customer if doesn't exist
- Uses string-based product IDs

#### 2. Get Cart Items (`GET /api/cart`)

- Retrieve all cart items for a customer
- Include product details (name, price, image)
- Calculate total cart value

#### 3. Update Cart Item (`PUT /api/cart/:cartItemId`)

- Update quantity of a cart item
- Remove item if quantity is 0
- Validate stock availability

#### 4. Remove Cart Item (`DELETE /api/cart/:cartItemId`)

- Remove item from cart completely

#### 5. Checkout (`POST /api/checkout`)

- Process order from cart
- Validate discount code if provided
- Calculate totals (subtotal, discount, final amount)
- Create order and order items
- Update product stock
- Clear cart after successful checkout
- **Trigger automatic discount code generation** if conditions are met
- Assign per-customer order number

#### 6. Get Orders (`GET /api/orders`)

- Retrieve all orders for a customer
- Include order items with product details
- Display per-customer order numbers (Order #1, #2, etc.)

#### 7. Get Order by ID (`GET /api/orders/:id`)

- Retrieve single order details
- Include all order items and discount code info

#### 8. Preview Discount (`POST /api/cart/preview-discount`)

- Calculate discount amount without applying
- Validate discount code
- Return preview of savings

#### 9. Check Discount Eligibility (`GET /api/discounts/eligible`)

- Check if customer is eligible for discount on next order
- Returns eligibility status and requirements

### Admin APIs

#### 1. Generate Discount Code (`POST /api/admin/discounts/generate`)

**4-Step Condition Checking:**

1. **Check for unused coupon**: If customer has unused coupon, return it
2. **Check nth order**: If customer hasn't completed nth order, throw error with order count
3. **Check purchase stats**: If customer hasn't reached 5 items and $300, throw error with current stats
4. **Check previous coupon usage**: If previous coupon exists but not used, throw error

**If all conditions met**: Generate unique 8-character discount code (10% off)

#### 2. Get Statistics (`GET /api/admin/stats`)

- Total items purchased (hardcoded: 5)
- Total purchase amount (hardcoded: $300)
- List of all discount codes with status
- Total discount amount given

## Discount Logic

### Automatic Generation

Discount codes are **automatically generated** after checkout when **ALL** conditions are met:

1. **Nth Order Requirement**: Customer has placed at least `N` orders (default: 3, configurable via `NTH_ORDER_DISCOUNT`)
2. **Purchase Stats Threshold**: 
   - Customer has purchased at least **5 items** total
   - Customer has spent at least **$300** total
3. **No Unused Coupon**: Customer doesn't have an unused coupon already
4. **Previous Coupon Used**: If customer has previous coupons, at least one must be used
5. **Order Gap**: At least `N` orders have been placed since the last coupon was generated

### Manual Generation

Admin can manually generate codes via API. Same conditions apply with detailed error messages:

- **Error if not nth order**: "You have placed X order(s). Complete Y more order(s) to reach your Nth order..."
- **Error if purchase stats not met**: "Reach purchase threshold first. You need X more item(s) and $Y more..."
- **Error if unused coupon exists**: "You have an unused coupon (CODE). Use it on your next order..."

### Discount Application

- **10% discount** applies to entire order subtotal
- Each code can be used **only once**
- Code is marked as `isUsed: true` and `isAvailable: false` after checkout
- New codes are generated automatically when conditions are met again

### Per-Customer Logic

- **Order Counting**: Each customer has their own order count (not system-wide)
- **Order Numbering**: Each customer's orders are numbered starting from 1:
  - Customer A: Order #1, Order #2, Order #3
  - Customer B: Order #1, Order #2, Order #3
- **Discount Eligibility**: Tracked per customer
- **Purchase Stats**: Calculated per customer across all their orders

### Discount Code Generation Flow

```
Order Created → Check Conditions
                ↓
    ┌───────────┴───────────┐
    │                         │
    ▼                         ▼
Check Order Count      Check Purchase Stats
(>= 3 orders)          (>= 5 items, >= $300)
    │                         │
    └───────────┬───────────┘
                │
                ▼
    Check for Unused Coupon
    (if exists, don't generate)
                │
                ▼
    Check Order Gap
    (>= 3 orders since last coupon)
                │
                ▼
    Check Previous Coupon Used
    (if coupons exist, must be used)
                │
                ▼
    All Conditions Met?
                │
        ┌───────┴───────┐
        │               │
        YES             NO
        │               │
        ▼               ▼
Generate Code      Return Silently
(8-char unique)    (no error)
```

## Database Schema

### ID Strategy

**All tables use string-based IDs** (CUID2) instead of serial integers:

- **categories**: `id` (varchar 128, CUID2)
- **products**: `id` (varchar 128, CUID2), `category_id` (varchar 128)
- **customers**: `id` (varchar 36, UUID)
- **cart_items**: `id` (varchar 128, CUID2), `customer_id` (varchar 36), `product_id` (varchar 128)
- **orders**: `id` (varchar 128, CUID2), `customer_id` (varchar 36), `discount_code_id` (varchar 128, nullable)
- **order_items**: `id` (varchar 128, CUID2), `order_id` (varchar 128), `product_id` (varchar 128)
- **discount_codes**: `id` (varchar 128, CUID2), `customer_id` (varchar 36, nullable)

### Tables

#### categories
- `id`: varchar(128) PRIMARY KEY (CUID2)
- `name`: varchar(255) NOT NULL
- `description`: text
- `created_at`: timestamp
- `updated_at`: timestamp

#### products
- `id`: varchar(128) PRIMARY KEY (CUID2)
- `category_id`: varchar(128) REFERENCES categories(id)
- `name`: varchar(255) NOT NULL
- `description`: text
- `price`: decimal(10, 2) NOT NULL
- `stock`: integer DEFAULT 0
- `image`: text
- `created_at`: timestamp
- `updated_at`: timestamp

#### customers
- `id`: varchar(36) PRIMARY KEY (UUID)
- `name`: varchar(255) NOT NULL
- `email`: varchar(255) NOT NULL UNIQUE
- `created_at`: timestamp
- `updated_at`: timestamp

#### cart_items
- `id`: varchar(128) PRIMARY KEY (CUID2)
- `customer_id`: varchar(36) REFERENCES customers(id)
- `product_id`: varchar(128) REFERENCES products(id)
- `quantity`: integer DEFAULT 1
- `created_at`: timestamp
- `updated_at`: timestamp

#### orders
- `id`: varchar(128) PRIMARY KEY (CUID2)
- `customer_id`: varchar(36) REFERENCES customers(id)
- `discount_code_id`: varchar(128) REFERENCES discount_codes(id) NULLABLE
- `subtotal`: decimal(10, 2) NOT NULL
- `discount_amount`: decimal(10, 2) DEFAULT 0
- `total`: decimal(10, 2) NOT NULL
- `status`: enum('pending', 'completed', 'cancelled') DEFAULT 'pending'
- `created_at`: timestamp
- `updated_at`: timestamp

#### order_items
- `id`: varchar(128) PRIMARY KEY (CUID2)
- `order_id`: varchar(128) REFERENCES orders(id)
- `product_id`: varchar(128) REFERENCES products(id)
- `quantity`: integer NOT NULL
- `price`: decimal(10, 2) NOT NULL
- `created_at`: timestamp
- `updated_at`: timestamp

#### discount_codes
- `id`: varchar(128) PRIMARY KEY (CUID2)
- `code`: varchar(50) NOT NULL UNIQUE
- `discount_percentage`: integer DEFAULT 10
- `is_used`: boolean DEFAULT false
- `is_available`: boolean DEFAULT false
- `customer_id`: varchar(36) REFERENCES customers(id) NULLABLE
- `order_number_generated`: integer (order count when code was generated)
- `created_at`: timestamp
- `updated_at`: timestamp

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── drizzle/
│   │   │   ├── schema.ts          # All table definitions (string IDs)
│   │   │   ├── relations.ts       # Table relationships
│   │   │   └── migrations/        # Migration files
│   │   ├── seed.ts                # Seed data (categories & products)
│   │   ├── lib/
│   │   │   └── db/
│   │   │       └── index.ts       # Drizzle instance with relations
│   │   ├── modules/               # Business logic modules
│   │   │   ├── cart/
│   │   │   │   ├── schema.ts      # Zod schemas
│   │   │   │   └── service.ts     # Cart operations
│   │   │   ├── order/
│   │   │   │   ├── schema.ts      # Zod schemas
│   │   │   │   └── service.ts     # Checkout, order retrieval
│   │   │   ├── discount/
│   │   │   │   └── service.ts     # Discount generation & validation
│   │   │   └── admin/
│   │   │       └── service.ts     # Admin statistics
│   │   ├── routes/                # API routes
│   │   │   ├── cart.ts           # Cart endpoints
│   │   │   ├── checkout.ts       # Checkout & orders
│   │   │   ├── products.ts       # Product listing
│   │   │   └── admin/
│   │   │       ├── discounts.ts  # Discount generation
│   │   │       └── stats.ts       # Admin statistics
│   │   ├── scripts/
│   │   │   ├── migrate.ts        # Migration runner
│   │   │   ├── list-customers.ts # Debug script
│   │   │   └── check-and-generate-coupon.ts # Debug script
│   │   └── index.ts               # Entry point
│   ├── .env.development           # Environment variables
│   ├── drizzle.config.ts          # Drizzle configuration
│   ├── Dockerfile
│   ├── docker-compose.yml         # PostgreSQL service
│   └── package.json
└── frontend/
    ├── src/
    │   ├── app/                   # Next.js app router
    │   │   ├── page.tsx          # Product listing
    │   │   ├── cart/
    │   │   │   └── page.tsx       # Cart page
    │   │   ├── checkout/
    │   │   │   └── page.tsx       # Checkout page
    │   │   ├── orders/
    │   │   │   └── page.tsx       # Order history
    │   │   └── products/
    │   │       └── [id]/
    │   │           └── page.tsx   # Product detail
    │   ├── components/
    │   │   ├── Header.tsx         # Navigation bar
    │   │   ├── CartPreview.tsx    # Cart sidebar
    │   │   └── LoadingSkeleton.tsx
    │   └── lib/
    │       └── api.ts             # API client functions
    └── package.json
```

## Implementation Details

### Order Numbering

Orders are numbered **per-customer** based on creation date:

```typescript
// In order/service.ts
export async function getAllOrders(customerId: string) {
  const ordersList = await db.query.orders.findMany({
    where: eq(orders.customerId, customerId),
    orderBy: (orders, { asc }) => [asc(orders.createdAt)],
  });

  // Assign sequential order number per customer
  return ordersList.map((order, index) => ({
    ...order,
    orderNumber: index + 1, // 1-based order number
  }));
}
```

### Discount Code Generation

```typescript
// In discount/service.ts
const NTH_ORDER = parseInt(process.env.NTH_ORDER_DISCOUNT || "3");
const REQUIRED_ITEMS = 5;
const REQUIRED_AMOUNT = 300;

export async function checkAndGenerateDiscountCode(customerId: string) {
  // 1. Check order count >= NTH_ORDER
  // 2. Check no unused coupon exists
  // 3. Check purchase stats (5 items, $300)
  // 4. Check order gap (>= NTH_ORDER since last coupon)
  // 5. Check previous coupon was used
  // If all pass, generate unique 8-character code
}
```

### Purchase Stats Calculation

```typescript
export async function getCustomerPurchaseStats(customerId: string) {
  // Sum all order items for customer
  // Calculate total items and total amount
  return {
    totalItemsPurchased: sum(quantities),
    totalPurchaseAmount: sum(item_totals),
  };
}
```

## Environment Variables

### Backend (.env.development)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/ecommerce
PORT=3001
NTH_ORDER_DISCOUNT=3
```

- `DATABASE_URL`: PostgreSQL connection (port 5435 for Docker)
- `PORT`: Backend server port
- `NTH_ORDER_DISCOUNT`: Nth order value (default: 3)

### Frontend

- `NEXT_PUBLIC_API_URL`: Backend API URL (default: `http://localhost:3001`)

## Development Workflow

### Initial Setup

1. **Install dependencies**: `pnpm i`
2. **Create .env.development**: See README.md
3. **Start Docker**: `docker compose up -d`
4. **Run migrations**: `pnpm with-dev-env pnpm db:push`
5. **Seed data**: `pnpm with-dev-env pnpm seed`
6. **Start backend**: `pnpm dev`
7. **Start frontend**: `cd ../frontend && pnpm i && pnpm dev`

### Package.json Scripts

- `dev`: Start development server with hot reload
- `seed`: Seed categories and products
- `db:push`: Push schema to database
- `db:generate`: Generate migration files
- `db:migrate`: Run migrations
- `with-dev-env`: Wrapper to run commands with .env.development

## Testing Strategy

1. **Unit Tests**: Test business logic in modules (cart, order, discount)
2. **Integration Tests**: Test API endpoints with test database
3. **Edge Cases**:
   - Multiple items in cart
   - Invalid discount codes
   - Out of stock products
   - Concurrent order processing
   - Per-customer order numbering
   - Purchase stats calculation

## Key Implementation Notes

- ✅ All IDs are string-based (CUID2), not integers
- ✅ Order numbers are per-customer (Order #1, #2, etc.)
- ✅ Discount codes generated automatically after checkout
- ✅ Purchase threshold: 5 items and $300 required
- ✅ Nth order: 3 orders required (configurable)
- ✅ Single-use discount codes
- ✅ Per-customer discount tracking
- ✅ Order gap validation (>= N orders since last coupon)

## License

ISC
