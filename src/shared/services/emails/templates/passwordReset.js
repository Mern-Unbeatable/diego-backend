import { baseTemplate } from './baseTemplate.js';

export const passwordResetTemplate = ({ name, resetUrl }) => {
  const displayName = name || 'there';

  const content = `
    <h2>Reset your password</h2>
    <p>Hi ${displayName},</p>
    <p>We received a request to reset the password for your LMS-Platoform account. Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
    <div class="btn-wrap" style="text-align: center; margin: 32px 0;">
      <a href="${resetUrl}" style="display: inline-block; background-color: #18181b; color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 15px; font-weight: 600;">Reset Password</a>
    </div>
    <p style="font-size:13px; color:#71717a;">If the button doesn't work, copy and paste this link into your browser:</p>
    <div style="background: #f4f4f5; border-radius: 4px; padding: 12px 16px; font-size: 13px; word-break: break-all; color: #71717a; margin-top: 8px;">${resetUrl}</div>
    <p style="margin-top:32px; font-size:13px; color:#71717a;">If you didn't request a password reset, you can safely ignore this email. Your password won't change.</p>
  `;

  return baseTemplate({ title: 'Reset Your Password', content });
};