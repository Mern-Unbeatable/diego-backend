# SCORM sample packages

Place extracted SCORM 1.2 packages in these folders before testing SCORM lessons:

- `golf/index_lms.html`
- `emergency/index_lms.html`
- `fire-prevention/index_lms.html`
- `ppe-risk/index_lms.html`
- `safety-review/index_lms.html`

You can use any SCORM 1.2 sample (e.g. Rustici Golf) and copy the extracted files into each folder.

The API serves this directory at:

`{API_URL}/uploads/scorm/<folder>/index_lms.html`

Override the base URL in production with:

`SCORM_SAMPLE_BASE_URL=https://api.yourdomain.com/uploads/scorm`
