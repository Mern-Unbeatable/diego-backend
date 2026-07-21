
import nodemailer from 'nodemailer';
import { Logger } from '../../../config/logger.js';
import { config } from '../../../config/config.js';

const log = new Logger('EmailService');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: Number(config.SMTP_PORT) || 587,
      secure: Number(config.SMTP_PORT) === 465,
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS,
      },
    });
  }

  async send({ to, subject, html, text }) {
    try {
      const info = await this.transporter.sendMail({
        from: `"LMS Platform" <${config.SMTP_FROM}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });
      log.info(`Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (err) {
      log.error(`Email send failed to ${to}:`, err.message);
      throw err;
    }
  }

  async sendCourseExpiryReminder({ to, userName, courseTitle, daysLeft, expiresAt }) {
    const subject = `⚠️ Course expiring in ${daysLeft} day(s): ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#e67e22">Course Expiry Reminder</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>Your course <strong>"${courseTitle}"</strong> will expire in <strong>${daysLeft} day(s)</strong>.</p>
        <p>Expiry date: <strong>${new Date(expiresAt).toLocaleDateString('it-IT')}</strong></p>
        <p>Please complete the course before it expires.</p>
        <hr/>
        <p style="color:#999;font-size:12px">You can manage notification preferences in your account settings.</p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCertificateExpiryReminder({ to, userName, courseTitle, daysLeft, expiresAt }) {
    const subject = `📄 Certificate expiring in ${daysLeft} day(s): ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#c0392b">Certificate Expiry Reminder</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>Your certificate for <strong>"${courseTitle}"</strong> will expire in <strong>${daysLeft} day(s)</strong>.</p>
        <p>Expiry date: <strong>${new Date(expiresAt).toLocaleDateString('it-IT')}</strong></p>
        <p>Please renew your training to maintain compliance.</p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCertificateReady({ to, userName, courseTitle, downloadUrl }) {
    const subject = `🎉 Your certificate is ready: ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#27ae60">Certificate Ready!</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>Congratulations! You have successfully completed <strong>"${courseTitle}"</strong>.</p>
        <p>Your certificate is now available for download.</p>
        ${downloadUrl ? `<p><a href="${downloadUrl}" style="background:#27ae60;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px">Download Certificate</a></p>` : ''}
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCourseAssigned({ to, userName, courseTitle, dueDate }) {
    const subject = `📚 New course assigned: ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2980b9">New Course Assigned</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>A new course has been assigned to you: <strong>"${courseTitle}"</strong>.</p>
        ${dueDate ? `<p>Due date: <strong>${new Date(dueDate).toLocaleDateString('it-IT')}</strong></p>` : ''}
        <p>Log in to the platform to start your training.</p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCourseAvailable({ to, userName, courseTitle }) {
    const subject = `🆕 New course available: ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#8e44ad">New Course Available</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>A new course is now available for you: <strong>"${courseTitle}"</strong>.</p>
        <p>Log in to begin your training.</p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendInactiveUserReminder({ to, userName, courseTitle }) {
    const subject = `⏰ Don't forget your course: ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#e67e22">Training Reminder</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>You haven't started your course <strong>"${courseTitle}"</strong> yet.</p>
        <p>Log in to the platform and begin your training today.</p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCompanyExpiryDigest({ to, companyName, expiringCount, courses }) {
    const subject = `📋 ${expiringCount} course(s) expiring soon for your employees`;
    const rows = courses.map(c =>
      `<tr><td>${c.employeeName}</td><td>${c.courseTitle}</td><td>${new Date(c.expiresAt).toLocaleDateString('it-IT')}</td><td>${c.daysLeft} days</td></tr>`
    ).join('');
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto">
        <h2 style="color:#e67e22">Employee Course Expiry Report</h2>
        <p>Hi <strong>${companyName}</strong> Admin,</p>
        <p><strong>${expiringCount}</strong> employee course(s) are expiring soon:</p>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
          <thead style="background:#f5f5f5">
            <tr><th>Employee</th><th>Course</th><th>Expires</th><th>Days Left</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendTestAvailable({ to, userName, courseTitle }) {
    const subject = `📝 Final test available: ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2980b9">Final Test Ready</h2>
        <p>Hi <strong>${userName}</strong>,</p>
        <p>Your final test for <strong>"${courseTitle}"</strong> is now available.</p>
        <p>Log in to complete your assessment.</p>
      </div>`;
    return this.send({ to, subject, html });
  }


  async sendEmployeeCourseAccessEmail({
    to,
    firstName,
    lastName,
    password = null,
    courseTitle,
    accessUrl = null,
    expiresAt = null,
    isNewAccount = false,
  }) {
    const userName = `${firstName || ''} ${lastName || ''}`.trim() || to;
    const loginUrl = `${config.CLIENT_URL}/login`;
    const subject = isNewAccount
      ? `Your LMS account and course access are ready: ${courseTitle}`
      : `Course access assigned: ${courseTitle}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2c3e50">Hello ${userName},</h2>
        <p>You have been assigned to the course <strong>"${courseTitle}"</strong>.</p>

        ${isNewAccount ? `
        <div style="background:#f8f9fa;padding:15px;border-radius:5px;margin:20px 0">
          <h3 style="margin-top:0">Your Login Details:</h3>
          <p><strong>Email:</strong> ${to}</p>
          ${password ? `<p><strong>Temporary Password:</strong> <code style="background:#e9ecef;padding:2px 8px;border-radius:3px">${password}</code></p>` : ''}
          <p>Please change your password after login.</p>
        </div>
        ` : ''}

        ${accessUrl ? `
        <p>
          <a href="${accessUrl}" style="background:#16a085;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">
            Open Course Access Link
          </a>
        </p>
        ` : ''}

        <p>
          <a href="${loginUrl}" style="background:#3498db;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">
            Login to LMS
          </a>
        </p>

        ${expiresAt ? `<p>Course access expires on: <strong>${new Date(expiresAt).toLocaleDateString('it-IT')}</strong></p>` : ''}

        <hr style="border:none;border-top:1px solid #eee;margin:30px 0"/>
        <p style="color:#999;font-size:12px">If you did not expect this email, contact your company administrator.</p>
      </div>
    `;

    return this.send({ to, subject, html });
  }


  // In emailService.js
  async sendEmployeeWelcomeEmail({ to, firstName, lastName, email, password, companyName, courses, accessCourses = [] }) {

    // ✅ Use this.send() instead of this.sendEmail()
    return this.send({
      to,
      subject: `Welcome to ${companyName} — Your Account is Ready`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2c3e50">Welcome, ${firstName} ${lastName}!</h2>
        <p>Your account has been created by <strong>${companyName}</strong>.</p>
        
        <div style="background:#f8f9fa;padding:15px;border-radius:5px;margin:20px 0">
          <h3 style="margin-top:0">Your Login Details:</h3>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Password:</strong> <code style="background:#e9ecef;padding:2px 8px;border-radius:3px">${password}</code></p>
        </div>
        
        <h3>📚 Courses Assigned to You:</h3>
        <ul>
          ${courses.map(c => `<li>${c.title}</li>`).join('')}
        </ul>

        ${accessCourses.length > 0 ? `
        <h3>Direct Course Access:</h3>
        <ul>
          ${accessCourses.map(c => `<li><a href="${c.accessUrl}">${c.title}</a>${c.expiresAt ? ` (expires: ${new Date(c.expiresAt).toLocaleDateString('it-IT')})` : ''}</li>`).join('')}
        </ul>
        ` : ''}
        
        <p>Please <a href="${config.CLIENT_URL}/login" style="background:#3498db;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Login Now</a> and change your password immediately.</p>
        
        <hr style="border:none;border-top:1px solid #eee;margin:30px 0"/>
        <p style="color:#999;font-size:12px">If you have any questions, contact your company administrator.</p>
      </div>
    `,
    });
  }
}

export const emailService = new EmailService();