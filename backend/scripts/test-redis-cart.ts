import { redisCache } from '../src/modules/cache/redis-service';
import { CartSessionManager, CartRecoveryManager } from '../src/modules/cart-persistence/service';

async function testRedisCart() {
  console.log('🧪 Testing Redis Cart Implementation\n');

  try {
    // Connect to Redis
    await redisCache.connect();
    console.log('✅ Connected to Redis');

    // Test cart session manager
    const sessionManager = new CartSessionManager();
    const recoveryManager = new CartRecoveryManager();

    const customerId = 'test-customer-123';
    const cartItems = [
      {
        productId: 'prod-1',
        quantity: 2,
        product: { id: 'prod-1', name: 'Test Product', price: '29.99' },
        addedAt: new Date(),
        updatedAt: new Date()
      }
    ];

    // Test session operations
    console.log('📝 Testing Cart Session Operations...');

    // Update session
    await sessionManager.updateSession(customerId, cartItems);
    console.log('✅ Cart session updated');

    // Get session
    const retrievedSession = await sessionManager.getSession(customerId);
    console.log('✅ Cart session retrieved:', retrievedSession?.itemCount, 'items');

    // Check if session exists
    const exists = await sessionManager.sessionExists(customerId);
    console.log('✅ Session exists check:', exists);

    // Get session TTL
    const ttl = await sessionManager.getSessionTTL(customerId);
    console.log('✅ Session TTL:', ttl, 'seconds');

    // Test recovery operations
    console.log('\n📧 Testing Cart Recovery Operations...');

    // Create recovery token
    const recoveryToken = await recoveryManager.createRecoveryToken(customerId);
    console.log('✅ Recovery token created:', recoveryToken);

    if (recoveryToken) {
      // Get recovery data
      const recoveryData = await recoveryManager.getRecoveryData(recoveryToken);
      console.log('✅ Recovery data retrieved:', recoveryData?.length, 'items');

      // Mark as recovered
      const marked = await recoveryManager.markRecoveryUsed(recoveryToken);
      console.log('✅ Recovery token marked as used:', marked);

      // Try to get data again (should be null now)
      const recoveryDataAfter = await recoveryManager.getRecoveryData(recoveryToken);
      console.log('✅ Recovery data after marking used:', recoveryDataAfter);
    }

    // Get recovery stats
    const stats = await recoveryManager.getRecoveryStats();
    console.log('✅ Recovery stats:', stats);

    // Test Redis stats
    console.log('\n📊 Testing Redis Stats...');
    const redisStats = await redisCache.getStats();
    console.log('✅ Redis stats:', redisStats);

    // Clean up - delete test session
    const deleted = await sessionManager.deleteSession(customerId);
    console.log('✅ Test session deleted:', deleted);

    console.log('\n🎉 All Redis cart tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await redisCache.disconnect();
    console.log('🔌 Disconnected from Redis');
  }
}

// Run the test
testRedisCart().catch(console.error);