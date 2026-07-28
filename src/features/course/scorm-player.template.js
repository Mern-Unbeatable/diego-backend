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

const isCompletedStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'completed' || normalized === 'passed';
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
      var sessionStartMs = Date.now();
      var commitTimer = null;
      var finished = false;

      function notifyParent(payload) {
        try {
          if (window.parent && window.parent !== window) {
            var message = Object.assign({ source: 'lms-scorm-player' }, payload || {});
            window.parent.postMessage(message, '*');
          }
        } catch (e) {}
      }

      function formatSessionTime() {
        var elapsed = Math.max(0, Math.floor((Date.now() - sessionStartMs) / 1000));
        var h = Math.floor(elapsed / 3600);
        var m = Math.floor((elapsed % 3600) / 60);
        var s = elapsed % 60;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      }

      function postRuntime(path, body) {
        try {
          return fetch(API_BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true,
            credentials: 'omit',
          }).then(function (res) {
            return res.json().catch(function () { return null; });
          }).catch(function () { return null; });
        } catch (e) {
          return Promise.resolve(null);
        }
      }

      function commitRuntime() {
        cmi['cmi.core.session_time'] = formatSessionTime();
        return postRuntime('/api/v1/scorm/runtime/commit', {
          sessionId: SESSION_ID,
          cmiData: cmi,
        }).then(function (response) {
          var data = response && response.data ? response.data : response;
          var status = data && data.status ? data.status : cmi['cmi.core.lesson_status'];
          notifyParent({
            type: 'scorm-progress',
            sessionId: SESSION_ID,
            status: status,
            completed: data && data.completed,
            score: data && data.score,
          });
          if (data && data.completed) {
            notifyParent({
              type: 'scorm-complete',
              sessionId: SESSION_ID,
              status: data.status,
              score: data.score,
            });
          }
          return data;
        });
      }

      function finishRuntime() {
        if (finished) return Promise.resolve();
        finished = true;
        if (commitTimer) clearInterval(commitTimer);
        cmi['cmi.core.session_time'] = formatSessionTime();
        return postRuntime('/api/v1/scorm/runtime/finish', {
          sessionId: SESSION_ID,
          cmiData: cmi,
        }).then(function (response) {
          var data = response && response.data ? response.data : response;
          notifyParent({
            type: 'scorm-complete',
            sessionId: SESSION_ID,
            status: data && data.status,
            score: data && data.score,
            completed: true,
          });
        });
      }

      window.API = {
        LMSInitialize: function () { return 'true'; },
        LMSFinish: function () {
          finishRuntime();
          return 'true';
        },
        LMSGetValue: function (element) {
          return cmi[element] != null ? String(cmi[element]) : '';
        },
        LMSSetValue: function (element, value) {
          cmi[element] = value;
          if (element === 'cmi.core.lesson_status' || element === 'cmi.completion_status') {
            if (isCompletedStatus(value)) {
              commitRuntime();
            }
          }
          return 'true';
        },
        LMSCommit: function () {
          commitRuntime();
          return 'true';
        },
        LMSGetLastError: function () { return '0'; },
        LMSGetErrorString: function () { return ''; },
        LMSGetDiagnostic: function () { return ''; },
      };

      commitTimer = setInterval(commitRuntime, 30000);
      window.addEventListener('beforeunload', function () { finishRuntime(); });

      document.getElementById('scoFrame').src = ${safeContentUrl};
      notifyParent({ type: 'scorm-launched', sessionId: SESSION_ID });
    })();
  </script>
</body>
</html>`;
};
