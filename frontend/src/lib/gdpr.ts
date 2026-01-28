// GDPR compliance utilities for frontend

export interface ConsentPreferences {
  necessary: boolean; // Always true, cannot be disabled
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
}

export const DEFAULT_CONSENT: ConsentPreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
  preferences: false,
};

export class GDPRManager {
  private static readonly CONSENT_KEY = 'gdpr_consent';
  private static readonly CONSENT_VERSION = '1.0';

  // Get user's consent preferences
  static getConsent(): ConsentPreferences {
    try {
      const stored = localStorage.getItem(this.CONSENT_KEY);
      if (!stored) return DEFAULT_CONSENT;

      const parsed = JSON.parse(stored);
      if (parsed.version !== this.CONSENT_VERSION) {
        // Version mismatch, reset to defaults
        return DEFAULT_CONSENT;
      }

      return { ...DEFAULT_CONSENT, ...parsed.preferences };
    } catch {
      return DEFAULT_CONSENT;
    }
  }

  // Save user's consent preferences
  static setConsent(preferences: Partial<ConsentPreferences>): void {
    const consent = {
      version: this.CONSENT_VERSION,
      preferences: { ...this.getConsent(), ...preferences },
      timestamp: new Date().toISOString(),
    };

    localStorage.setItem(this.CONSENT_KEY, JSON.stringify(consent));

    // Apply consent settings
    this.applyConsent(consent.preferences);
  }

  // Check if user has given consent for a specific purpose
  static hasConsent(purpose: keyof ConsentPreferences): boolean {
    return this.getConsent()[purpose];
  }

  // Apply consent settings (enable/disable tracking, etc.)
  private static applyConsent(preferences: ConsentPreferences): void {
    // Analytics tracking
    if (preferences.analytics) {
      // Enable Google Analytics, etc.
      console.log('Analytics tracking enabled');
    } else {
      // Disable analytics
      console.log('Analytics tracking disabled');
    }

    // Marketing cookies
    if (preferences.marketing) {
      // Enable marketing pixels, etc.
      console.log('Marketing tracking enabled');
    } else {
      // Disable marketing
      console.log('Marketing tracking disabled');
    }

    // Dispatch custom event for other parts of the app
    window.dispatchEvent(new CustomEvent('gdpr-consent-changed', {
      detail: preferences
    }));
  }

  // Show consent banner
  static shouldShowBanner(): boolean {
    return !localStorage.getItem(this.CONSENT_KEY);
  }

  // Accept all cookies
  static acceptAll(): void {
    this.setConsent({
      analytics: true,
      marketing: true,
      preferences: true,
    });
  }

  // Reject all non-necessary cookies
  static rejectAll(): void {
    this.setConsent({
      analytics: false,
      marketing: false,
      preferences: false,
    });
  }

  // GDPR data export request
  static async requestDataExport(): Promise<void> {
    // This would make an API call to request data export
    console.log('Data export requested');
  }

  // GDPR data deletion request
  static async requestDataDeletion(): Promise<void> {
    // This would make an API call to request data deletion
    console.log('Data deletion requested');
  }

  // Get privacy policy URL
  static getPrivacyPolicyUrl(): string {
    return '/privacy-policy';
  }

  // Get cookie policy URL
  static getCookiePolicyUrl(): string {
    return '/cookie-policy';
  }

  // Get data processing inventory (for transparency)
  static getDataProcessingInventory() {
    return [
      {
        purpose: 'Account Management',
        data: 'Name, email address',
        retention: 'Until account deletion',
        legalBasis: 'Contract performance',
      },
      {
        purpose: 'Order Processing',
        data: 'Order details, shipping address',
        retention: '7 years',
        legalBasis: 'Contract performance',
      },
      {
        purpose: 'Analytics',
        data: 'IP address, browsing behavior',
        retention: '2 years',
        legalBasis: 'Consent',
      },
      {
        purpose: 'Marketing',
        data: 'Email address, preferences',
        retention: 'Until consent withdrawn',
        legalBasis: 'Consent',
      },
    ];
  }
}

// Cookie utilities
export class CookieManager {
  static set(name: string, value: string, days: number = 30): void {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Strict${process.env.NODE_ENV === 'production' ? ';Secure' : ''}`;
  }

  static get(name: string): string | null {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }

  static delete(name: string): void {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:01 GMT;path=/;SameSite=Strict`;
  }

  // Check if cookies are enabled
  static areCookiesEnabled(): boolean {
    try {
      this.set('test', 'test', 1);
      const result = this.get('test') === 'test';
      this.delete('test');
      return result;
    } catch {
      return false;
    }
  }
}

// Data masking for frontend (less sensitive than backend)
export function maskEmailForDisplay(email: string): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return email;
  return `${local.charAt(0)}${'*'.repeat(local.length - 2)}${local.slice(-1)}@${domain}`;
}

export function maskCardNumber(cardNumber: string): string {
  if (!cardNumber) return '';
  const cleaned = cardNumber.replace(/\D/g, '');
  if (cleaned.length < 4) return cleaned;
  return `****-****-****-${cleaned.slice(-4)}`;
}