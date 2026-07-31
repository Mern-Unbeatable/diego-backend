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

// ---- Chromium path resolver (Nixpacks / Coolify VPS fix) ----
function resolveChromiumPath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;

  // Only trust an explicit env var if it's set AND not the broken Ubuntu apt stub
  if (envPath && !envPath.includes('chromium-browser')) {
    log.info(`Using Chromium from PUPPETEER_EXECUTABLE_PATH: ${envPath}`);
    return envPath;
  }

  // Otherwise let Puppeteer use its own bundled/downloaded Chromium
  log.info('No valid PUPPETEER_EXECUTABLE_PATH set — using Puppeteer bundled Chromium.');
  return undefined;
}
// ---------------------------------------------------------------

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const buildGoldSealSvg = () => `
<svg width="96" height="108" viewBox="0 0 96 108" xmlns="http://www.w3.org/2000/svg">
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
      background: #fff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .page {
      width: 210mm;
      height: 297mm;
      max-height: 297mm;
      overflow: hidden;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      align-items: center;
      page-break-after: avoid;
      page-break-inside: avoid;
      position: relative;
    }
    .company-logo {
      position: absolute;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      max-height: 48px;
      max-width: 120px;
      object-fit: contain;
    }
    .header {
      width: 100%;
      padding-top: ${companyLogoUrl ? '72px' : '52px'};
      text-align: center;
      flex-shrink: 0;
    }
    .arched-title {
      width: 100%;
      height: 72px;
      display: block;
    }
    .presented-to {
      margin-top: 18px;
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 10px;
      letter-spacing: 5px;
      color: ${primaryColor};
      text-transform: uppercase;
    }
    .name-section {
      width: 100%;
      text-align: center;
      margin-top: 28px;
      flex-shrink: 0;
    }
    .student-name {
      font-family: 'Great Vibes', 'Brush Script MT', cursive;
      font-size: 58px;
      color: ${primaryColor};
      line-height: 1;
      padding: 0 40px;
      word-break: break-word;
    }
    .name-underline {
      width: 62%;
      max-width: 420px;
      margin: 10px auto 0;
      border-top: 1.5px solid ${primaryColor};
    }
    .body-text {
      width: 78%;
      max-width: 520px;
      text-align: center;
      margin-top: 32px;
      flex-shrink: 0;
    }
    .course-line {
      font-family: 'Roboto Slab', Georgia, serif;
      font-size: 15px;
      color: ${primaryColor};
      line-height: 1.7;
    }
    .hosted-line {
      font-family: 'Roboto Slab', Georgia, serif;
      font-size: 15px;
      color: ${primaryColor};
      margin-top: 4px;
      line-height: 1.7;
    }
    .date-line {
      margin-top: 16px;
      font-family: Georgia, serif;
      font-size: 11px;
      color: ${primaryColor};
    }
    .footer {
      width: 100%;
      margin-top: auto;
      padding: 0 48px 52px;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .sig-block {
      width: 30%;
      text-align: center;
    }
    .sig-line {
      border-top: 1.5px solid ${primaryColor};
      margin-bottom: 8px;
    }
    .sig-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 13px;
      color: ${primaryColor};
    }
    .sig-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 12px;
      font-weight: 700;
      color: ${primaryColor};
      margin-top: 2px;
    }
    .seal-wrap {
      width: 30%;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      padding-bottom: 2px;
    }
    .qr-code {
      position: absolute;
      bottom: 20px;
      right: 24px;
      width: 56px;
      height: 56px;
    }
    .meta {
      position: absolute;
      bottom: 12px;
      left: 24px;
      font-family: Arial, sans-serif;
      font-size: 7px;
      color: #cbd5e0;
    }
  </style>
</head>
<body>
  <div class="page">
    ${companyLogoUrl ? `<img class="company-logo" src="${escapeHtml(companyLogoUrl)}" alt="logo" />` : ''}

    <div class="header">
      <svg class="arched-title" viewBox="0 0 600 72" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <path id="titleCurve" d="M 60,58 Q 300,8 540,58" fill="none"/>
        </defs>
        <text font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="700" fill="${primaryColor}">
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