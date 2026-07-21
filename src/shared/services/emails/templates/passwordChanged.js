import { baseTemplate } from './baseTemplate.js';

export const passwordChangedTemplate = ({ name }) => {
  const displayName = name || 'there';

  const content = `
    <h2>Your password was changed</h2>
    <p>Hi ${displayName},</p>
    <p>This is a confirmation that the password for your LMS-Platoform account was successfully changed.</p>
    <p>If you did not make this change, please contact us immediately by replying to this email.</p>
  `;

  return baseTemplate({ title: 'Password Changed', content });
};