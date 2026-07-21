export const baseTemplate = ({ title, content, preheader = '' }) => `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        body { margin: 0; padding: 0; background-color: #f4f4f5; font-family: Arial, sans-serif; }
        .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .header { background-color: #18181b; padding: 32px 40px; text-align: center; }
        .header h1 { color: #ffffff; margin: 0; font-size: 24px; letter-spacing: -0.5px; }
        .body { padding: 40px; color: #3f3f46; }
        .body h2 { font-size: 20px; color: #18181b; margin-top: 0; }
        .body p { font-size: 15px; line-height: 1.6; }
        .footer { padding: 24px 40px; text-align: center; font-size: 13px; color: #a1a1aa; border-top: 1px solid #f4f4f5; }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="header">
          <h1>LMS-Platoform</h1>
        </div>
        <div class="body">
          ${content}
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} LMS-Platoform. All rights reserved.
        </div>
      </div>
    </body>
  </html>
`;