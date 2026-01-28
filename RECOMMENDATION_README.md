# Personalized Product Recommendation System Implementation

This README outlines the step-by-step process to implement a personalized recommendation system for the e-commerce platform. The system will display personalized recommendations when users hover over product cards, based on product category, pricing, and ratings.

## Overview

The recommendation system will:
- Track user interactions (product views)
- Generate personalized recommendations based on category, price similarity, and ratings
- Display recommendations in a hover tooltip on product cards
- Use collaborative filtering elements (popular in category, recently viewed)

## Todo Plan

### Phase 1: Database Schema Updates
1. **Add Rating Field to Products**
   - Add `rating` column to products table (decimal 2,1 scale, 1-5)
   - Update schema.ts
   - Generate and run migration

2. **Add Product Views Tracking**
   - Create new `product_views` table to track user interactions
   - Fields: id, customer_id, product_id, viewed_at, session_id
   - Update schema.ts and relations.ts
   - Generate and run migration

### Phase 2: Backend Logic
3. **Update Seed Data**
   - Add random ratings (1-5) to existing products in seed.ts

4. **Implement Recommendation Service**
   - Create recommendation/service.ts
   - Implement algorithms:
     - Category-based: same category, high rated
     - Price-based: similar price range (±20%)
     - Rating-based: top rated in category
     - Personal: recently viewed categories/products

5. **Create Recommendation API Route**
   - Add /api/recommendations route
   - Accept customerId and productId parameters
   - Return list of recommended products (5-6 items)
   - Include tracking for product views

### Phase 3: Frontend Integration
6. **Update API Client**
   - Add fetchRecommendations function to api.ts
   - Handle customerId parameter

7. **Create Recommendation Component**
   - Create components/RecommendationPopup.tsx
   - Display 3-4 recommended products in a tooltip
   - Handle loading states

8. **Integrate Hover Functionality**
   - Modify product cards in page.tsx to show recommendations on hover
   - Add hover delay and positioning logic
   - Ensure mobile responsiveness

### Phase 4: Testing and Optimization
9. **Update Product Routes**
   - Modify /api/products to include rating in responses
   - Ensure recommendation API works correctly

10. **Testing and Refinement**
    - Test recommendation accuracy
    - Optimize performance (caching, limits)
    - Add error handling

## Implementation Steps

### Step 1: Database Schema - Add Rating to Products

**File: backend/src/drizzle/schema.ts**
- Add `rating: decimal("rating", { precision: 2, scale: 1 }).default("4.0")` to products table

**Generate Migration:**
```bash
cd backend
pnpm db:generate
pnpm with-dev-env pnpm db:migrate
```

### Step 2: Database Schema - Add Product Views Table

**File: backend/src/drizzle/schema.ts**
- Add new productViews table with fields for tracking views

**Update relations.ts** to include productViews relations

**Generate Migration:**
```bash
pnpm db:generate
pnpm with-dev-env pnpm db:migrate
```

### Step 3: Update Seed Data

**File: backend/src/seed.ts**
- Add random ratings to products (1.0 to 5.0)

### Step 4: Implement Recommendation Service

**File: backend/src/modules/recommendation/service.ts**
- Implement getRecommendations function
- Algorithm logic:
  - Get current product details
  - Find similar products by category (top rated)
  - Find similar by price range
  - Include recently viewed products from same category
  - Deduplicate and limit to 5-6 products

### Step 5: Create API Route

**File: backend/src/routes/recommendations.ts**
- GET /api/recommendations?customerId={}&productId={}
- Call recommendation service
- Track product view

### Step 6: Update API Client

**File: frontend/src/lib/api.ts**
- Add fetchRecommendations function

### Step 7: Create Recommendation Component

**File: frontend/src/components/RecommendationPopup.tsx**
- Tooltip-style component
- Display product thumbnails, names, prices
- Loading skeleton

### Step 8: Integrate Hover on Product Cards

**File: frontend/src/app/page.tsx**
- Wrap product cards with hover handlers
- Show RecommendationPopup on hover
- Position absolutely above/below card

### Step 9: Update Product API Response

**File: backend/src/routes/products.ts**
- Include rating in product responses

### Step 10: Testing and Optimization

- Test hover functionality
- Verify recommendations are relevant
- Add caching if needed
- Handle edge cases (no recommendations, errors)

## Technical Details

### Recommendation Algorithm

The algorithm combines multiple factors:
1. **Category Match (40%)**: Products in same category, sorted by rating
2. **Price Similarity (30%)**: Products within ±20% price range
3. **Rating Priority (20%)**: Higher rated products preferred
4. **Personalization (10%)**: Recently viewed categories

### Database Changes

- `products.rating`: decimal(2,1) default 4.0
- `product_views`: id, customer_id, product_id, viewed_at, session_id

### API Endpoints

- `GET /api/recommendations?customerId={uuid}&productId={string}`

### Frontend Changes

- Hover detection with 500ms delay
- Tooltip positioning (above/below based on viewport)
- Responsive design for mobile (tap to show)

## Dependencies

No new dependencies required. Uses existing Drizzle, Fastify, Next.js setup.

## Performance Considerations

- Limit recommendations to 5 products per request
- Cache frequently accessed recommendations
- Index product_views on customer_id and viewed_at
- Lazy load recommendation popup

## Future Enhancements

- Machine learning-based recommendations
- A/B testing for algorithm effectiveness
- User feedback on recommendations
- More interaction tracking (clicks, time spent)