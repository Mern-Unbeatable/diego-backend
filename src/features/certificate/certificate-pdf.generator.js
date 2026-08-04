import fs from 'fs';
import path from 'path';
import htmlPdf from 'html-pdf-node';
import { format } from 'date-fns';
import { config } from '../../config/config.js';
import { Logger } from '../../config/logger.js';

const log = new Logger('CertificatePdfGenerator');

const PDF_DIR = path.join(process.cwd(), 'uploads', 'certificates', 'pdfs');
if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

const NAVY = '#1a365d';

function resolveChromiumPath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;


  if (envPath && envPath.includes('chromium-browser')) {
    log.warn(
      `Removing broken PUPPETEER_EXECUTABLE_PATH="${envPath}" — ` +
      'this is the Ubuntu snap stub and does not work inside containers.'
    );
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    return undefined;
  }

  if (envPath) {
    // Verify the executable actually exists before trusting it
    if (fs.existsSync(envPath)) {
      log.info(`Using Chromium from PUPPETEER_EXECUTABLE_PATH: ${envPath}`);
      return envPath;
    }
    log.warn(
      `PUPPETEER_EXECUTABLE_PATH="${envPath}" does not exist — removing and falling back to bundled Chromium.`
    );
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    return undefined;
  }

  log.info('No PUPPETEER_EXECUTABLE_PATH set — using Puppeteer bundled Chromium.');
  return undefined;
}
// ---------------------------------------------------------------

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const buildGoldSealSvg = () => `
<svg width="104" height="118" viewBox="0 0 96 108" xmlns="http://www.w3.org/2000/svg" style="display:block;">
  <defs>
    <radialGradient id="sealGold" cx="38%" cy="32%" r="68%">
      <stop offset="0%" stop-color="#f7e7a8"/>
      <stop offset="40%" stop-color="#d4af37"/>
      <stop offset="100%" stop-color="#9a7b1a"/>
    </radialGradient>
    <linearGradient id="ribbonRed" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#c53030"/>
      <stop offset="100%" stop-color="#7f1d1d"/>
    </linearGradient>
  </defs>
  <path d="M14,96 L22,78 L30,96 L38,78 L46,96" fill="url(#ribbonRed)" stroke="#5c1010" stroke-width="0.6"/>
  <path d="M50,96 L58,78 L66,96 L74,78 L82,96" fill="url(#ribbonRed)" stroke="#5c1010" stroke-width="0.6"/>
  <path d="M22,78 L30,96" stroke="#d4af37" stroke-width="1.2"/>
  <path d="M38,78 L46,96" stroke="#d4af37" stroke-width="1.2"/>
  <path d="M58,78 L66,96" stroke="#d4af37" stroke-width="1.2"/>
  <path d="M74,78 L82,96" stroke="#d4af37" stroke-width="1.2"/>
  <circle cx="48" cy="44" r="36" fill="url(#sealGold)" stroke="#8b6914" stroke-width="1.5"/>
  <circle cx="48" cy="44" r="30" fill="none" stroke="#c9a227" stroke-width="1"/>
  <circle cx="48" cy="44" r="24" fill="none" stroke="#8b6914" stroke-width="0.8"/>
  <circle cx="48" cy="44" r="18" fill="none" stroke="#c9a227" stroke-width="0.6" stroke-dasharray="2 2"/>
</svg>`;

const buildSignatureBlock = (signatory) => {
  if (!signatory?.name) return '<div class="sig-block"></div>';
  return `
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-name">${escapeHtml(signatory.name)}</div>
        <div class="sig-title">${escapeHtml(signatory.title || '')}</div>
      </div>
    `;
};

const buildClassicCertificateHtml = ({
  studentName,
  courseTitle,
  organizationName,
  issueDate,
  completedAt,
  certificateId,
  certificateTemplateConfig,
  companyLogoUrl,
  qrCodeUrl,
}) => {
  const cfg = certificateTemplateConfig || {};
  const primaryColor = cfg.colors?.primary || NAVY;
  const titleText = cfg.titleText || 'Certificate of Completion';
  const presentedToLabel = cfg.presentedToLabel || 'PRESENTED TO';
  const completionLabel = cfg.completionLabel || 'for completing the';
  const hostedByLabel = cfg.hostedByLabel || 'hosted by';

  const signatories = cfg.signatories || [
    { name: 'Hannah Morales', title: 'Director', position: 'left' },
    { name: 'Emma Jackson', title: 'President', position: 'right' },
  ];
  const leftSignatory = signatories.find(s => s.position === 'left') || signatories[0];
  const rightSignatory = signatories.find(s => s.position === 'right') || signatories[1];

  const formattedIssueDate = issueDate ? format(new Date(issueDate), 'dd MMMM yyyy') : '';
  const formattedCompletedAt = completedAt ? format(new Date(completedAt), 'dd MMMM yyyy') : '';
  const showQr = cfg.showQrCode === true;
  const showDates = cfg.showIssueDate === true;
  const showMeta = cfg.showCertificateId === true;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <link href="https://fonts.googleapis.com/css2?family=Great+Vibes&family=Roboto+Slab:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4 portrait; margin: 0; }
    html, body {
      width: 210mm;
      height: 297mm;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .page {
      position: relative;
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      overflow: hidden;
      background: #ffffff;
      page-break-after: avoid;
      page-break-inside: avoid;
    }
    .company-logo {
      position: absolute;
      top: 14mm;
      left: 50%;
      transform: translateX(-50%);
      max-height: 14mm;
      max-width: 34mm;
      object-fit: contain;
      z-index: 2;
    }
    .header {
      position: absolute;
      top: ${companyLogoUrl ? '30mm' : '22mm'};
      left: 0;
      right: 0;
      text-align: center;
    }
    .arched-title {
      width: 180mm;
      height: 32mm;
      display: block;
      margin: 0 auto;
    }
    .presented-to {
      margin-top: 4mm;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11pt;
      letter-spacing: 0.6em;
      color: ${primaryColor};
      text-transform: uppercase;
      font-weight: 400;
    }
    .name-section {
      position: absolute;
      top: 74mm;
      left: 0;
      right: 0;
      text-align: center;
    }
    .student-name {
      font-family: 'Great Vibes', 'Brush Script MT', cursive;
      font-size: 58pt;
      font-weight: 400;
      color: ${primaryColor};
      line-height: 1.0;
      padding: 0 16mm;
      word-break: break-word;
      letter-spacing: 0.5px;
    }
    .name-underline {
      width: 64%;
      max-width: 128mm;
      margin: 2.5mm auto 0;
      border-top: 1.2pt solid ${primaryColor};
    }
    .body-text {
      position: absolute;
      top: 107mm;
      left: 50%;
      transform: translateX(-50%);
      width: 82%;
      max-width: 145mm;
      text-align: center;
    }
    .course-line,
    .hosted-line {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 11.5pt;
      font-weight: 400;
      color: ${primaryColor};
      line-height: 1.5;
      letter-spacing: 0.3px;
    }
    .hosted-line {
      margin-top: 0.8mm;
    }
    .date-line {
      margin-top: 4mm;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 9pt;
      color: ${primaryColor};
    }
    .footer {
      position: absolute;
      left: 18mm;
      right: 18mm;
      bottom: 46mm;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
    }
    .sig-block {
      width: 48mm;
      text-align: center;
      flex-shrink: 0;
    }
    .sig-line {
      border-top: 1pt solid ${primaryColor};
      margin-bottom: 3mm;
    }
    .sig-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 10.5pt;
      color: ${primaryColor};
      line-height: 1.3;
      letter-spacing: 0.2px;
    }
    .sig-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 10pt;
      font-weight: 700;
      color: ${primaryColor};
      margin-top: 1.2mm;
      line-height: 1.3;
    }
    .seal-wrap {
      width: 48mm;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      flex-shrink: 0;
      padding-bottom: 0;
    }
    .qr-code {
      position: absolute;
      bottom: 8mm;
      right: 10mm;
      width: 15mm;
      height: 15mm;
    }
    .meta {
      position: absolute;
      bottom: 5mm;
      left: 10mm;
      font-family: Arial, sans-serif;
      font-size: 6pt;
      color: #cbd5e0;
    }
  </style>
</head>
<body>
  <div class="page">
    ${companyLogoUrl ? `<img class="company-logo" src="${escapeHtml(companyLogoUrl)}" alt="logo" />` : ''}

    <div class="header">
      <svg class="arched-title" viewBox="0 0 600 110" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <path id="titleCurve" d="M 15,85 Q 300,5 585,85" fill="none"/>
        </defs>
        <text font-family="Georgia, 'Times New Roman', serif" font-size="40" font-weight="700" fill="${primaryColor}">
          <textPath href="#titleCurve" startOffset="50%" text-anchor="middle">${escapeHtml(titleText)}</textPath>
        </text>
      </svg>
      <div class="presented-to">${escapeHtml(presentedToLabel)}</div>
    </div>

    <div class="name-section">
      <div class="student-name">${escapeHtml(studentName)}</div>
      <div class="name-underline"></div>
    </div>

    <div class="body-text">
      <div class="course-line">${escapeHtml(completionLabel)} ${escapeHtml(courseTitle)}</div>
      <div class="hosted-line">${escapeHtml(hostedByLabel)} ${escapeHtml(organizationName)}</div>
      ${showDates && formattedIssueDate ? `<div class="date-line">Issued on ${escapeHtml(formattedIssueDate)}${formattedCompletedAt ? ` &middot; Completed on ${escapeHtml(formattedCompletedAt)}` : ''}</div>` : ''}
    </div>

    <div class="footer">
      ${buildSignatureBlock(leftSignatory)}
      <div class="seal-wrap">${buildGoldSealSvg()}</div>
      ${buildSignatureBlock(rightSignatory)}
    </div>

    ${showQr && qrCodeUrl ? `<img class="qr-code" src="${escapeHtml(qrCodeUrl)}" alt="QR" />` : ''}
    ${showMeta ? `<div class="meta">ID: ${escapeHtml(certificateId)}</div>` : ''}
  </div>
</body>
</html>`;
};

const buildCustomBackgroundHtml = ({
  studentName,
  courseTitle,
  organizationName,
  issueDate,
  completedAt,
  certificateId,
  certificateTemplateUrl,
  certificateTemplateConfig,
  companyLogoUrl,
  qrCodeUrl,
}) => {
  const cfg = certificateTemplateConfig || {};
  const fields = cfg.fields || {};
  const primaryColor = cfg.colors?.primary || NAVY;
  const isPortrait = cfg.layout !== 'landscape';

  const fieldStyle = (fieldKey, defaults) => {
    const merged = { ...defaults, ...(fields[fieldKey] || {}) };
    const css = ['position:absolute', 'text-align:center'];
    if (merged.top) css.push(`top:${merged.top}`);
    if (merged.bottom) css.push(`bottom:${merged.bottom}`);
    if (merged.left) css.push(`left:${merged.left}`);
    if (merged.right) css.push(`right:${merged.right}`);
    if (merged.fontSize) css.push(`font-size:${merged.fontSize}`);
    if (merged.color) css.push(`color:${merged.color}`);
    if (merged.fontWeight) css.push(`font-weight:${merged.fontWeight}`);
    if (merged.width) css.push(`width:${merged.width}`);
    if (merged.fontFamily) css.push(`font-family:${merged.fontFamily}`);
    if (!merged.left && !merged.right && (merged.top || merged.bottom)) {
      css.push('left:50%', 'transform:translateX(-50%)', 'width:80%');
    }
    return css.join(';');
  };

  const formattedIssueDate = issueDate ? format(new Date(issueDate), 'dd MMMM yyyy') : '';
  const formattedCompletedAt = completedAt ? format(new Date(completedAt), 'dd MMMM yyyy') : '';
  const pageW = isPortrait ? '210mm' : '297mm';
  const pageH = isPortrait ? '297mm' : '210mm';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <link href="https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4 ${isPortrait ? 'portrait' : 'landscape'}; margin: 0; }
    html, body { width: ${pageW}; height: ${pageH}; margin: 0; padding: 0; overflow: hidden; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .page {
      position: relative;
      width: ${pageW};
      height: ${pageH};
      max-height: ${pageH};
      overflow: hidden;
      page-break-after: avoid;
      page-break-inside: avoid;
      background-image: url('${escapeHtml(certificateTemplateUrl)}');
      background-size: cover;
      background-position: center;
    }
  </style>
</head>
<body>
  <div class="page">
    ${companyLogoUrl ? `<img src="${escapeHtml(companyLogoUrl)}" style="${fieldStyle('companyLogo', { top: '5%', width: '110px' })}" />` : ''}
    <div style="${fieldStyle('studentName', { top: '36%', fontSize: '52px', color: primaryColor, fontFamily: "'Great Vibes', cursive" })}">${escapeHtml(studentName)}</div>
    <div style="${fieldStyle('courseTitle', { top: '50%', fontSize: '15px', color: primaryColor })}">${escapeHtml(courseTitle)}</div>
    <div style="${fieldStyle('organizationName', { top: '57%', fontSize: '15px', color: primaryColor })}">${escapeHtml(organizationName)}</div>
    ${formattedIssueDate ? `<div style="${fieldStyle('issueDate', { top: '64%', fontSize: '11px', color: primaryColor })}">Issued on ${escapeHtml(formattedIssueDate)}</div>` : ''}
    ${formattedCompletedAt ? `<div style="${fieldStyle('completedAt', { top: '69%', fontSize: '11px', color: primaryColor })}">Completed on ${escapeHtml(formattedCompletedAt)}</div>` : ''}
    ${qrCodeUrl && cfg.showQrCode === true ? `<img src="${escapeHtml(qrCodeUrl)}" style="${fieldStyle('qrCode', { bottom: '8%', right: '6%', width: '64px', height: '64px' })}" />` : ''}
    ${cfg.showCertificateId === true ? `<div style="${fieldStyle('certificateId', { bottom: '5%', left: '5%', fontSize: '8px', color: '#cbd5e0' })};width:auto;text-align:left;">ID: ${escapeHtml(certificateId)}</div>` : ''}
  </div>
</body>
</html>`;
};

const buildCertificateHtml = (payload) => {
  if (payload.certificateTemplateUrl) {
    return buildCustomBackgroundHtml(payload);
  }
  return buildClassicCertificateHtml(payload);
};

export async function generateCertificatePdf({
  certificateId,
  studentName,
  courseTitle,
  organizationName = 'LMS Platform',
  issueDate,
  completedAt,
  certificateTemplateUrl = null,
  certificateTemplateConfig = null,
  companyLogoUrl = null,
  qrCodeUrl = null,
}) {
  const html = buildCertificateHtml({
    certificateId,
    studentName,
    courseTitle,
    organizationName,
    issueDate,
    completedAt,
    certificateTemplateUrl,
    certificateTemplateConfig,
    companyLogoUrl,
    qrCodeUrl,
  });

  const useLandscape = certificateTemplateConfig?.layout === 'landscape' && !!certificateTemplateUrl;
  const executablePath = resolveChromiumPath();
  const options = {
    format: 'A4',
    landscape: useLandscape,
    preferCSSPageSize: true,
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
    ...(executablePath && { executablePath }),
  };

  let pdfBuffer;
  try {
    pdfBuffer = await htmlPdf.generatePdf({ content: html }, options);
  } catch (err) {
    log.error(`PDF generation failed. executablePath="${options.executablePath || 'default'}": ${err.message}`);
    throw err;
  }

  const filename = `${certificateId}.pdf`;
  const filePath = path.join(PDF_DIR, filename);

  await fs.promises.writeFile(filePath, pdfBuffer);

  const baseUrl = config.BACKEND_URL || `https://api-diego.maktechgroup.tech:${config.PORT || 5000}`;
  const pdfUrl = `${baseUrl}/uploads/certificates/pdfs/${filename}`;

  log.info(`Certificate PDF created: ${filename} for ${studentName}`);
  return { pdfUrl, filePath, filename };
}

export async function deleteCertificatePdf(certificateId) {
  const filePath = path.join(PDF_DIR, `${certificateId}.pdf`);
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
    log.info(`Deleted old certificate PDF: ${certificateId}.pdf`);
  }
}
