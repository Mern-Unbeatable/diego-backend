


import nodemailer from 'nodemailer';
import { Logger } from '../../../config/logger.js';
import { config } from '../../../config/config.js';
import { platformSettingService } from '../../../features/platformSetting/platformSetting.service.js';

const log = new Logger('EmailService');

class EmailService {
  constructor() {
    this._transporter = null;
    this._transporterKey = null;
    this._verifyConnection();
  }

  async _getTransporter() {
    const smtp = await platformSettingService.getSmtpConfig();
    const key = `${smtp.host}:${smtp.port}:${smtp.user}`;

    if (this._transporter && this._transporterKey === key) {
      return this._transporter;
    }

    this._transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
      requireTLS: smtp.port === 587,
    });
    this._transporterKey = key;

    return this._transporter;
  }

  async _verifyConnection() {
    try {
      const smtp = await platformSettingService.getSmtpConfig();
      if (!smtp.host || !smtp.user || !smtp.pass) {
        log.warn('SMTP not configured — emails will NOT be sent until SMTP_HOST, SMTP_USER and SMTP_PASS are set.');
        return;
      }

      const transporter = await this._getTransporter();
      await transporter.verify();
      log.info(`✅ SMTP connection verified successfully (${smtp.host}:${smtp.port}, user: ${smtp.user})`);
    } catch (err) {
      log.error(`❌ SMTP connection FAILED — emails will NOT be sent. Reason: ${err.message}`);
      log.error(`   Check: 1) SMTP_PASS has no spaces  2) SMTP_FROM matches SMTP_USER's domain  3) 2FA + App Password enabled on the Gmail account`);
    }
  }

  async send({ to, subject, html, text }) {
    if (!to) {
      log.warn('Email send skipped: no recipient address provided');
      return null;
    }
    try {
      const smtp = await platformSettingService.getSmtpConfig();
      const transporter = await this._getTransporter();
      const fromAddress = smtp.fromEmail || config.SMTP_FROM || config.SMTP_USER;
      const info = await transporter.sendMail({

        from: `"LMS Platform" <${fromAddress}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });
      log.info(`Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (err) {

      log.error(`❌ Email send FAILED to ${to} | subject: "${subject}" | reason: ${err.message}`);
      throw err;
    }
  }

  async sendCourseExpiryReminder({ to, userName, courseTitle, daysLeft, expiresAt, locale = 'it' }) {
    const isIt = locale === 'it';
    const subject = isIt
      ? `⏳ Il corso scade tra ${daysLeft} giorno/i: ${courseTitle}`
      : `⏳ Course expiring in ${daysLeft} day(s): ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:${daysLeft <= 7 ? '#c0392b' : '#e67e22'}">${isIt ? 'Promemoria scadenza corso' : 'Course expiry reminder'}</h2>
        <p>${isIt ? 'Ciao' : 'Hi'} <strong>${userName}</strong>,</p>
        <p>${isIt ? 'Il tuo corso' : 'Your course'} <strong>"${courseTitle}"</strong> ${isIt ? 'scade tra' : 'expires in'} <strong>${daysLeft} ${isIt ? 'giorno/i' : 'day(s)'}</strong>.</p>
        <p>${isIt ? 'Data di scadenza' : 'Expiry date'}: <strong>${new Date(expiresAt).toLocaleDateString(isIt ? 'it-IT' : 'en-GB')}</strong></p>
        <p>${isIt ? 'Accedi alla piattaforma e completa la formazione prima della scadenza.' : 'Log in and complete your training before it expires.'}</p>
        <p><a href="${config.CLIENT_URL}/dashboard" style="background:#3498db;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">${isIt ? 'Vai ai miei corsi' : 'Go to my courses'}</a></p>
        <hr/>
        <p style="color:#999;font-size:12px">${isIt ? 'Puoi disattivare le email di promemoria dalle impostazioni del tuo account.' : 'You can disable reminder emails in your account settings.'}</p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCertificateExpiryReminder({ to, userName, courseTitle, daysLeft, expiresAt, archiveUrl, locale = 'it' }) {
    const isIt = locale === 'it';
    const subject = isIt
      ? `📄 Attestato: ancora ${daysLeft} giorno/i per il download — ${courseTitle}`
      : `📄 Certificate: ${daysLeft} day(s) left to download — ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:${daysLeft <= 7 ? '#c0392b' : '#e67e22'}">${isIt ? 'Promemoria download attestato' : 'Certificate download reminder'}</h2>
        <p>${isIt ? 'Ciao' : 'Hi'} <strong>${userName}</strong>,</p>
        <p>${isIt ? 'L\'attestato per' : 'The certificate for'} <strong>"${courseTitle}"</strong> ${isIt ? 'è disponibile per il download ancora per' : 'is available for download for'} <strong>${daysLeft} ${isIt ? 'giorno/i' : 'day(s)'}</strong>.</p>
        <p>${isIt ? 'Scadenza download gratuito' : 'Free download expires'}: <strong>${new Date(expiresAt).toLocaleDateString(isIt ? 'it-IT' : 'en-GB')}</strong></p>
        <p>${isIt ? 'Dopo la scadenza potrai acquistare il servizio di archiviazione attestati per scaricare di nuovo il PDF.' : 'After expiry you can purchase certificate archive storage to download the PDF again.'}</p>
        <p>
          <a href="${config.CLIENT_URL}/certificates" style="background:#27ae60;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;margin-right:8px">${isIt ? 'Scarica attestato' : 'Download certificate'}</a>
          ${archiveUrl ? `<a href="${archiveUrl}" style="background:#8e44ad;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">${isIt ? 'Acquista archivio' : 'Buy archive'}</a>` : ''}
        </p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCertificateReady({ to, userName, courseTitle, downloadUrl, certificatesUrl, freeDownloadDays = 30, downloadableUntil = null, locale = 'it' }) {
    const isIt = locale === 'it';
    const expiryStr = downloadableUntil
      ? new Date(downloadableUntil).toLocaleDateString(isIt ? 'it-IT' : 'en-GB')
      : null;
    const subject = isIt
      ? `🎉 Il tuo attestato è pronto: ${courseTitle}`
      : `🎉 Your certificate is ready: ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#27ae60">${isIt ? 'Attestato pronto!' : 'Certificate ready!'}</h2>
        <p>${isIt ? 'Ciao' : 'Hi'} <strong>${userName}</strong>,</p>
        <p>${isIt ? 'Complimenti! Hai completato con successo' : 'Congratulations! You have successfully completed'} <strong>"${courseTitle}"</strong>.</p>
        <div style="background:#fff3cd;border-left:4px solid #e67e22;padding:12px 16px;margin:20px 0">
          <strong>${isIt ? `Disponibile per ${freeDownloadDays} giorni` : `Available for ${freeDownloadDays} days`}</strong>
          ${expiryStr ? `<br/>${isIt ? 'Scadenza download' : 'Download expires'}: <strong>${expiryStr}</strong>` : ''}
        </div>
        <p>${isIt ? 'Scarica il tuo attestato dalla piattaforma. Dopo i 30 giorni gratuiti potrai acquistare il servizio di archiviazione.' : 'Download your certificate from the platform. After the free 30 days you can purchase archive storage.'}</p>
        <p>
          ${downloadUrl ? `<a href="${downloadUrl}" style="background:#27ae60;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;margin-right:8px">${isIt ? 'Scarica PDF' : 'Download PDF'}</a>` : ''}
          <a href="${certificatesUrl || `${config.CLIENT_URL}/certificates`}" style="background:#3498db;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">${isIt ? 'I miei attestati' : 'My certificates'}</a>
        </p>
      </div>`;
    return this.send({ to, subject, html });
  }

  async sendCertificateDownloadExpired({ to, userName, courseTitle, archiveUrl, locale = 'it' }) {
    const isIt = locale === 'it';
    const subject = isIt
      ? `⚠️ Download attestato scaduto: ${courseTitle}`
      : `⚠️ Certificate download expired: ${courseTitle}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#c0392b">${isIt ? 'Periodo gratuito terminato' : 'Free download period ended'}</h2>
        <p>${isIt ? 'Ciao' : 'Hi'} <strong>${userName}</strong>,</p>
        <p>${isIt ? 'I 30 giorni gratuiti per scaricare l\'attestato' : 'The 30 free days to download the certificate for'} <strong>"${courseTitle}"</strong> ${isIt ? 'sono terminati.' : 'have ended.'}</p>
        <p>${isIt ? 'Il tuo attestato resta conservato sui nostri server. Per scaricarlo di nuovo, acquista il servizio di archiviazione attestati.' : 'Your certificate remains stored on our servers. To download it again, purchase certificate archive storage.'}</p>
        <p><a href="${archiveUrl || `${config.CLIENT_URL}/certificates/archive`}" style="background:#8e44ad;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">${isIt ? 'Acquista archivio attestati' : 'Purchase certificate archive'}</a></p>
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
    to, firstName, lastName, password = null, courseTitle,
    accessUrl = null, expiresAt = null, isNewAccount = false,
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
        </div>` : ''}
        ${accessUrl ? `
        <p><a href="${accessUrl}" style="background:#16a085;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Open Course Access Link</a></p>` : ''}
        <p><a href="${loginUrl}" style="background:#3498db;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Login to LMS</a></p>
        ${expiresAt ? `<p>Course access expires on: <strong>${new Date(expiresAt).toLocaleDateString('it-IT')}</strong></p>` : ''}
        <hr style="border:none;border-top:1px solid #eee;margin:30px 0"/>
        <p style="color:#999;font-size:12px">If you did not expect this email, contact your company administrator.</p>
      </div>
    `;
    return this.send({ to, subject, html });
  }

  async sendEmployeeWelcomeEmail({
    to,
    firstName,
    lastName,
    email,
    password,
    companyName,
    courses = [],
    accessCourses = [],
    role = null,
    employmentDate = null,
  }) {
    const employmentStr = employmentDate
      ? new Date(employmentDate).toLocaleDateString('it-IT')
      : null;

    return this.send({
      to,
      subject: `Welcome to ${companyName} — Your LMS Account is Ready`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2c3e50">Welcome, ${firstName} ${lastName}!</h2>
        <p>Your employee account has been created by <strong>${companyName}</strong>.</p>
        ${role ? `<p><strong>Role:</strong> ${role}</p>` : ''}
        ${employmentStr ? `<p><strong>Date of employment:</strong> ${employmentStr}</p>` : ''}
        <div style="background:#f8f9fa;padding:15px;border-radius:5px;margin:20px 0">
          <h3 style="margin-top:0">Your Login Credentials</h3>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> <code style="background:#e9ecef;padding:2px 8px;border-radius:3px">${password}</code></p>
          <p style="font-size:13px;color:#666">Please change your password after your first login.</p>
        </div>
        ${courses.length > 0 ? `
        <h3>Courses Assigned to You</h3>
        <ul>${courses.map((c) => `<li>${c.title}</li>`).join('')}</ul>` : `
        <p>No course has been assigned yet. Your company administrator can assign training later from the employee panel.</p>`}
        ${accessCourses.length > 0 ? `
        <h3>Direct Course Access</h3>
        <ul>${accessCourses.map((c) => `<li><a href="${c.accessUrl}">${c.title}</a>${c.expiresAt ? ` (expires: ${new Date(c.expiresAt).toLocaleDateString('it-IT')})` : ''}</li>`).join('')}</ul>` : ''}
        <p><a href="${config.CLIENT_URL}/auth/login" style="background:#3498db;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Login to LMS</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:30px 0"/>
        <p style="color:#999;font-size:12px">If you have any questions, contact your company administrator.</p>
      </div>`,
    });
  }

  async sendEmployeeUpdatedEmail({
    to,
    firstName,
    lastName,
    companyName,
    password = null,
    courses = [],
    accessCourses = [],
  }) {
    const userName = `${firstName || ''} ${lastName || ''}`.trim() || to;
    const subject = password && courses.length > 0
      ? 'Your LMS account has been updated — new password and course assigned'
      : password
        ? 'Your LMS password has been updated'
        : 'A new course has been assigned to you';

    return this.send({
      to,
      subject,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:#2c3e50">Hello ${userName},</h2>
        <p>Your employee profile at <strong>${companyName}</strong> has been updated.</p>
        ${password ? `
        <div style="background:#f8f9fa;padding:15px;border-radius:5px;margin:20px 0">
          <h3 style="margin-top:0">New Login Password</h3>
          <p><strong>Email:</strong> ${to}</p>
          <p><strong>New Password:</strong> <code style="background:#e9ecef;padding:2px 8px;border-radius:3px">${password}</code></p>
          <p style="font-size:13px;color:#666">Please change your password after login.</p>
        </div>` : ''}
        ${courses.length > 0 ? `
        <h3>New Course(s) Assigned</h3>
        <ul>${courses.map((c) => `<li>${c.title}</li>`).join('')}</ul>` : ''}
        ${accessCourses.length > 0 ? `
        <h3>Direct Course Access</h3>
        <ul>${accessCourses.map((c) => `<li><a href="${c.accessUrl}">${c.title}</a>${c.expiresAt ? ` (expires: ${new Date(c.expiresAt).toLocaleDateString('it-IT')})` : ''}</li>`).join('')}</ul>` : ''}
        <p><a href="${config.CLIENT_URL}/auth/login" style="background:#3498db;color:#fff;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block">Login to LMS</a></p>
      </div>`,
    });
  }
}

export const emailService = new EmailService();