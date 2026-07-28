import Stripe from 'stripe';
import { prisma } from '../../config/db.js';
import { config } from '../../config/config.js';
import { Logger } from '../../config/logger.js';
import { addDays } from 'date-fns';
import { notificationService } from '../notification/notification.service.js';

const stripe = new Stripe(config.STRIPE_SECRET_KEY);
const log = new Logger('PaymentService');

class PaymentService {

  _isDefinedValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value !== 'string') return true;
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== 'undefined' && normalized !== 'null' && normalized !== 'nan';
  }

  _pickMetadataValue(metadata, keys = []) {
    if (!metadata) return null;
    for (const key of keys) {
      const value = metadata[key];
      if (this._isDefinedValue(value)) return value;
    }
    return null;
  }

  _parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  _parseNonNegativeFloat(value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }


  _getPricingFeaturesFromCourse(course) {
    const raw = course.companyPackage?.features;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      f => f && f.type === 'pricing'
        && Number.isFinite(Number(f.minUsers))
        && Number.isFinite(Number(f.price))
    ).map(f => ({
      id: f.id || null,          // ✅ tier id — frontend এটাই পাঠাবে
      minUsers: Number(f.minUsers),
      maxUsers: f.maxUsers != null ? Number(f.maxUsers) : null,
      price: Number(f.price),
      currency: f.currency || 'EUR',
      label: f.label || null,
    }));
  }


  _findTierById(tiers, tierId) {
    return tiers.find(t => t.id === tierId) || null;
  }


  _findExactCompanyTier(tiers, minUsers, maxUsers) {
    return tiers.find(t => {
      const sameMin = t.minUsers === minUsers;
      const sameMax = (maxUsers == null) ? (t.maxUsers == null) : (t.maxUsers === maxUsers);
      return sameMin && sameMax;
    }) || null;
  }

  _findTierBySeatsRange(tiers, seatsCount) {
    return tiers.find(t => {
      const max = t.maxUsers ?? Infinity;
      return seatsCount >= t.minUsers && seatsCount <= max;
    }) || null;
  }

  _formatAvailableTiers(tiers) {
    return tiers.map(t => `${t.minUsers}-${t.maxUsers ?? '∞'} users (€${t.price}/user)`).join(', ');
  }

  _findExactCompanyTier(tiers, minUsers, maxUsers) {
    return tiers.find(t => {
      const sameMin = t.minUsers === minUsers;
      const sameMax = (maxUsers == null) ? (t.maxUsers == null) : (t.maxUsers === maxUsers);
      return sameMin && sameMax;
    }) || null;
  }

  _findTierBySeatsRange(tiers, seatsCount) {
    return tiers.find(t => {
      const max = t.maxUsers ?? Infinity;
      return seatsCount >= t.minUsers && seatsCount <= max;
    }) || null;
  }

  _formatAvailableTiers(tiers) {
    return tiers.map(t => `${t.minUsers}-${t.maxUsers ?? '∞'} users (€${t.price}/user)`).join(', ');
  }

  async _resolveCompanyPurchasePricing({ courseId, tierId = null, minUsers = null, maxUsers = null, seatsCount = null }) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        price: true,
        basePrice: true,
        companyPackage: { select: { features: true } }, // ✅ relation থেকে
      },
    });
    if (!course) throw new Error('Course not found');

    const jsonTiers = this._getPricingFeaturesFromCourse(course);

    if (jsonTiers.length) {
      // ✅ PRIORITY 1: tierId (নতুন, সহজ, ভুল হওয়ার সুযোগ নেই)
      let tier = tierId ? this._findTierById(jsonTiers, tierId) : null;

      // ✅ FALLBACK: পুরনো clients যদি এখনো minUsers/maxUsers পাঠায়
      if (!tier && minUsers != null) {
        tier = this._findExactCompanyTier(jsonTiers, minUsers, maxUsers);
      }

      if (!tier) {
        throw new Error(
          `No matching company package found. Available packages: ${this._formatAvailableTiers(jsonTiers)}`
        );
      }

      let finalSeats;
      if (tier.maxUsers != null) {
        finalSeats = tier.maxUsers; // seats auto = tier's maxUsers
      } else {
        if (!seatsCount || seatsCount < tier.minUsers) {
          throw new Error(`This is a custom/open-ended package starting from ${tier.minUsers} users. Please provide a valid seatsCount (>= ${tier.minUsers}).`);
        }
        finalSeats = seatsCount;
      }

      const totalAmount = tier.price; // flat package price
      const effectivePricePerUser = finalSeats > 0
        ? Number((totalAmount / finalSeats).toFixed(2))
        : totalAmount;

      return {
        source: 'companyPackage',
        tierId: tier.id,
        minUsers: tier.minUsers,
        maxUsers: tier.maxUsers,
        packagePrice: tier.price,
        pricePerUser: effectivePricePerUser,
        currency: tier.currency,
        seatsCount: finalSeats,
        totalAmount,
      };
    }

    // Legacy fallback (CoursePricingTier table)
    if (!seatsCount) {
      throw new Error('seatsCount is required for this course (no company package pricing configured).');
    }

    const dbTier = await prisma.coursePricingTier.findFirst({
      where: {
        courseId, isActive: true,
        minUsers: { lte: seatsCount },
        OR: [{ maxUsers: null }, { maxUsers: { gte: seatsCount } }],
      },
      orderBy: { minUsers: 'desc' },
    });

    if (dbTier) {
      return {
        source: 'pricingTiers',
        minUsers: dbTier.minUsers,
        maxUsers: dbTier.maxUsers,
        pricePerUser: dbTier.pricePerUser,
        seatsCount,
        totalAmount: dbTier.pricePerUser * seatsCount,
      };
    }

    const flatPrice = Number.isFinite(course.basePrice) && course.basePrice > 0 ? course.basePrice : course.price;
    if (Number.isFinite(flatPrice) && flatPrice > 0) {
      return {
        source: 'basePrice',
        minUsers: 1, maxUsers: null,
        pricePerUser: flatPrice,
        seatsCount,
        totalAmount: flatPrice * seatsCount,
      };
    }

    throw new Error(`No pricing configured for this course. Please configure company pricing tiers first.`);
  }

  async _resolveCompanyRenewalPricing({ courseId, tierId = null, minUsers = null, maxUsers = null, currentSeatsTotal }) {
    if (tierId || minUsers != null) {
      return this._resolveCompanyPurchasePricing({ courseId, tierId, minUsers, maxUsers });
    }

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        price: true,
        basePrice: true,
        companyPackage: { select: { features: true } },
      },
    });
    if (!course) throw new Error('Course not found');

    const jsonTiers = this._getPricingFeaturesFromCourse(course);
    if (jsonTiers.length) {
      const tier = this._findTierBySeatsRange(jsonTiers, currentSeatsTotal);
      if (!tier) {
        throw new Error(`Current seats (${currentSeatsTotal}) no longer fit any company package. Available packages: ${this._formatAvailableTiers(jsonTiers)}. Please select a new package.`);
      }

      const totalAmount = tier.price;
      const effectivePricePerUser = currentSeatsTotal > 0
        ? Number((totalAmount / currentSeatsTotal).toFixed(2))
        : totalAmount;

      return {
        source: 'companyPackage',
        tierId: tier.id,
        minUsers: tier.minUsers, maxUsers: tier.maxUsers,
        packagePrice: tier.price,
        pricePerUser: effectivePricePerUser,
        currency: tier.currency,
        seatsCount: currentSeatsTotal,
        totalAmount,
      };
    }

    const flatPrice = Number.isFinite(course.basePrice) && course.basePrice > 0 ? course.basePrice : course.price;
    if (Number.isFinite(flatPrice) && flatPrice > 0) {
      return {
        source: 'basePrice', minUsers: 1, maxUsers: null,
        pricePerUser: flatPrice, seatsCount: currentSeatsTotal, totalAmount: flatPrice * currentSeatsTotal,
      };
    }

    throw new Error('No pricing configured for this course.');
  }


  _findMatchingCompanyFeatureTier(tiers, seatsCount) {
    return tiers.find(t => {
      const max = t.maxUsers ?? Infinity;
      return seatsCount >= t.minUsers && seatsCount <= max;
    }) || null;
  }


  async _calculatePriceForSeats(courseId, seatsCount) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { price: true, basePrice: true, companyFeatures: true },
    });
    if (!course) throw new Error('Course not found');

    const jsonTiers = this._getPricingFeaturesFromCourse(course);
    if (jsonTiers.length) {
      const matched = this._findMatchingCompanyFeatureTier(jsonTiers, seatsCount);

      if (matched) {
        const totalAmount = matched.price;
        return {
          tier: null,
          source: 'companyFeatures',
          minUsers: matched.minUsers,
          maxUsers: matched.maxUsers,
          packagePrice: matched.price,
          pricePerUser: seatsCount > 0 ? Number((totalAmount / seatsCount).toFixed(2)) : totalAmount,
          currency: matched.currency,
          seatsCount,
          totalAmount,
        };
      }


      const maxDefined = Math.max(...jsonTiers.map(t => t.maxUsers ?? t.minUsers));
      throw new Error(
        `No company pricing tier covers ${seatsCount} users. Maximum supported in current pricing is ${maxDefined} users. Please contact support for a custom quote.`
      );
    }

    const tier = await prisma.coursePricingTier.findFirst({
      where: {
        courseId,
        isActive: true,
        minUsers: { lte: seatsCount },
        OR: [{ maxUsers: null }, { maxUsers: { gte: seatsCount } }],
      },
      orderBy: { minUsers: 'desc' },
    });

    if (tier) {
      return {
        tier,
        source: 'pricingTiers',
        minUsers: tier.minUsers,
        maxUsers: tier.maxUsers,
        pricePerUser: tier.pricePerUser,
        seatsCount,
        totalAmount: tier.pricePerUser * seatsCount,
      };
    }

    const flatPrice = Number.isFinite(course.basePrice) && course.basePrice > 0
      ? course.basePrice
      : course.price;

    if (Number.isFinite(flatPrice) && flatPrice > 0) {
      return {
        tier: null,
        source: 'basePrice',
        minUsers: 1,
        maxUsers: null,
        pricePerUser: flatPrice,
        seatsCount,
        totalAmount: flatPrice * seatsCount,
      };
    }

    throw new Error(`No pricing tier found for ${seatsCount} users and course base price is not configured. Please configure course pricing tiers first.`);
  }

  async _getOrCreateStripeCustomer(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true, stripeCustomerId: true },
    });
    if (!user) throw new Error('User not found');

    if (user.stripeCustomerId) {
      try {
        await stripe.customers.retrieve(user.stripeCustomerId);
        return user.stripeCustomerId;
      } catch (err) {
        if (err.message?.includes('No such customer')) {
          await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: null } });
        } else throw err;
      }
    }

    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    const customer = await stripe.customers.create({ email: user.email, name, metadata: { userId } });
    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
    log.info(`Stripe customer created: ${customer.id} for user ${userId}`);
    return customer.id;
  }

  async _resolveCoupon(couponCode, tenantId, applicableType = 'COURSE') {
    if (!couponCode) return null;
    const coupon = await prisma.coupon.findUnique({ where: { code: couponCode }, select: { id: true, discountType: true, discountValue: true, maxUses: true, usedCount: true, expiresAt: true, applicableTo: true, isActive: true, tenantId: true } });
    if (!coupon) throw new Error('Coupon not found');
    if (!coupon.isActive) throw new Error('Coupon is not active');
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new Error('Coupon has expired');
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) throw new Error('Coupon usage limit reached');
    if (coupon.applicableTo !== applicableType) throw new Error(`Coupon is not applicable to ${applicableType.toLowerCase()}s`);
    if (coupon.tenantId && coupon.tenantId !== tenantId) throw new Error('Coupon is not valid for this tenant');
    return coupon;
  }

  _applyDiscount(price, coupon) {
    if (!coupon) return price;
    if (coupon.discountType === 'PERCENT') return Math.max(0, price - (price * coupon.discountValue) / 100);
    if (coupon.discountType === 'FIXED') return Math.max(0, price - coupon.discountValue);
    return price;
  }

  async _recordLicenseIncomeForCoursePayment(tx, { paymentId, courseId, grossAmount }) {
    if (!paymentId || !courseId || !Number.isFinite(grossAmount) || grossAmount <= 0) return null;

    const course = await tx.course.findUnique({ where: { id: courseId }, select: { tenantId: true } });
    if (!course?.tenantId) return null;

    const license = await tx.license.findFirst({ where: { tenantId: course.tenantId }, select: { id: true } });
    if (!license) return null;

    const existingIncome = await tx.licenseeIncome.findFirst({
      where: { paymentId, courseId, licenseId: license.id },
      select: { id: true },
    });
    if (existingIncome) return existingIncome;

    return tx.licenseeIncome.create({
      data: {
        licenseId: license.id, paymentId, courseId, grossAmount,
        platformFeePercent: 0, platformFeeAmount: 0, licenseeAmount: grossAmount, currency: 'EUR',
      },
    });
  }

  async createCourseCheckout({ userId, courseId, couponCode = null }) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, tenantId: true } });
    if (!user) throw new Error('User not found');

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, courseTitle: true, slug: true, price: true, basePrice: true, isActive: true, validityDays: true, tenantId: true },
    });
    if (!course) throw new Error('Course not found');
    if (!course.isActive) throw new Error('Course is not active');

    const existingEnrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true, status: true } });
    if (existingEnrollment) throw new Error(existingEnrollment.status === 'COMPLETED' ? 'You have already completed this course' : 'You are already enrolled in this course');

    const coupon = await this._resolveCoupon(couponCode, course.tenantId);

    const originalPrice = Number.isFinite(course.basePrice) && course.basePrice > 0 ? course.basePrice : course.price;
    const finalPrice = this._applyDiscount(originalPrice, coupon);
    const courseTitle = course.courseTitle?.en || course.courseTitle?.it || Object.values(course.courseTitle || {})[0] || 'Course';

    if (finalPrice <= 0) {
      const expiresAt = addDays(new Date(), course.validityDays || 90);
      const enrollment = await prisma.$transaction(async (tx) => {
        const newEnrollment = await tx.enrollment.create({ data: { courseId, userId, expiresAt, status: 'NOT_STARTED' }, include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, course: { select: { id: true, slug: true, courseTitle: true, tenantId: true } } } });
        await tx.payment.create({ data: { userId, enrollmentId: newEnrollment.id, type: 'SINGLE_COURSE', status: 'SUCCESS', amount: 0, currency: 'EUR', tenantId: course.tenantId, ...(coupon && { couponId: coupon.id }) } });
        if (coupon) await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
        return newEnrollment;
      });
      return { type: 'FREE', enrollment, message: 'Successfully enrolled in free course' };
    }

    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId, payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: courseTitle, description: `Course enrollment — ${course.slug}`, metadata: { courseId, userId } }, unit_amount: Math.round(finalPrice * 100) }, quantity: 1 }],
      mode: 'payment',
      success_url: `${clientUrl}/courses/${course.slug}?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${clientUrl}/courses/${course.slug}?canceled=true`,
      metadata: { userId, courseId, type: 'SINGLE_COURSE', couponId: coupon?.id ?? '', tenantId: course.tenantId ?? '' },
    });
    await prisma.payment.create({ data: { userId, type: 'SINGLE_COURSE', status: 'PENDING', amount: finalPrice, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId, tenantId: course.tenantId, ...(coupon && { couponId: coupon.id }) } });
    return { type: 'PAID', url: session.url, sessionId: session.id, originalPrice, finalPrice, discount: originalPrice - finalPrice };
  }

  async createLicensePayment(data) {
    const { userId, licenseId, planId, amount, billingCycle, couponCode, vatPercentage = 22, tenantId } = data;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true, stripeCustomerId: true } });
    if (!user) throw new Error('User not found');
    const plan = await prisma.licensePlan.findUnique({ where: { id: planId }, select: { id: true, tier: true, name: true } });
    if (!plan) throw new Error('Plan not found');
    const coupon = await this._resolveCoupon(couponCode, tenantId, 'LICENSE');
    const finalPrice = this._applyDiscount(amount, coupon);
    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';
    const planName = plan.name?.en || plan.name?.it || plan.tier;
    const billingText = billingCycle === 'MONTHLY' ? 'Monthly' : 'Annual';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId, payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `${planName} License - ${billingText}`, description: `License plan: ${plan.tier} | ${billingCycle}`, metadata: { licenseId: licenseId || '', userId, planId, type: 'LICENSE', billingCycle } }, unit_amount: Math.round(finalPrice * 100) }, quantity: 1 }],
      mode: 'payment',
      success_url: `${clientUrl}/license/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/license/cancel?canceled=true`,
      metadata: { userId, licenseId: licenseId || '', planId, type: 'LICENSE', billingCycle, couponId: coupon?.id ?? '', tenantId: tenantId ?? '', vatPercentage: String(vatPercentage) },
    });
    const payment = await prisma.payment.create({ data: { userId, type: 'LICENSE', status: 'PENDING', amount: finalPrice, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId, tenantId: tenantId ?? null, ...(coupon && { couponId: coupon.id }) } });
    return { payment, checkoutUrl: session.url, sessionId: session.id };
  }

  async _createLicenseFromPayment({ userId, plan, billingCycle, paymentId, metadata }) {
    const { companyName, phoneNumber, emailAddress, certifiedEmail, vatNumber, subdomain, customDomain, tenantId: metadataTenantId } = metadata;
    if (!subdomain || !customDomain) throw new Error('subdomain and customDomain must be provided from checkout payload.');

    return prisma.$transaction(async (tx) => {
      const existingLicense = await tx.license.findUnique({ where: { userId }, select: { id: true } });
      if (existingLicense) throw new Error('User already has a license');

      let tenantId = metadataTenantId;
      if (!tenantId) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { tenantId: true } });
        if (!user.tenantId) {
          const tenant = await tx.tenant.create({ data: { name: `${companyName || 'My'} Academy`, subdomain, customDomain, primaryColor: '#0F62FE', isActive: true, ownerId: userId } });
          tenantId = tenant.id;
          await tx.user.update({ where: { id: userId }, data: { tenantId } });
        } else tenantId = user.tenantId;
      }

      const startsAt = new Date();
      const expiresAt = addDays(startsAt, billingCycle === 'YEARLY' ? 365 : 30);
      const license = await tx.license.create({
        data: { userId, tenantId, planId: plan.id, paymentId, companyName: companyName || null, phoneNumber: phoneNumber || null, emailAddress: emailAddress || null, certifiedEmail: certifiedEmail || null, subdomain, customDomain, billingCycle, maxUsers: plan.maxUsers, maxCourses: plan.maxCourses, storageMb: plan.storageMb, vatNumber: vatNumber || null, vatPercentage: parseFloat(metadata.vatPercentage) || 22, priceAtPurchase: plan.priceAnnual || plan.priceMonthly * 12, startsAt, expiresAt, autoRenew: false, isSuspended: false },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } }, tenant: { select: { id: true, name: true, subdomain: true, customDomain: true } }, plan: true, payment: true },
      });
      log.info(`License created from payment: ${license.id} with payment: ${paymentId}`);
      return license;
    });
  }

  async createLicenseRenewalPayment(data) {
    const { userId, licenseId, planId, amount, billingCycle, couponCode, vatPercentage = 22, tenantId } = data;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true, stripeCustomerId: true } });
    if (!user) throw new Error('User not found');
    const plan = await prisma.licensePlan.findUnique({ where: { id: planId }, select: { id: true, tier: true, name: true } });
    if (!plan) throw new Error('Plan not found');
    const coupon = await this._resolveCoupon(couponCode, tenantId, 'LICENSE');
    const finalPrice = this._applyDiscount(amount, coupon);
    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';
    const planName = plan.name?.en || plan.name?.it || plan.tier;

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId, payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `${planName} License Renewal`, description: `Renewal - ${plan.tier} | ${billingCycle}`, metadata: { licenseId, userId, planId, type: 'LICENSE_RENEWAL', billingCycle } }, unit_amount: Math.round(finalPrice * 100) }, quantity: 1 }],
      mode: 'payment', success_url: `${clientUrl}/license/renewal/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${clientUrl}/license/renewal/cancel?canceled=true`,
      metadata: { userId, licenseId, planId, type: 'LICENSE_RENEWAL', billingCycle, couponId: coupon?.id ?? '', tenantId: tenantId ?? '', vatPercentage: String(vatPercentage) },
    });
    const payment = await prisma.payment.create({ data: { userId, type: 'LICENSE', status: 'PENDING', amount: finalPrice, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId, tenantId: tenantId ?? null, ...(coupon && { couponId: coupon.id }) } });
    return { payment, checkoutUrl: session.url, sessionId: session.id };
  }

  async createLicenseCheckout(data) {
    const { userId, planId, amount, billingCycle, couponCode, companyName, subdomain, customDomain, phoneNumber, emailAddress, certifiedEmail, vatNumber, vatPercentage = 22, tenantId } = data;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true, stripeCustomerId: true } });
    if (!user) throw new Error('User not found');
    const plan = await prisma.licensePlan.findUnique({ where: { id: planId, isActive: true }, select: { id: true, tier: true, name: true } });
    if (!plan) throw new Error('Plan not found');
    const coupon = await this._resolveCoupon(couponCode, tenantId, 'LICENSE');
    const finalPrice = this._applyDiscount(amount, coupon);
    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';
    const planName = plan.name?.en || plan.name?.it || plan.tier;

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId, payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `${planName} License - ${billingCycle}`, description: `New license purchase - ${plan.tier}`, metadata: { userId, planId, type: 'LICENSE_PURCHASE', billingCycle } }, unit_amount: Math.round(finalPrice * 100) }, quantity: 1 }],
      mode: 'payment', success_url: `${clientUrl}/license/purchase/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${clientUrl}/license/purchase/cancel?canceled=true`,
      metadata: { userId, planId, type: 'LICENSE_PURCHASE', billingCycle, couponId: coupon?.id ?? '', tenantId: tenantId ?? '', vatPercentage: String(vatPercentage), companyName: companyName || '', subdomain: subdomain || '', customDomain: customDomain || '', phoneNumber: phoneNumber || '', emailAddress: emailAddress || '', certifiedEmail: certifiedEmail || '', vatNumber: vatNumber || '' },
    });
    const payment = await prisma.payment.create({ data: { userId, type: 'LICENSE', status: 'PENDING', amount: finalPrice, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId, tenantId: tenantId ?? null, ...(coupon && { couponId: coupon.id }) } });
    return { payment, checkoutUrl: session.url, sessionId: session.id };
  }

  async createLicenseRenewalCheckout(data) {
    const { userId, licenseId, planId, amount, billingCycle, couponCode, vatPercentage = 22, tenantId, currentPlanTier, newPlanTier } = data;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true, stripeCustomerId: true } });
    if (!user) throw new Error('User not found');
    const plan = await prisma.licensePlan.findUnique({ where: { id: planId, isActive: true }, select: { id: true, tier: true, name: true } });
    if (!plan) throw new Error('Plan not found');
    const coupon = await this._resolveCoupon(couponCode, tenantId, 'LICENSE');
    const finalPrice = this._applyDiscount(amount, coupon);
    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';
    const planName = plan.name?.en || plan.name?.it || plan.tier;
    const upgradeText = currentPlanTier && currentPlanTier !== newPlanTier ? ` (Upgrade from ${currentPlanTier} to ${newPlanTier})` : '';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId, payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `${planName} License Renewal${upgradeText}`, description: `Renewal - ${plan.tier} | ${billingCycle}`, metadata: { licenseId, userId, planId, type: 'LICENSE_RENEWAL', billingCycle } }, unit_amount: Math.round(finalPrice * 100) }, quantity: 1 }],
      mode: 'payment', success_url: `${clientUrl}/license/renewal/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${clientUrl}/license/renewal/cancel?canceled=true`,
      metadata: { userId, licenseId, planId, type: 'LICENSE_RENEWAL', billingCycle, couponId: coupon?.id ?? '', tenantId: tenantId ?? '', vatPercentage: String(vatPercentage), currentPlanTier: currentPlanTier || '', newPlanTier: newPlanTier || '' },
    });
    const payment = await prisma.payment.create({ data: { userId, type: 'LICENSE', status: 'PENDING', amount: finalPrice, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId, tenantId: tenantId ?? null, ...(coupon && { couponId: coupon.id }) } });
    return { payment, checkoutUrl: session.url, sessionId: session.id };
  }



  async createCompanyCourseCheckout({ userId, courseId, tierId = null, minUsers = null, maxUsers = null, seatsCount = null, couponCode = null }) {
    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, companyId: true },
    });
    if (!requester) throw new Error('User not found');
    if (!requester.companyId) throw new Error('Only company accounts can purchase corporate access');

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, courseTitle: true, slug: true, isActive: true, validityDays: true, tenantId: true },
    });
    if (!course) throw new Error('Course not found');
    if (!course.isActive) throw new Error('Course is not active');

    // ✅ tierId দিয়ে exact pricing tier resolve করা হবে (frontend শুধু tierId পাঠাবে)
    const pricing = await this._resolveCompanyPurchasePricing({ courseId, tierId, minUsers, maxUsers, seatsCount });

    const coupon = await this._resolveCoupon(couponCode, course.tenantId, 'COURSE');
    const finalTotal = this._applyDiscount(pricing.totalAmount, coupon);
    const courseTitle = course.courseTitle?.en || course.courseTitle?.it || Object.values(course.courseTitle || {})[0] || 'Course';

    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${courseTitle} — Corporate (${pricing.seatsCount} users)`,
            description: `€${pricing.pricePerUser}/user × ${pricing.seatsCount} users — package ${pricing.minUsers}-${pricing.maxUsers ?? '∞'}`,
            metadata: { courseId, companyId: requester.companyId, seatsCount: String(pricing.seatsCount), userId },
          },
          unit_amount: Math.round(finalTotal * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${clientUrl}/company/corporate-courses?session_id={CHECKOUT_SESSION_ID}&purchased=true`,
      cancel_url: `${clientUrl}/courses/${course.slug}?canceled=true`,
      metadata: {
        userId, courseId, companyId: requester.companyId,
        seatsCount: String(pricing.seatsCount), pricePerUser: String(pricing.pricePerUser),
        tierId: pricing.tierId || '',
        tierMinUsers: String(pricing.minUsers), tierMaxUsers: pricing.maxUsers != null ? String(pricing.maxUsers) : '',
        pricingSource: pricing.source,
        type: 'COMPANY_COURSE_PURCHASE', couponId: coupon?.id ?? '', tenantId: course.tenantId ?? '',
      },
    });

    const payment = await prisma.payment.create({
      data: {
        userId, companyId: requester.companyId, type: 'SINGLE_COURSE', status: 'PENDING',
        amount: finalTotal, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId,
        tenantId: course.tenantId, ...(coupon && { couponId: coupon.id }),
      },
    });

    log.info(`Company course checkout: course=${courseId} tierId=${pricing.tierId || 'legacy'} tier=${pricing.minUsers}-${pricing.maxUsers ?? '∞'} seats=${pricing.seatsCount} price=${pricing.pricePerUser}(${pricing.source}) company=${requester.companyId}`);
    return {
      payment, checkoutUrl: session.url, sessionId: session.id,
      pricePerUser: pricing.pricePerUser, totalAmount: finalTotal, tierId: pricing.tierId,
      seatsCount: pricing.seatsCount, minUsers: pricing.minUsers, maxUsers: pricing.maxUsers,
    };
  }

  async verifyCompanyCoursePurchase(sessionId, userId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return { paid: false, message: 'Payment not completed yet' };

    const metadata = session.metadata || {};
    const sessionType = this._pickMetadataValue(metadata, ['type']);
    if (sessionType && sessionType !== 'COMPANY_COURSE_PURCHASE') {
      throw new Error(`Invalid checkout session type for this endpoint: ${sessionType}. Use /payments/verify for single-course payments.`);
    }

    const requester = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, level: true, companyId: true },
    });
    if (!requester) throw new Error('User not found');

    let payment = await prisma.payment.findFirst({
      where: { stripeSessionId: sessionId },
      select: { id: true, amount: true, companyId: true, status: true, userId: true },
    });

    if (!payment) {
      const fallbackCompanyId = this._pickMetadataValue(metadata, ['companyId', 'company_id']) || requester.companyId;
      if (!fallbackCompanyId) throw new Error('Payment record not found for this checkout session');

      if (requester.level !== 'PLATFORM_ADMIN' && requester.companyId !== fallbackCompanyId) {
        throw new Error('Permission denied: not your company purchase');
      }

      const amountCents = typeof session.amount_total === 'number'
        ? session.amount_total
        : (typeof session.amount_subtotal === 'number' ? session.amount_subtotal : 0);

      payment = await prisma.payment.create({
        data: {
          userId: this._pickMetadataValue(metadata, ['userId']) || requester.id,
          companyId: fallbackCompanyId,
          type: 'SINGLE_COURSE',
          status: 'SUCCESS',
          amount: Number((amountCents / 100).toFixed(2)),
          currency: (session.currency || 'eur').toUpperCase(),
          stripeSessionId: sessionId,
          stripePaymentIntentId: session.payment_intent ?? '',
          stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
          tenantId: this._pickMetadataValue(metadata, ['tenantId']) || null,
          ...(this._pickMetadataValue(metadata, ['couponId', 'coupon_id']) && { couponId: this._pickMetadataValue(metadata, ['couponId', 'coupon_id']) }),
        },
        select: { id: true, amount: true, companyId: true, status: true, userId: true },
      });
    }

    let courseId = this._pickMetadataValue(metadata, ['courseId']);
    const companyId = this._pickMetadataValue(metadata, ['companyId', 'company_id']) || payment.companyId || requester.companyId;
    const couponId = this._pickMetadataValue(metadata, ['couponId', 'coupon_id']);

    let seats = this._parsePositiveInt(this._pickMetadataValue(metadata, ['seatsCount', 'seatsTotal', 'seatCount']));
    if (!seats || !courseId) {
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 1, expand: ['data.price.product'] });
        const product = lineItems.data?.[0]?.price?.product;
        if (product && typeof product === 'object') {
          const productMetadata = product.metadata || {};
          if (!courseId) courseId = this._pickMetadataValue(productMetadata, ['courseId']);
          if (!seats) seats = this._parsePositiveInt(this._pickMetadataValue(productMetadata, ['seatsCount', 'seatsTotal', 'seatCount']));
        }
      } catch (error) {
        log.warn(`Unable to read Stripe line items for session ${sessionId}: ${error.message}`);
      }
    }

    let pricePerUser = this._parseNonNegativeFloat(this._pickMetadataValue(metadata, ['pricePerUser', 'perSeatPrice']));
    if (!pricePerUser && seats) {
      pricePerUser = Number((payment.amount / seats).toFixed(2));
    }

    const tierMaxUsers = this._parsePositiveInt(this._pickMetadataValue(metadata, ['tierMaxUsers']));

    if (!courseId) throw new Error('Missing courseId in checkout session metadata');
    if (!companyId) throw new Error('Missing companyId for corporate purchase');
    if (!seats) throw new Error('Missing or invalid seats count in checkout session metadata. Make sure this session was created via /payments/checkout/company-course.');
    if (pricePerUser === null) throw new Error('Missing or invalid price per user in checkout session metadata');

    if (requester.level !== 'PLATFORM_ADMIN' && requester.companyId !== companyId) {
      throw new Error('Permission denied: not your company purchase');
    }

    const updateResult = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'SUCCESS', stripePaymentIntentId: session.payment_intent ?? '' },
    });

    if (updateResult.count === 0) {
      const existing = await prisma.companyCoursePurchase.findFirst({
        where: { paymentId: payment.id },
        include: { course: true },
      });
      return { paid: true, alreadyProcessed: true, purchase: existing };
    }

    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { validityDays: true } });
    if (!course) throw new Error('Course not found for this payment');
    if (couponId) await prisma.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });

    const expiresAt = addDays(new Date(), course.validityDays || 90);

    const purchase = await prisma.companyCoursePurchase.create({
      data: {
        courseId, companyId, seatsTotal: seats, seatsUsed: 0,
        pricePerUser, totalAmount: payment.amount,
        expiresAt, paymentId: payment.id,
      },
      include: { course: { select: { id: true, courseTitle: true } } },
    });

    // ✅ NEW: auto-enroll the purchasing user as their own first seat
    const buyerId = this._pickMetadataValue(metadata, ['userId']) || payment.userId;
    if (buyerId) {
      try {
        const alreadyEnrolled = await prisma.enrollment.findUnique({
          where: { userId_courseId: { userId: buyerId, courseId } },
          select: { id: true },
        });

        if (!alreadyEnrolled) {
          await prisma.$transaction(async (tx) => {
            await tx.enrollment.create({
              data: {
                userId: buyerId,
                courseId,
                companyCoursePurchaseId: purchase.id,
                companyContextId: companyId,
                expiresAt: purchase.expiresAt,
                status: 'NOT_STARTED',
              },
            });
            await tx.companyCoursePurchase.update({
              where: { id: purchase.id },
              data: { seatsUsed: { increment: 1 } },
            });
          });
          purchase.seatsUsed = 1; // keep the returned object in sync for the response
          log.info(`Auto-enrolled buyer ${buyerId} in company purchase ${purchase.id}`);
        }
      } catch (err) {
        // Never let auto-enroll failure block the purchase itself — purchase already succeeded.
        log.error(`Auto-enroll buyer failed for purchase ${purchase.id}: ${err.message}`);
      }
    }

    await this._recordLicenseIncomeForCoursePayment(prisma, { paymentId: payment.id, courseId, grossAmount: payment.amount });

    const companyAdmins = await prisma.user.findMany({ where: { companyId, level: 'COMPANY_ADMIN' }, select: { id: true, email: true } });
    for (const admin of companyAdmins) {
      notificationService.notifyPackageReady?.({
        userId: admin.id, email: admin.email, packageName: purchase.course.courseTitle, seatsTotal: seats,
      }).catch(() => { });
    }

    log.info(`Company course purchase created: ${purchase.id} — ${seats} seats (tierMaxUsers=${tierMaxUsers ?? 'n/a'})`);
    return { paid: true, type: 'company_course_purchase', purchase, payment };
  }

  async createCourseRenewalCheckout({ userId, enrollmentId, couponCode = null }) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      include: { course: { select: { id: true, courseTitle: true, slug: true, price: true, basePrice: true, isActive: true, validityDays: true, tenantId: true } } },
    });

    if (!enrollment) throw new Error('Enrollment not found');
    if (enrollment.userId !== userId) throw new Error('Permission denied: not your enrollment');
    if (enrollment.companyCoursePurchaseId) throw new Error('This enrollment is part of a corporate purchase. Ask your company admin to renew it.');
    if (!enrollment.course.isActive) throw new Error('This course is no longer available for renewal');
    if (enrollment.status === 'COMPLETED') throw new Error('Course already completed — no renewal needed');

    const coupon = await this._resolveCoupon(couponCode, enrollment.course.tenantId, 'COURSE');
    const originalPrice = Number.isFinite(enrollment.course.basePrice) && enrollment.course.basePrice > 0
      ? enrollment.course.basePrice
      : enrollment.course.price;
    const finalPrice = this._applyDiscount(originalPrice, coupon);
    const courseTitle = enrollment.course.courseTitle?.en || enrollment.course.courseTitle?.it || Object.values(enrollment.course.courseTitle || {})[0] || 'Course';

    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `${courseTitle} — Renewal`, description: `Course access renewal — ${enrollment.course.slug}`, metadata: { enrollmentId, courseId: enrollment.course.id, userId } },
          unit_amount: Math.round(finalPrice * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${clientUrl}/my-courses/${enrollment.course.slug}?session_id={CHECKOUT_SESSION_ID}&renewed=true`,
      cancel_url: `${clientUrl}/my-courses/${enrollment.course.slug}?canceled=true`,
      metadata: { userId, enrollmentId, courseId: enrollment.course.id, type: 'COURSE_RENEWAL', couponId: coupon?.id ?? '', tenantId: enrollment.course.tenantId ?? '' },
    });

    const payment = await prisma.payment.create({
      data: { userId, type: 'SINGLE_COURSE', status: 'PENDING', amount: finalPrice, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId, tenantId: enrollment.course.tenantId, ...(coupon && { couponId: coupon.id }) },
    });

    log.info(`Course renewal checkout created: enrollment=${enrollmentId} payment=${payment.id}`);
    return { payment, checkoutUrl: session.url, sessionId: session.id, originalPrice, finalPrice };
  }

  async verifyCourseRenewalPayment(sessionId, userId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return { paid: false, message: 'Payment not completed yet' };

    const metadata = session.metadata || {};
    const sessionType = this._pickMetadataValue(metadata, ['type']);
    if (sessionType && sessionType !== 'COURSE_RENEWAL') {
      throw new Error(`Invalid checkout session type for this endpoint: ${sessionType}. Use /payments/verify for single-course purchases.`);
    }
    const enrollmentId = this._pickMetadataValue(metadata, ['enrollmentId']);
    const couponId = this._pickMetadataValue(metadata, ['couponId', 'coupon_id']);
    if (!enrollmentId) throw new Error('Missing enrollmentId in checkout session metadata');

    const updateResult = await prisma.payment.updateMany({
      where: { stripeSessionId: sessionId, userId, status: 'PENDING' },
      data: { status: 'SUCCESS', stripePaymentIntentId: session.payment_intent ?? '' },
    });

    if (updateResult.count === 0) {
      log.info(`Course renewal session ${sessionId} already processed`);
      const existingRenewal = await prisma.courseRenewal.findFirst({
        where: { enrollmentId, payment: { stripeSessionId: sessionId } },
        orderBy: { createdAt: 'desc' },
        include: { enrollment: { include: { course: true } } },
      });
      return { paid: true, alreadyProcessed: true, renewal: existingRenewal };
    }

    const payment = await prisma.payment.findFirst({ where: { stripeSessionId: sessionId, userId } });
    if (!payment) throw new Error('Payment record not found for this checkout session');

    const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId }, include: { course: { select: { validityDays: true } } } });
    if (!enrollment) throw new Error('Enrollment not found');

    if (couponId) await prisma.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });

    const validityDays = enrollment.course.validityDays || 90;
    const baseDate = enrollment.expiresAt > new Date() ? enrollment.expiresAt : new Date();
    const newExpiresAt = addDays(baseDate, validityDays);

    const result = await prisma.$transaction(async (tx) => {
      const renewal = await tx.courseRenewal.create({
        data: { enrollmentId, previousExpiresAt: enrollment.expiresAt, newExpiresAt, amount: payment.amount, paymentId: payment.id },
      });

      const updatedEnrollment = await tx.enrollment.update({
        where: { id: enrollmentId },
        data: { expiresAt: newExpiresAt, ...(enrollment.status === 'EXPIRED' && { status: 'IN_PROGRESS' }) },
        include: { course: { select: { id: true, slug: true, courseTitle: true } } },
      });

      await this._recordLicenseIncomeForCoursePayment(tx, { paymentId: payment.id, courseId: enrollment.courseId, grossAmount: payment.amount });

      return { renewal, updatedEnrollment };
    });

    log.info(`Enrollment ${enrollmentId} renewed until ${newExpiresAt.toISOString()}`);
    return { paid: true, type: 'course_renewal', ...result, payment };
  }


  async createCompanyCourseRenewalCheckout({ userId, companyCoursePurchaseId, tierId = null, minUsers = null, maxUsers = null, newSeatsCount = null, couponCode = null }) {
    const purchase = await prisma.companyCoursePurchase.findUnique({
      where: { id: companyCoursePurchaseId },
      include: {
        course: { select: { id: true, courseTitle: true, slug: true, isActive: true, tenantId: true } },
        company: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
    });

    if (!purchase) throw new Error('Corporate purchase not found');
    if (!purchase.course.isActive) throw new Error('This course is no longer available for renewal');

    const requester = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true, level: true } });
    if (requester?.level !== 'PLATFORM_ADMIN' && requester?.companyId !== purchase.companyId) {
      throw new Error('Permission denied: not your company purchase');
    }

    const currentUsedSeats = purchase._count.enrollments;

    const pricing = await this._resolveCompanyRenewalPricing({
      courseId: purchase.courseId,
      tierId,
      minUsers,
      maxUsers,
      currentSeatsTotal: newSeatsCount || purchase.seatsTotal,
    });

    if (pricing.seatsCount < currentUsedSeats) {
      throw new Error(`Cannot renew with ${pricing.seatsCount} seats — ${currentUsedSeats} employees are already assigned. Remove employees first or select a larger package.`);
    }

    const coupon = await this._resolveCoupon(couponCode, purchase.course.tenantId, 'COURSE');
    const finalTotal = this._applyDiscount(pricing.totalAmount, coupon);
    const courseTitle = purchase.course.courseTitle?.en || purchase.course.courseTitle?.it || Object.values(purchase.course.courseTitle || {})[0] || 'Course';

    const stripeCustomerId = await this._getOrCreateStripeCustomer(userId);
    const clientUrl = config.CLIENT_URL || '';

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${courseTitle} — Corporate Renewal (${pricing.seatsCount} users)`,
            description: `€${pricing.pricePerUser}/user × ${pricing.seatsCount} users — ${purchase.company?.name || 'Company'}`,
            metadata: { companyCoursePurchaseId, courseId: purchase.courseId, companyId: purchase.companyId, userId },
          },
          unit_amount: Math.round(finalTotal * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${clientUrl}/company/corporate-courses/${companyCoursePurchaseId}?session_id={CHECKOUT_SESSION_ID}&renewed=true`,
      cancel_url: `${clientUrl}/company/corporate-courses/${companyCoursePurchaseId}?canceled=true`,
      metadata: {
        userId, companyCoursePurchaseId, courseId: purchase.courseId, companyId: purchase.companyId,
        seatsCount: String(pricing.seatsCount), pricePerUser: String(pricing.pricePerUser),
        tierId: pricing.tierId || '',
        tierMinUsers: String(pricing.minUsers), tierMaxUsers: pricing.maxUsers != null ? String(pricing.maxUsers) : '',
        type: 'COMPANY_COURSE_RENEWAL', couponId: coupon?.id ?? '', tenantId: purchase.course.tenantId ?? '',
      },
    });

    const payment = await prisma.payment.create({
      data: {
        userId, companyId: purchase.companyId, type: 'SINGLE_COURSE', status: 'PENDING',
        amount: finalTotal, currency: 'EUR', stripeSessionId: session.id, stripeCustomerId,
        tenantId: purchase.course.tenantId, ...(coupon && { couponId: coupon.id }),
      },
    });

    log.info(`Company renewal checkout: purchase=${companyCoursePurchaseId} tierId=${pricing.tierId || 'legacy'} seats=${pricing.seatsCount} price=${pricing.pricePerUser}(${pricing.source})`);
    return {
      payment, checkoutUrl: session.url, sessionId: session.id,
      pricePerUser: pricing.pricePerUser, totalAmount: finalTotal, seatsCount: pricing.seatsCount,
    };
  }

  async verifyCompanyCourseRenewalPayment(sessionId, userId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return { paid: false, message: 'Payment not completed yet' };

    const requester = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, level: true, companyId: true } });
    if (!requester) throw new Error('User not found');

    const metadata = session.metadata || {};
    const sessionType = this._pickMetadataValue(metadata, ['type']);
    if (sessionType && sessionType !== 'COMPANY_COURSE_RENEWAL') {
      throw new Error(`Invalid checkout session type for this endpoint: ${sessionType}. Use the matching verify endpoint.`);
    }
    const companyCoursePurchaseId = this._pickMetadataValue(metadata, ['companyCoursePurchaseId']);
    const couponId = this._pickMetadataValue(metadata, ['couponId', 'coupon_id']);
    const newSeatsTotal = this._parsePositiveInt(this._pickMetadataValue(metadata, ['seatsCount', 'seatsTotal', 'seatCount']));
    const newPricePerUser = this._parseNonNegativeFloat(this._pickMetadataValue(metadata, ['pricePerUser', 'perSeatPrice']));

    if (!companyCoursePurchaseId) throw new Error('Missing companyCoursePurchaseId in checkout session metadata');
    if (!newSeatsTotal) throw new Error('Missing or invalid seats count in checkout session metadata');
    if (newPricePerUser === null) throw new Error('Missing or invalid price per user in checkout session metadata');

    const payment = await prisma.payment.findFirst({
      where: { stripeSessionId: sessionId },
      select: { id: true, companyId: true, status: true, amount: true },
    });
    if (!payment) throw new Error('Payment record not found for this checkout session');

    if (requester.level !== 'PLATFORM_ADMIN' && requester.companyId !== payment.companyId) {
      throw new Error('Permission denied: not your company purchase');
    }

    const updateResult = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'SUCCESS', stripePaymentIntentId: session.payment_intent ?? '' },
    });

    if (updateResult.count === 0) {
      log.info(`Company renewal session ${sessionId} already processed`);
      const existingRenewal = await prisma.companyCoursePurchaseRenewal.findFirst({
        where: { companyCoursePurchaseId, payment: { stripeSessionId: sessionId } },
        orderBy: { createdAt: 'desc' },
      });
      return { paid: true, alreadyProcessed: true, renewal: existingRenewal };
    }

    const purchase = await prisma.companyCoursePurchase.findUnique({
      where: { id: companyCoursePurchaseId },
      include: { course: { select: { validityDays: true } } },
    });
    if (!purchase) throw new Error('Corporate purchase not found');

    if (couponId) await prisma.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });

    const validityDays = purchase.course.validityDays || 90;
    const baseDate = purchase.expiresAt > new Date() ? purchase.expiresAt : new Date();
    const newExpiresAt = addDays(baseDate, validityDays);

    const result = await prisma.$transaction(async (tx) => {
      const renewal = await tx.companyCoursePurchaseRenewal.create({
        data: {
          companyCoursePurchaseId, previousExpiresAt: purchase.expiresAt, newExpiresAt,
          seatsTotal: newSeatsTotal, pricePerUser: newPricePerUser, amount: payment.amount, paymentId: payment.id,
        },
      });

      const updatedPurchase = await tx.companyCoursePurchase.update({
        where: { id: companyCoursePurchaseId },
        data: { expiresAt: newExpiresAt, seatsTotal: newSeatsTotal, pricePerUser: newPricePerUser, totalAmount: payment.amount },
      });

      await tx.enrollment.updateMany({
        where: { companyCoursePurchaseId, status: { in: ['NOT_STARTED', 'IN_PROGRESS', 'EXPIRED'] } },
        data: { expiresAt: newExpiresAt },
      });

      await tx.enrollment.updateMany({
        where: { companyCoursePurchaseId, status: 'EXPIRED' },
        data: { status: 'IN_PROGRESS' },
      });

      await this._recordLicenseIncomeForCoursePayment(tx, { paymentId: payment.id, courseId: purchase.courseId, grossAmount: payment.amount });

      return { renewal, updatedPurchase };
    });

    log.info(`Company purchase ${companyCoursePurchaseId} renewed until ${newExpiresAt.toISOString()}, all employee access extended`);
    return { paid: true, type: 'company_course_renewal', ...result, payment };
  }

  async verifyLicensePayment(sessionId, userId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return { paid: false, message: 'Payment not completed yet' };
    const { licenseId, planId, type, billingCycle, couponId, tenantId } = session.metadata;

    const updateResult = await prisma.payment.updateMany({ where: { stripeSessionId: sessionId, userId, status: 'PENDING' }, data: { status: 'SUCCESS', stripePaymentIntentId: session.payment_intent ?? '' } });
    if (updateResult.count === 0) {
      log.info(`License payment session ${sessionId} already processed`);
      if (type === 'LICENSE_PURCHASE') { const license = await prisma.license.findFirst({ where: { userId }, include: { plan: true, tenant: true } }); return { paid: true, alreadyProcessed: true, type: 'new_license', license }; }
      if (type === 'LICENSE_RENEWAL') { const renewal = await prisma.licenseRenewal.findFirst({ where: { licenseId, payment: { stripeSessionId: sessionId } }, orderBy: { createdAt: 'desc' }, include: { plan: true } }); return { paid: true, alreadyProcessed: true, type: 'renewal', renewal }; }
      return { paid: true, alreadyProcessed: true };
    }

    const payment = await prisma.payment.findFirst({ where: { stripeSessionId: sessionId, userId } });
    if (couponId) await prisma.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });

    if (type === 'LICENSE_PURCHASE') {
      const plan = await prisma.licensePlan.findUnique({ where: { id: planId } });
      if (!plan) throw new Error('Plan not found');
      const license = await this._createLicenseFromPayment({ userId, plan, billingCycle, paymentId: payment.id, metadata: session.metadata });
      return { paid: true, type: 'new_license', license, payment };
    }

    if (type === 'LICENSE_RENEWAL') {
      const license = await prisma.license.findUnique({ where: { id: licenseId }, include: { plan: true } });
      if (!license) throw new Error('License not found');
      const plan = await prisma.licensePlan.findUnique({ where: { id: planId } });
      if (!plan) throw new Error('Plan not found');
      const daysToAdd = billingCycle === 'YEARLY' ? 365 : 30;
      const newExpiresAt = addDays(license.expiresAt, daysToAdd);
      const renewal = await prisma.licenseRenewal.create({ data: { licenseId: license.id, previousExpiresAt: license.expiresAt, newExpiresAt, planId: plan.id, amount: payment.amount, paymentId: payment.id }, include: { plan: true } });
      const updatedLicense = await prisma.license.update({ where: { id: license.id }, data: { expiresAt: newExpiresAt, planId: plan.id, maxUsers: plan.maxUsers, maxCourses: plan.maxCourses, storageMb: plan.storageMb, billingCycle }, include: { plan: true, user: true } });
      return { paid: true, type: 'renewal', license: updatedLicense, renewal, payment };
    }
    return { paid: true, processed: true, payment };
  }

  async verifyAndEnroll(sessionId, userId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return { paid: false, message: 'Payment not completed yet' };
    const metadata = session.metadata || {};
    const sessionType = this._pickMetadataValue(metadata, ['type']);
    if (sessionType && sessionType !== 'SINGLE_COURSE') {
      throw new Error(`Invalid checkout session type for this endpoint: ${sessionType}. Use the matching verify endpoint.`);
    }
    const courseId = this._pickMetadataValue(metadata, ['courseId']);
    const couponId = this._pickMetadataValue(metadata, ['couponId', 'coupon_id']);
    if (!courseId) throw new Error('Missing courseId in checkout session metadata');
    const updateResult = await prisma.payment.updateMany({ where: { stripeSessionId: sessionId, userId, status: 'PENDING' }, data: { status: 'SUCCESS', stripePaymentIntentId: session.payment_intent ?? '' } });
    if (updateResult.count === 0) { const enrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, include: { course: { select: { id: true, slug: true, courseTitle: true } } } }); return { paid: true, alreadyProcessed: true, enrollment }; }
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, validityDays: true, isActive: true } });
    if (!course || !course.isActive) throw new Error('Course not found or inactive');
    const existingEnrollment = await prisma.enrollment.findUnique({ where: { userId_courseId: { userId, courseId } }, select: { id: true } });
    if (existingEnrollment) return { paid: true, alreadyProcessed: false, enrollment: existingEnrollment };
    const payment = await prisma.payment.findFirst({ where: { stripeSessionId: sessionId, userId }, select: { id: true, amount: true } });
    if (!payment) throw new Error('Payment record not found for this checkout session');

    const expiresAt = addDays(new Date(), course.validityDays || 90);
    const enrollment = await prisma.$transaction(async (tx) => {
      const newEnrollment = await tx.enrollment.create({ data: { courseId, userId, expiresAt, status: 'NOT_STARTED' }, include: { course: { select: { id: true, slug: true, courseTitle: true, tenantId: true } } } });
      await tx.payment.updateMany({ where: { stripeSessionId: sessionId, userId }, data: { enrollmentId: newEnrollment.id } });
      if (couponId) await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
      await this._recordLicenseIncomeForCoursePayment(tx, { paymentId: payment.id, courseId, grossAmount: payment.amount });
      return newEnrollment;
    });
    return { paid: true, alreadyProcessed: false, enrollment };
  }

  async getMyPayments(userId, queryParams = {}) {
    const page = parseInt(queryParams.page) || 1;
    const limit = Math.min(parseInt(queryParams.limit) || 10, 50);
    const skip = (page - 1) * limit;
    const where = { userId };
    if (queryParams.status) where.status = queryParams.status;
    if (queryParams.type) where.type = queryParams.type;
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit, include: { enrollment: { include: { course: { select: { id: true, slug: true, courseTitle: true, thumbnailUrl: true } } } }, coupon: { select: { code: true, discountType: true, discountValue: true } }, invoice: { select: { id: true, status: true, pdfUrl: true } }, courseRenewal: { select: { id: true } }, companyCoursePurchase: { select: { id: true } }, companyCoursePurchaseRenewal: { select: { id: true } } } }),
      prisma.payment.count({ where }),
    ]);
    const enrichedPayments = payments.map((payment) => {
      let flowType = payment.type;
      if (payment.companyCoursePurchase) flowType = 'COMPANY_COURSE_PURCHASE';
      else if (payment.companyCoursePurchaseRenewal) flowType = 'COMPANY_COURSE_RENEWAL';
      else if (payment.courseRenewal) flowType = 'COURSE_RENEWAL';
      return { ...payment, flowType };
    });
    return { meta: { page, limit, total, totalPages: Math.ceil(total / limit) }, payments: enrichedPayments };
  }

  async getAllPayments(queryParams = {}, user = null) {
    const page = parseInt(queryParams.page) || 1;
    const limit = Math.min(parseInt(queryParams.limit) || 20, 100);
    const skip = (page - 1) * limit;
    const where = {};
    if (user?.level === 'PLATFORM_ADMIN') { if (queryParams.tenantId) where.tenantId = queryParams.tenantId; }
    else if (user?.level === 'LICENSEE') { if (!user.tenantId) throw new Error('Licensee must have a tenant'); where.tenantId = user.tenantId; }
    else throw new Error('Access denied');
    if (queryParams.status) where.status = queryParams.status;
    if (queryParams.type) where.type = queryParams.type;
    const orderBy = { [queryParams.sortBy || 'createdAt']: queryParams.sortOrder === 'asc' ? 'asc' : 'desc' };
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy, skip, take: limit, include: { user: { select: { id: true, email: true, firstName: true, lastName: true, level: true } }, enrollment: { include: { course: { select: { id: true, slug: true, courseTitle: true } } } }, coupon: { select: { code: true, discountType: true, discountValue: true } }, courseRenewal: { select: { id: true } }, companyCoursePurchase: { select: { id: true } }, companyCoursePurchaseRenewal: { select: { id: true } } } }),
      prisma.payment.count({ where }),
    ]);
    const enrichedPayments = payments.map((payment) => {
      let flowType = payment.type;
      if (payment.companyCoursePurchase) flowType = 'COMPANY_COURSE_PURCHASE';
      else if (payment.companyCoursePurchaseRenewal) flowType = 'COMPANY_COURSE_RENEWAL';
      else if (payment.courseRenewal) flowType = 'COURSE_RENEWAL';
      return { ...payment, flowType };
    });
    return { meta: { page, limit, total, totalPages: Math.ceil(total / limit) }, payments: enrichedPayments };
  }

  async handleWebhook(rawBody, signature) {
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      if (session.payment_status === 'paid') {
        const metadata = session.metadata || {};
        const type = this._pickMetadataValue(metadata, ['type']);
        const userId = this._pickMetadataValue(metadata, ['userId']);

        try {
          switch (type) {
            case 'SINGLE_COURSE':
              await this.verifyAndEnroll(session.id, userId);
              break;

            case 'COMPANY_COURSE_PURCHASE':
              await this.verifyCompanyCoursePurchase(session.id, userId);
              break;

            case 'COURSE_RENEWAL':
              await this.verifyCourseRenewalPayment(session.id, userId);
              break;

            case 'COMPANY_COURSE_RENEWAL':
              await this.verifyCompanyCourseRenewalPayment(session.id, userId);
              break;

            case 'LICENSE_PURCHASE':
            case 'LICENSE_RENEWAL':
              await this.verifyLicensePayment(session.id, userId);
              break;

            default:
              log.warn(`Webhook: unrecognized checkout type "${type}" for session ${session.id}`);
          }
        } catch (err) {

          log.error(`Webhook processing failed (type=${type}, session=${session.id}): ${err.message}`);
        }
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      await prisma.payment.updateMany({
        where: { stripeSessionId: session.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
    }

    return { received: true };
  }
}

export const paymentService = new PaymentService();