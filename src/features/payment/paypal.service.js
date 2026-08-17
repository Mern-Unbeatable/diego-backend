import { config } from '../../config/config.js';
import { Logger } from '../../config/logger.js';

class PayPalService {
  constructor() {
    this.log = new Logger('PayPalService');
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  get baseUrl() {
    return config.PAYPAL_MODE === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';
  }

  isConfigured() {
    return Boolean(config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET);
  }

  async getAccessToken() {
    if (this._token && Date.now() < this._tokenExpiresAt - 60_000) {
      return this._token;
    }

    if (!this.isConfigured()) {
      throw new Error('PayPal is not configured on the server');
    }

    const auth = Buffer
      .from(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`)
      .toString('base64');

    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || data.error || 'PayPal authentication failed');
    }

    this._token = data.access_token;
    this._tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this._token;
  }

  async request(path, options = {}) {
    const token = await this.getAccessToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.details?.[0]?.description || data.message || data.name;
      throw new Error(detail || `PayPal request failed (${response.status})`);
    }

    return data;
  }

  async createOrder({ amount, currency, description, paymentId, returnUrl, cancelUrl }) {
    const value = Number(amount).toFixed(2);

    return this.request('/v2/checkout/orders', {
      method: 'POST',
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: {
              currency_code: String(currency || 'EUR').toUpperCase(),
              value,
            },
            description,
            custom_id: paymentId,
          },
        ],
        application_context: {
          brand_name: 'UnoSicurezza',
          landing_page: 'NO_PREFERENCE',
          user_action: 'PAY_NOW',
          return_url: returnUrl || config.CLIENT_URL,
          cancel_url: cancelUrl || config.CLIENT_URL,
        },
      }),
    });
  }

  async captureOrder(orderId) {
    return this.request(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST' });
  }

  async getOrder(orderId) {
    return this.request(`/v2/checkout/orders/${orderId}`, { method: 'GET' });
  }
}

export const paypalService = new PayPalService();
