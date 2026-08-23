import twilio from 'twilio';
import { config } from '../../../config/config.js';
import { Logger } from '../../../config/logger.js';

const log = new Logger('SmsService');

/** Map common Unicode / Bangla digits → ASCII */
const UNICODE_DIGIT_MAP = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
};

const toAsciiDigits = (value) =>
  String(value).replace(/[০-৯٠-٩０-９]/g, (ch) => UNICODE_DIGIT_MAP[ch] || ch);

/**
 * Normalize to E.164 (+digits only).
 * Accepts: +8801825445033, 8801825445033, 01825445033, +880 1825 445033
 * Fixes common BD mistake: +88001825... (kept local trunk 0 after country code)
 */
export const normalizePhoneE164 = (raw, defaultCountry = 'BD') => {
  if (raw == null) return null;

  const ascii = toAsciiDigits(raw).trim();
  if (!ascii) return null;

  // Keep only leading + and digits; drop spaces, dashes, (), etc.
  const compact = ascii.replace(/[^\d+]/g, '');
  let digits = compact.replace(/\D/g, '');
  if (!digits) return null;

  // Bangladesh local mobile: 01XXXXXXXXX (11 digits) → 8801XXXXXXXXX
  if (defaultCountry === 'BD' || defaultCountry == null) {
    if (digits.length === 11 && digits.startsWith('01')) {
      digits = `880${digits.slice(1)}`;
    } else if (digits.length === 10 && digits.startsWith('1')) {
      // 1825445033 → 8801825445033
      digits = `880${digits}`;
    }

    // Common mistake / Twilio friendly-name style: 8800XXXXXXXXX (extra trunk 0)
    // Example: 88001825445033 → 8801825445033
    if (digits.startsWith('8800') && digits.length >= 13 && digits.length <= 14) {
      const withoutTrunk = `880${digits.slice(4)}`;
      if (withoutTrunk.length >= 11 && withoutTrunk.length <= 13) {
        digits = withoutTrunk;
      }
    }
  }

  // Italy local mobile without country: 3XXXXXXXXX (10 digits) often starts with 3
  if (defaultCountry === 'IT' && digits.length === 10 && digits.startsWith('3')) {
    digits = `39${digits}`;
  }

  // E.164 body is 8–15 digits (country code + subscriber)
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }

  // Reject numbers that still look like a leading trunk 0 after country handling
  if (digits.startsWith('0')) {
    return null;
  }

  return `+${digits}`;
};


class SmsService {
  _client = null;

  isConfigured() {
    return Boolean(
      config.TWILIO_ACCOUNT_SID
      && config.TWILIO_AUTH_TOKEN
      && config.TWILIO_PHONE_NUMBER,
    );
  }

  getFromNumber() {
    return normalizePhoneE164(config.TWILIO_PHONE_NUMBER, null);
  }

  getStatus() {
    const from = this.getFromNumber();
    return {
      configured: this.isConfigured() && Boolean(from),
      fromNumberMasked: from
        ? `${from.slice(0, 4)}••••${from.slice(-4)}`
        : null,
      provider: 'twilio',
    };
  }

  _getClient() {
    if (!this.isConfigured()) {
      throw new Error(
        'Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in the server .env.',
      );
    }

    if (!this._client) {
      this._client = twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
    }
    return this._client;
  }

  /**
   * Send an SMS. Failures are logged and rethrown so callers can decide.
   * @param {{ to: string, body: string }} params
   */
  async sendSms({ to, body }) {
    const destination = normalizePhoneE164(to, 'BD');
    const from = this.getFromNumber();
    const text = typeof body === 'string' ? body.trim() : '';

    if (!destination) {
      log.warn(`Invalid SMS destination raw=${JSON.stringify(String(to ?? ''))}`);
      throw new Error(
        'Invalid destination phone number. Use +8801825445033 (BD) or +39XXXXXXXXXX (IT). Local BD format 01825445033 is also accepted.',
      );
    }
    if (!from) {
      throw new Error('TWILIO_PHONE_NUMBER is invalid. Use your Twilio Active Number, e.g. +14322373374 (not your personal phone).');
    }
    if (destination === from) {
      throw new Error(
        'From and To are the same. Set TWILIO_PHONE_NUMBER=+14322373374 (Twilio Active Number), and put your personal verified phone (+880...) only in the Test SMS field.',
      );
    }
    if (!text) {
      throw new Error('SMS body is required');
    }
    if (text.length > 1600) {
      throw new Error('SMS body is too long (max 1600 characters)');
    }

    const client = this._getClient();

    try {
      const message = await client.messages.create({
        from,
        to: destination,
        body: text,
      });

      log.info(`SMS sent sid=${message.sid} to=${destination}`);

      return {
        sid: message.sid,
        status: message.status,
        to: destination,
        from,
      };
    } catch (error) {
      const code = error?.code || error?.status;
      const twilioMessage = error?.message || 'Twilio SMS failed';
      log.error(`SMS failed to=${destination} code=${code}: ${twilioMessage}`);

      // Keep original Twilio code in message for easier support/debug
      const withCode = (msg) => (code ? `[Twilio ${code}] ${msg}` : msg);

      if (code === 21211) {
        throw new Error(
          withCode(
            `Invalid phone number format (From=${from}, To=${destination}). For BD use +8801825445033 — never +88001825... (no extra 0 after 880).`,
          ),
        );
      }
      // 21608 = unverified destination on trial
      if (code === 21608) {
        throw new Error(
          withCode(
            `Destination ${destination} is not verified for this Trial account. In Twilio Console → Phone Numbers → Manage → Verified Caller IDs, the number must appear exactly as ${destination} (same digits). If it shows with spaces it is OK, but digits must match. Then use that same number in the Test SMS field. Note: a US Trial number often allows only domestic (US/CA) SMS — BD/IT may stay blocked until you Upgrade or enable Messaging Geo permissions for that country.`,
          ),
        );
      }
      // 21408 = SMS not allowed to that country / region
      if (
        code === 21408
        || /permission to send an SMS has not been enabled/i.test(twilioMessage)
        || /region indicated by the 'To' number/i.test(twilioMessage)
      ) {
        throw new Error(
          withCode(
            'Twilio blocked SMS to this country. Enable Bangladesh (BD) in Twilio Console → Messaging → Settings → Geo permissions → SMS, save, then retry.',
          ),
        );
      }
      if (code === 21610) {
        throw new Error(withCode('This number has opted out of SMS (STOP).'));
      }
      if (
        /not a Twilio phone number/i.test(twilioMessage)
        || /Short Code country mismatch/i.test(twilioMessage)
      ) {
        throw new Error(
          withCode(
            'TWILIO_PHONE_NUMBER must be your Twilio Active Number (e.g. +14322373374), not your personal BD phone.',
          ),
        );
      }
      if (/cannot be the same/i.test(twilioMessage)) {
        throw new Error(
          withCode(
            'From and To are the same. From=+14322373374 (Twilio), To=+880... (verified personal phone).',
          ),
        );
      }

      throw new Error(withCode(twilioMessage));
    }
  }

  /**
   * Best-effort SMS for notifications: never throws to callers.
   * Returns { sent: boolean, skipped?: string, error?: string, result? }
   */
  async sendSmsSafe({ to, body }) {
    if (!to) {
      return { sent: false, skipped: 'no_phone' };
    }
    if (!this.isConfigured()) {
      return { sent: false, skipped: 'not_configured' };
    }

    try {
      const result = await this.sendSms({ to, body });
      return { sent: true, result };
    } catch (error) {
      return { sent: false, error: error?.message || 'SMS failed' };
    }
  }
}

export const smsService = new SmsService();
export default smsService;
