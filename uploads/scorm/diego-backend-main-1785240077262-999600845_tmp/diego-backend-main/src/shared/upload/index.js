import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { config as appConfig } from '../../config/config.js';

const baseUploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(baseUploadsDir)) fs.mkdirSync(baseUploadsDir, { recursive: true });

const getBaseUrl = () => appConfig.BACKEND_URL || 'http://localhost:5000';
const sanitize = (name) => name.replace(/[^a-zA-Z0-9-_]/g, '_');

// ── Reusable type groups — add more as new features need them ──
const TYPE_GROUPS = {
    image: { exts: /jpe?g|png|gif|webp/, mimes: /^image\/(jpeg|jpg|png|gif|webp)$/ },
    pdf: { exts: /pdf/, mimes: /^application\/pdf$/ },
    document: { exts: /pdf|docx?|xlsx?|pptx?/, mimes: /^application\/(pdf|msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.ms-powerpoint)/ },
    zip: { exts: /zip/, mimes: /^application\/(zip|x-zip-compressed)$/ },
    video: { exts: /mp4|mov|avi|mkv|webm/, mimes: /^video\// },
    any: null, // no restriction
};

const matchesType = (file, typeKey) => {
    const group = TYPE_GROUPS[typeKey];
    if (!group) return true; // 'any' or unset
    const extOk = group.exts.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = group.mimes.test(file.mimetype);
    return extOk && mimeOk;
};

// Storage  depends on WHICH field the file came in on
const buildStorage = (folderByField) => multer.diskStorage({
    destination: (req, file, cb) => {
        const folder = folderByField[file.fieldname] || 'misc';
        const dir = path.join(baseUploadsDir, folder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const base = sanitize(path.basename(file.originalname, ext));
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${base}-${unique}${ext}`);
    },
});
// ✅ Fixed: Single image upload with custom field mapping
export const uploadSingleImage = (fieldName = "image", folderName = "users", targetField = null) => {
    const upload = multer({
        storage: createStorage(folderName),
        limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
        fileFilter,
    });

    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message
                });
            }

            // ✅ If file uploaded, set URL in req.body
            if (req.file) {
                const baseUrl = getBaseUrl();
                const fileUrl = `${baseUrl}/uploads/${folderName}/${req.file.filename}`;

                // ✅ Use targetField if provided, otherwise use fieldName
                const target = targetField || fieldName;
                req.body[target] = fileUrl;

                // ✅ Also store in req for easy access
                req.uploadedFile = {
                    url: fileUrl,
                    filename: req.file.filename,
                    fieldname: req.file.fieldname,
                    size: req.file.size,
                    mimetype: req.file.mimetype,
                };
            }
            next();
        });
    };
};

// ✅ Multiple images upload
export const uploadMultipleImages = (
    fieldName = "gallery",
    folderName = "products",
    maxCount = 10
) => {
    return (req, res, next) => {
        const upload = multer({
            storage: createStorage(folderName),
            limits: { fileSize: 10 * 1024 * 1024 },
            fileFilter,
        }).array(fieldName, maxCount);

        upload(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                if (err.code === "LIMIT_FILE_SIZE") {
                    return res.status(400).json({
                        success: false,
                        message: "File too large. Maximum size is 10MB",
                    });
                }
                if (err.code === "LIMIT_UNEXPECTED_FILE") {
                    return res.status(400).json({
                        success: false,
                        message: `Too many files. Maximum is ${maxCount}`,
                    });
                }
                return res.status(400).json({
                    success: false,
                    message: err.message,
                });
            } else if (err) {
                return res.status(400).json({
                    success: false,
                    message: err.message,
                });
            }

            // Process uploaded files
            if (req.files && req.files.length > 0) {
                const baseUrl = getBaseUrl();
                req.body[fieldName] = req.files.map(
                    (file) => `${baseUrl}/uploads/${folderName}/${file.filename}`
                );
            }

            next();
        });
    };
};
export const createUploadMiddleware = (fields) => {
    const folderByField = {};
    fields.forEach(f => { folderByField[f.name] = f.folder || 'misc'; });

    // multer only supports one global byte limit — use the largest field's cap
    // as the ceiling, then enforce each field's real cap ourselves below.
    const globalMaxBytes = Math.max(...fields.map(f => f.maxSizeMB || 10)) * 1024 * 1024;

    const upload = multer({
        storage: buildStorage(folderByField),
        limits: { fileSize: globalMaxBytes },
        fileFilter: (req, file, cb) => {
            const def = fields.find(f => f.name === file.fieldname);
            if (!def) return cb(new Error(`Unexpected file field: "${file.fieldname}"`));
            if (!matchesType(file, def.type)) {
                return cb(new Error(`Invalid file type for "${file.fieldname}" (expected: ${def.type})`));
            }
            cb(null, true);
        },
    }).fields(fields.map(f => ({ name: f.name, maxCount: f.maxCount || 1 })));

    return (req, res, next) => {
        upload(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ success: false, message: 'File too large.' });
                }
                if (err.code === 'LIMIT_UNEXPECTED_FILE') {
                    return res.status(400).json({ success: false, message: `Unexpected file field: "${err.field}"` });
                }
                return res.status(400).json({ success: false, message: err.message });
            }
            if (err) return res.status(400).json({ success: false, message: err.message });

            const files = req.files || {};

            // ✅ Enforce each field's OWN size cap (multer only gave us one global cap above)
            for (const def of fields) {
                const cap = (def.maxSizeMB || 10) * 1024 * 1024;
                for (const file of files[def.name] || []) {
                    if (file.size > cap) {
                        fs.unlink(file.path, () => { }); // clean up the oversized file
                        return res.status(400).json({
                            success: false,
                            message: `"${def.name}" exceeds the ${def.maxSizeMB}MB limit`,
                        });
                    }
                }
            }

            // ✅ Required-file check
            for (const def of fields) {
                if (def.required && !(files[def.name]?.length)) {
                    return res.status(400).json({
                        success: false,
                        message: `"${def.name}" file is required`,
                    });
                }
            }

            // ✅ Map uploaded files into req.body under the correct schema field name
            const baseUrl = getBaseUrl();
            req.uploadedFiles = {};

            for (const def of fields) {
                const uploaded = files[def.name];
                if (!uploaded?.length) continue;

                const urls = uploaded.map(f => `${baseUrl}/uploads/${def.folder || 'misc'}/${f.filename}`);
                req.body[def.targetField || def.name] = (def.maxCount || 1) > 1 ? urls : urls[0];

                req.uploadedFiles[def.name] = uploaded.map((f, i) => ({
                    url: urls[i], filename: f.filename, size: f.size, mimetype: f.mimetype,
                }));
            }

            next();
        });
    };
};

// ✅ Generic JSON-field parser — turns stringified nested objects back into objects
// (form-data can't carry JSON natively; frontend must JSON.stringify these fields)
export const parseJsonFields = (fieldNames) => (req, res, next) => {
    for (const field of fieldNames) {
        if (typeof req.body[field] === 'string') {
            try {
                req.body[field] = JSON.parse(req.body[field]);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: `Field "${field}" must be valid JSON when sent via form-data`,
                });
            }
        }
    }
    next();
};
