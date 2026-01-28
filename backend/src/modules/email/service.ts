import { cartRecoveryManager, AbandonedCart } from "../cart-persistence/service";
import { db } from "../../lib/db";
import { eq } from "drizzle-orm";
import { cartRecovery } from "../../drizzle/schema";

// Email service interface
export interface EmailData {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface AbandonedCartEmailData {
  customerName: string;
  cartItems: any[];
  totalValue: number;
  recoveryUrl: string;
  lastActivity: Date;
  itemCount: number;
}

export class EmailService {
  private emailProvider: EmailProvider;

  constructor() {
    // Initialize email provider (could be SendGrid, AWS SES, etc.)
    this.emailProvider = new MockEmailProvider(); // Replace with real provider
  }

  /**
   * Send cart abandonment reminder email
   */
  async sendCartAbandonmentEmail(
    abandonedCart: AbandonedCart,
    recoveryToken: string,
    reminderType: 'first' | 'second' | 'final' = 'first'
  ): Promise<boolean> {
    if (!abandonedCart.customerEmail) return false;

    const recoveryUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/cart/recover/${recoveryToken}`;

    const emailData: AbandonedCartEmailData = {
      customerName: abandonedCart.customerEmail.split('@')[0] || 'Valued Customer',
      cartItems: abandonedCart.cartItems.slice(0, 3), // Show first 3 items
      totalValue: abandonedCart.totalValue,
      recoveryUrl,
      lastActivity: abandonedCart.lastActivity,
      itemCount: abandonedCart.cartItems.length
    };

    const subject = this.getEmailSubject(reminderType);
    const html = this.generateCartAbandonmentHTML(emailData, reminderType);

    try {
      await this.emailProvider.send({
        to: abandonedCart.customerEmail,
        subject,
        html,
        text: this.generateCartAbandonmentText(emailData)
      });

      // Mark email as sent
      await this.markEmailSent(abandonedCart.customerId, recoveryToken);

      console.log(`✅ Cart abandonment email sent to ${abandonedCart.customerEmail} (${reminderType} reminder)`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send cart abandonment email:`, error);
      return false;
    }
  }

  /**
   * Schedule and send cart abandonment emails
   */
  async processCartAbandonmentEmails(): Promise<void> {
    console.log('🔍 Processing cart abandonment emails...');

    const abandonedCarts = await cartSessionManager.findAbandonedCarts();
    console.log(`📧 Found ${abandonedCarts.length} abandoned carts`);

    let emailsSent = 0;

    for (const cart of abandonedCarts) {
      try {
        // Create recovery token if not exists
        let recoveryToken = await this.getExistingRecoveryToken(cart.customerId);

        if (!recoveryToken) {
          recoveryToken = await cartRecoveryManager.createRecoveryToken(cart.customerId);
          if (!recoveryToken) continue; // Skip if no token created
        }

        // Determine which reminder to send
        const reminderType = this.determineReminderType(cart.lastActivity);

        if (reminderType && !await this.wasReminderSent(cart.customerId, reminderType)) {
          const success = await this.sendCartAbandonmentEmail(cart, recoveryToken, reminderType);
          if (success) {
            emailsSent++;
            await this.markReminderSent(cart.customerId, reminderType);
          }
        }
      } catch (error) {
        console.error(`Failed to process abandonment email for customer ${cart.customerId}:`, error);
      }
    }

    console.log(`📧 Sent ${emailsSent} cart abandonment emails`);
  }

  /**
   * Get existing recovery token for customer
   */
  private async getExistingRecoveryToken(customerId: string): Promise<string | null> {
    try {
      const recovery = await db.query.cartRecovery.findFirst({
        where: eq(cartRecovery.customerId, customerId)
      });
      return recovery?.recoveryToken || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Mark email as sent in recovery record
   */
  private async markEmailSent(customerId: string, recoveryToken: string): Promise<void> {
    try {
      await db.update(cartRecovery)
        .set({
          emailSent: true,
          emailSentAt: new Date()
        })
        .where(eq(cartRecovery.recoveryToken, recoveryToken));
    } catch (error) {
      console.error('Failed to mark email as sent:', error);
    }
  }

  /**
   * Determine which reminder type to send based on time elapsed
   */
  private determineReminderType(lastActivity: Date): 'first' | 'second' | 'final' | null {
    const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);

    if (hoursSinceActivity >= 1 && hoursSinceActivity < 24) {
      return 'first';
    } else if (hoursSinceActivity >= 24 && hoursSinceActivity < 72) {
      return 'second';
    } else if (hoursSinceActivity >= 72 && hoursSinceActivity < 168) { // 7 days
      return 'final';
    }

    return null; // Too old or too new
  }

  /**
   * Check if reminder was already sent
   */
  private async wasReminderSent(customerId: string, reminderType: string): Promise<boolean> {
    // In a real implementation, you'd track this in a separate table
    // For now, we'll use a simple approach
    try {
      const recovery = await db.query.cartRecovery.findFirst({
        where: eq(cartRecovery.customerId, customerId)
      });

      if (!recovery) return false;

      // Simple logic: assume first reminder is sent if emailSent is true
      // You'd want more sophisticated tracking for multiple reminders
      return recovery.emailSent || false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Mark reminder as sent
   */
  private async markReminderSent(customerId: string, reminderType: string): Promise<void> {
    // In a real implementation, track reminder types sent
    // For now, just update the emailSent flag
    try {
      await db.update(cartRecovery)
        .set({
          emailSent: true,
          emailSentAt: new Date()
        })
        .where(eq(cartRecovery.customerId, customerId));
    } catch (error) {
      console.error('Failed to mark reminder as sent:', error);
    }
  }

  /**
   * Get email subject based on reminder type
   */
  private getEmailSubject(reminderType: 'first' | 'second' | 'final'): string {
    switch (reminderType) {
      case 'first':
        return "🛒 Don't forget your items in cart!";
      case 'second':
        return "⏰ Your cart is waiting for you!";
      case 'final':
        return "⏳ Last chance to complete your purchase";
      default:
        return "🛒 Your cart awaits!";
    }
  }

  /**
   * Generate HTML email content for cart abandonment
   */
  private generateCartAbandonmentHTML(data: AbandonedCartEmailData, reminderType: string): string {
    const itemsHTML = data.cartItems.map(item => `
      <div style="display: flex; align-items: center; margin: 10px 0; padding: 10px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <img src="${item.product?.image || '/placeholder.png'}" alt="${item.product?.name}" style="width: 60px; height: 60px; object-fit: cover; margin-right: 15px; border-radius: 4px;">
        <div style="flex: 1;">
          <h4 style="margin: 0 0 5px 0; font-size: 16px; color: #333;">${item.product?.name}</h4>
          <p style="margin: 0; color: #666; font-size: 14px;">Quantity: ${item.quantity} × $${item.product?.price}</p>
        </div>
        <div style="font-weight: bold; color: #e74c3c;">
          $${(parseFloat(item.product?.price || '0') * item.quantity).toFixed(2)}
        </div>
      </div>
    `).join('');

    const urgencyMessage = this.getUrgencyMessage(reminderType);

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Your Cart is Waiting</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Hi ${data.customerName}!</h1>
            <p style="color: #e8e8e8; margin: 10px 0 0 0; font-size: 16px;">We noticed you left some items in your cart</p>
          </div>

          <div style="background: white; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px; padding: 30px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #e74c3c; margin: 0 0 10px 0;">${data.itemCount} item${data.itemCount > 1 ? 's' : ''} waiting for you!</h2>
              <p style="color: #666; margin: 0;">Total value: <strong style="color: #e74c3c; font-size: 18px;">$${data.totalValue.toFixed(2)}</strong></p>
            </div>

            ${itemsHTML}

            ${data.cartItems.length > 3 ? `<p style="text-align: center; color: #666; font-style: italic;">And ${data.cartItems.length - 3} more item${data.cartItems.length - 3 > 1 ? 's' : ''}...</p>` : ''}

            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #e74c3c; font-weight: bold; margin: 0 0 20px 0;">${urgencyMessage}</p>

              <a href="${data.recoveryUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">Complete Your Purchase</a>
            </div>

            <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 12px;">
              <p>This recovery link will expire in 7 days.</p>
              <p>If you didn't add these items to your cart, please ignore this email.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generate plain text version of the email
   */
  private generateCartAbandonmentText(data: AbandonedCartEmailData): string {
    const itemsText = data.cartItems.map(item =>
      `${item.product?.name} - Quantity: ${item.quantity} × $${item.product?.price}`
    ).join('\n');

    return `
Hi ${data.customerName}!

We noticed you left some items in your cart. Don't miss out!

Your cart contains ${data.itemCount} item(s) with a total value of $${data.totalValue.toFixed(2)}

Items in your cart:
${itemsText}

Complete your purchase now: ${data.recoveryUrl}

This recovery link will expire in 7 days.

If you didn't add these items to your cart, please ignore this email.
    `.trim();
  }

  /**
   * Get urgency message based on reminder type
   */
  private getUrgencyMessage(reminderType: string): string {
    switch (reminderType) {
      case 'first':
        return "⏰ Your items are reserved for a limited time!";
      case 'second':
        return "🚨 Don't lose your cart - prices may change!";
      case 'final':
        return "⚠️ This is your final reminder - complete your purchase now!";
      default:
        return "Complete your purchase before it's too late!";
    }
  }
}

// Mock email provider for development/testing
class MockEmailProvider {
  async send(email: EmailData): Promise<void> {
    // In development, just log the email
    console.log('📧 Mock Email Sent:');
    console.log(`To: ${email.to}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Content: ${email.text || 'HTML content'}`);

    // Simulate occasional failures for testing
    if (Math.random() < 0.05) { // 5% failure rate
      throw new Error('Mock email delivery failed');
    }

    // Simulate delivery delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Export singleton instance
export const emailService = new EmailService();