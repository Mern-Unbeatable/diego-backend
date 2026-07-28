
class VerificationStore {
  constructor() {
    this.store = new Map();
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  setVerified(email) {
    // Store verification for 10 minutes
    this.store.set(email, {
      verified: true,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

  }

  isVerified(email) {
    const record = this.store.get(email);
    if (!record) return false;

    // Check if expired
    if (record.expiresAt < Date.now()) {
      this.store.delete(email);
      return false;
    }

    return record.verified;
  }

  clearVerified(email) {
    this.store.delete(email);
  }

  cleanup() {
    const now = Date.now();
    for (const [email, record] of this.store.entries()) {
      if (record.expiresAt < now) {
        this.store.delete(email);
      }
    }
  }
}

export const verificationStore = new VerificationStore();