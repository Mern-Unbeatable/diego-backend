const SCORM_STATUS_TO_CMI = {
  NOT_ATTEMPTED: 'not attempted',
  INCOMPLETE: 'incomplete',
  COMPLETED: 'completed',
  PASSED: 'passed',
  FAILED: 'failed',
  UNKNOWN: 'not attempted',
};

const buildInitialCmi = (resumeData, lastStatus) => {
  const defaults = {
    'cmi.core.lesson_status': SCORM_STATUS_TO_CMI[lastStatus] ?? 'not attempted',
    'cmi.core.lesson_location': '0',
    'cmi.core.score.raw': '',
    'cmi.core.score.min': '0',
    'cmi.core.score.max': '100',
    'cmi.core.session_time': '00:00:00',
    'cmi.core.exit': '',
  };

  if (!resumeData || typeof resumeData !== 'object') {
    return defaults;
  }

  const merged = { ...defaults, ...resumeData };
  const location = merged['cmi.core.lesson_location'];
  const parsedLocation = parseInt(location, 10);
  if (Number.isNaN(parsedLocation) || parsedLocation < 0) {
    merged['cmi.core.lesson_location'] = '0';
  }

  return merged;
};

export const buildScormPlayerHtml = ({
  sessionId,
  contentUrl,
  apiBaseUrl,
  resumeData,
  lastStatus,
}) => {
  const initialCmi = buildInitialCmi(resumeData, lastStatus);
  const safeSessionId = JSON.stringify(sessionId);
  const safeContentUrl = JSON.stringify(contentUrl);
  const safeApiBase = JSON.stringify(apiBaseUrl.replace(/\/$/, ''));
  const safeInitialCmi = JSON.stringify(initialCmi);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SCORM Player</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: #fff; }
    #scoFrame { display: block; width: 100%; height: 100%; min-height: 520px; border: 0; background: #fff; }
  </style>
</head>
<body>
  <iframe id="scoFrame" title="SCORM content"></iframe>
  <script>
    (function () {
      var SESSION_ID = ${safeSessionId};
      var API_BASE = ${safeApiBase};
      var cmi = ${safeInitialCmi};

      function postRuntime(path, body) {
        try {
          fetch(API_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true,
            credentials: 'omit',
          }).catch(function () {});
        } catch (e) {}
      }

      window.API = {
        LMSInitialize: function () { return 'true'; },
        LMSFinish: function () {
          postRuntime('/api/v1/scorm/runtime/finish', {
            sessionId: SESSION_ID,
            cmiData: cmi,
          });
          return 'true';
        },
        LMSGetValue: function (element) {
          return cmi[element] != null ? String(cmi[element]) : '';
        },
        LMSSetValue: function (element, value) {
          cmi[element] = value;
          return 'true';
        },
        LMSCommit: function () {
          postRuntime('/api/v1/scorm/runtime/commit', {
            sessionId: SESSION_ID,
            cmiData: cmi,
          });
          return 'true';
        },
        LMSGetLastError: function () { return '0'; },
        LMSGetErrorString: function () { return ''; },
        LMSGetDiagnostic: function () { return ''; },
      };

      document.getElementById('scoFrame').src = ${safeContentUrl};
    })();
  </script>
</body>
</html>`;
};
