import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { config } from '../../config/config.js';
const SCORM_ROOT = path.join(process.cwd(), 'uploads', 'scorm');

const getBaseUrl = () => (config.BACKEND_URL || config.API_URL || 'http://localhost:5000').replace(/\/$/, '');

export const urlToLocalPath = (fileUrl) => {
    if (!fileUrl || typeof fileUrl !== 'string') return null;

    const withoutQuery = fileUrl.split('?')[0].split('#')[0];

    // Match any host — production URLs often differ from BACKEND_URL in .env
    const uploadsIndex = withoutQuery.indexOf('/uploads/');
    if (uploadsIndex !== -1) {
        const relativePath = withoutQuery.slice(uploadsIndex + '/uploads/'.length);
        return path.join(process.cwd(), 'uploads', relativePath);
    }

    const baseUrl = getBaseUrl();
    const uploadsPrefix = `${baseUrl}/uploads/`;

    if (fileUrl.startsWith(uploadsPrefix)) {
        return path.join(process.cwd(), 'uploads', fileUrl.slice(uploadsPrefix.length));
    }

    if (fileUrl.startsWith('/uploads/')) {
        return path.join(process.cwd(), fileUrl.replace(/^\//, ''));
    }

    return null;
};

const copyDirRecursive = (src, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
};

const runUnzip = async (zipPath, destDir) => {
    fs.mkdirSync(destDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
};

const LESSONS_SCORM_DIR = path.join(process.cwd(), 'uploads', 'lessons', 'scorm');

/** Multer appends `-{timestamp}-{random}` before .zip — strip it to match re-uploads. */
const getUploadStem = (fileName) => {
    const withoutExt = fileName.replace(/\.zip$/i, '');
    const match = withoutExt.match(/^(.+)-\d{13}-\d{1,10}$/);
    return match ? match[1] : withoutExt;
};

const resolveLocalScormZipPath = (scormPackageUrl) => {
    const fromUrl = urlToLocalPath(scormPackageUrl);
    if (fromUrl && fs.existsSync(fromUrl)) return fromUrl;

    const basename = fromUrl ? path.basename(fromUrl) : null;
    if (!basename?.toLowerCase().endsWith('.zip')) return fromUrl;

    const direct = path.join(LESSONS_SCORM_DIR, basename);
    if (fs.existsSync(direct)) return direct;

    if (!fs.existsSync(LESSONS_SCORM_DIR)) return fromUrl;

    const zipFiles = fs.readdirSync(LESSONS_SCORM_DIR).filter((f) => f.toLowerCase().endsWith('.zip'));
    const exact = zipFiles.find((f) => f === basename);
    if (exact) return path.join(LESSONS_SCORM_DIR, exact);

    const stem = basename.replace(/\.zip$/i, '');
    const stemMatch = zipFiles.find((f) => f.replace(/\.zip$/i, '') === stem);
    if (stemMatch) return path.join(LESSONS_SCORM_DIR, stemMatch);

    // Same original file re-uploaded with a new multer suffix (any SCORM name).
    const uploadStem = getUploadStem(basename);
    const siblings = zipFiles.filter((f) => getUploadStem(f) === uploadStem).sort();
    if (siblings.length) return path.join(LESSONS_SCORM_DIR, siblings.at(-1));

    return fromUrl;
};

const scoreScormZip = (zipName, scormVersion = '1.2') => {
    let score = 0;
    if (/SingleSCO/i.test(zipName)) score += 10;
    if (scormVersion === '1.2') {
        if (/SCORM12/i.test(zipName)) score += 20;
        if (/SCORM11/i.test(zipName)) score += 5;
    } else if (/SCORM2004/i.test(zipName)) {
        score += 20;
    }
    return score;
};

export const selectBestScormZip = (zipFiles, scormVersion = '1.2') => {
    return [...zipFiles].sort(
        (left, right) => scoreScormZip(left, scormVersion) - scoreScormZip(right, scormVersion),
    ).at(-1);
};

export const resolveScormContentRoot = async (dir, scormVersion = '1.2') => {
    if (fs.existsSync(path.join(dir, 'imsmanifest.xml'))) {
        return dir;
    }

    const nestedZips = fs
        .readdirSync(dir)
        .filter((fileName) => fileName.toLowerCase().endsWith('.zip'));

    if (!nestedZips.length) {
        return dir;
    }

    const innerZipName = selectBestScormZip(nestedZips, scormVersion);
    const innerDir = path.join(dir, '_inner');
    fs.mkdirSync(innerDir, { recursive: true });
    await runUnzip(path.join(dir, innerZipName), innerDir);

    return resolveScormContentRoot(innerDir, scormVersion);
};

export const readManifestEntryPoint = (extractDir) => {
    const manifestPath = path.join(extractDir, 'imsmanifest.xml');
    if (!fs.existsSync(manifestPath)) return null;

    const xml = fs.readFileSync(manifestPath, 'utf8');
    const hrefMatch = xml.match(/<resource[^>]+href="([^"]+)"/i);
    return hrefMatch?.[1] || null;
};

export const installLmsLaunchPageIfNeeded = (extractDir) => {
    const sharedDir = path.join(extractDir, 'shared');
    const target = path.join(sharedDir, 'lms-launchpage.html');
    if (fs.existsSync(target)) return;

    const candidates = [
        path.join(process.cwd(), 'uploads', 'scorm', 'golf', 'shared', 'lms-launchpage.html'),
        path.join(process.cwd(), 'src', 'seeds', 'assets', 'lms-launchpage.html'),
    ];

    for (const src of candidates) {
        if (fs.existsSync(src)) {
            fs.mkdirSync(sharedDir, { recursive: true });
            fs.copyFileSync(src, target);
            return;
        }
    }
};

export const looksLikeScormZipUrl = (packageUrl) =>
    Boolean(packageUrl && /\.zip(\?|#|$)/i.test(String(packageUrl)));

export const isScormZipUrl = (packageUrl) => {
    if (!looksLikeScormZipUrl(packageUrl)) return false;
    const local = resolveLocalScormZipPath(packageUrl);
    return Boolean(local && local.toLowerCase().endsWith('.zip') && fs.existsSync(local));
};

export const shouldExtractScormZip = (packageUrl) =>
    looksLikeScormZipUrl(packageUrl) || isScormZipUrl(packageUrl);

export const isScormFolderUrl = (packageUrl) => {
    if (!packageUrl) return false;
    return /\/uploads\/scorm\/[^/]+$/i.test(packageUrl.replace(/\/$/, ''))
        && !packageUrl.toLowerCase().endsWith('.zip');
};

export const ensureScormPackagePrepared = async (
    scormPackageUrl,
    scormEntryPoint,
    scormVersion = '1.2',
) => {
    if (!scormPackageUrl) {
        return { scormPackageUrl, scormEntryPoint };
    }

    if (isScormFolderUrl(scormPackageUrl)) {
        return prepareScormPackageFromUpload(scormPackageUrl, scormEntryPoint, scormVersion);
    }

    if (shouldExtractScormZip(scormPackageUrl)) {
        return prepareScormPackageFromUpload(scormPackageUrl, scormEntryPoint, scormVersion);
    }

    return { scormPackageUrl, scormEntryPoint };
};

/**
 * Extract uploaded .zip to uploads/scorm/{folder}/ and return folder URL + entry point.
 */
export const prepareScormPackageFromUpload = async (
    scormPackageUrl,
    scormEntryPoint,
    scormVersion = '1.2',
) => {
    if (!scormPackageUrl) {
        return { scormPackageUrl, scormEntryPoint };
    }

    if (isScormFolderUrl(scormPackageUrl)) {
        const folderPath = urlToLocalPath(scormPackageUrl);
        if (folderPath && fs.existsSync(folderPath)) {
            installLmsLaunchPageIfNeeded(folderPath);
        }
        return {
            scormPackageUrl: scormPackageUrl.replace(/\/$/, ''),
            scormEntryPoint: scormEntryPoint || readManifestEntryPoint(folderPath) || 'shared/launchpage.html',
        };
    }

    const localZipPath = resolveLocalScormZipPath(scormPackageUrl);
    if (!localZipPath || !localZipPath.toLowerCase().endsWith('.zip')) {
        if (looksLikeScormZipUrl(scormPackageUrl)) {
            throw new Error(
                'Could not resolve SCORM zip on server. Upload the .zip again in the lesson form or Postman (field: scormPackageUrl).',
            );
        }
        return { scormPackageUrl, scormEntryPoint };
    }

    const folderName = path.basename(localZipPath, '.zip');
    const extractDir = path.join(SCORM_ROOT, folderName);

    // Already extracted — update DB URL only; do not unzip again on every launch.
    if (fs.existsSync(path.join(extractDir, 'imsmanifest.xml'))) {
        installLmsLaunchPageIfNeeded(extractDir);
        return {
            scormPackageUrl: `${getBaseUrl()}/uploads/scorm/${folderName}`,
            scormEntryPoint: scormEntryPoint || readManifestEntryPoint(extractDir) || 'shared/launchpage.html',
        };
    }

    if (!fs.existsSync(localZipPath)) {
        if (fs.existsSync(path.join(extractDir, 'imsmanifest.xml'))) {
            installLmsLaunchPageIfNeeded(extractDir);
            return {
                scormPackageUrl: `${getBaseUrl()}/uploads/scorm/${folderName}`,
                scormEntryPoint: scormEntryPoint || readManifestEntryPoint(extractDir) || 'shared/launchpage.html',
            };
        }
        throw new Error(`SCORM zip file not found on server: ${path.basename(localZipPath)}`);
    }

    const tempDir = path.join(SCORM_ROOT, `${folderName}_tmp`);

    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    await runUnzip(localZipPath, tempDir);

    const scormRoot = await resolveScormContentRoot(tempDir, scormVersion);
    if (!fs.existsSync(path.join(scormRoot, 'imsmanifest.xml'))) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        throw new Error(
            'Invalid SCORM package: no imsmanifest.xml found. Upload a single SCORM .zip package, not a folder of example archives.',
        );
    }

    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    copyDirRecursive(scormRoot, extractDir);
    fs.rmSync(tempDir, { recursive: true, force: true });

    installLmsLaunchPageIfNeeded(extractDir);

    const manifestEntry = readManifestEntryPoint(extractDir);
    const entryPoint = manifestEntry || scormEntryPoint || 'shared/launchpage.html';
    const packageFolderUrl = `${getBaseUrl()}/uploads/scorm/${folderName}`;

    return {
        scormPackageUrl: packageFolderUrl,
        scormEntryPoint: entryPoint,
        extractDir,
    };
};
