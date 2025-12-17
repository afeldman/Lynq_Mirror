const LOG_LIMIT = 1000;

function formatWallTime(ms, isoFallback) {
  if (!Number.isFinite(ms)) {
    return isoFallback || 'unknown';
  }
  try {
    const iso = new Date(ms).toISOString();
    const [, timePart] = iso.split('T');
    return timePart ? timePart.replace('Z', 'Z') : iso;
  } catch (error) {
    return isoFallback || 'invalid';
  }
}

function formatPerfTime(perf) {
  if (!Number.isFinite(perf)) {
    return null;
  }
  return `${perf.toFixed(2)} ms`;
}

function createMetaChip(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function serializeDetails(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return '[Circular]';
          }
          seen.add(val);
        }
        if (val instanceof Map) {
          return {
            type: 'Map',
            size: val.size,
            entries: Array.from(val.entries()).slice(0, 32)
          };
        }
        if (val instanceof Set) {
          return {
            type: 'Set',
            size: val.size,
            values: Array.from(val.values()).slice(0, 32)
          };
        }
        if (ArrayBuffer.isView(val)) {
          const arrayView = typeof val.slice === 'function' ? val.slice(0, 32) : Array.from(val).slice(0, 32);
          return {
            type: val.constructor?.name || 'TypedArray',
            length: val.length,
            preview: Array.from(arrayView)
          };
        }
        if (val instanceof ArrayBuffer) {
          return { type: 'ArrayBuffer', byteLength: val.byteLength };
        }
        if (val instanceof Date) {
          return val.toISOString();
        }
        return val;
      },
      2
    );
  } catch (error) {
    return `Unable to serialise details: ${error?.message || error}`;
  }
}

function createDebugSink() {
  const logOutput = document.getElementById('debug-log-output');
  const countElement = document.getElementById('debug-log-count');
  const clearButton = document.getElementById('debug-log-clear');
  const downloadButton = document.getElementById('debug-log-download');

  if (!logOutput || !countElement || !clearButton || !downloadButton) {
    throw new Error('Debug log elements are missing from the page.');
  }

  const entries = [];
  const entryElements = [];
  let stickToBottom = true;
  let placeholder = null;

  function formatEntryTimestamp(entry) {
    if (Number.isFinite(entry.wallTimeMs)) {
      try {
        return new Date(entry.wallTimeMs).toISOString();
      } catch (error) {
        // fall through
      }
    }
    if (typeof entry.isoTime === 'string' && entry.isoTime) {
      return entry.isoTime;
    }
    return 'unknown';
  }

  function formatEntryForExport(entry, index) {
    const lines = [];
    const timestamp = formatEntryTimestamp(entry);
    const level = entry.level ? String(entry.level).toUpperCase() : 'INFO';
    const source = entry.source || 'unknown';
    const title = entry.title || entry.message || 'Log entry';
    lines.push(`${index + 1}. [${timestamp}] [${level}] (${source}) ${title}`);

    const metaParts = [];
    if (entry.type && entry.type !== 'log') {
      metaParts.push(`event=${entry.type}`);
    }
    if (Number.isFinite(entry.perfTimeMs)) {
      metaParts.push(`perf=${entry.perfTimeMs.toFixed(2)}ms`);
    }
    if (Array.isArray(entry.extraMeta) && entry.extraMeta.length) {
      entry.extraMeta
        .filter(Boolean)
        .forEach((chip) => metaParts.push(chip));
    }

    if (metaParts.length) {
      lines.push(`   Meta: ${metaParts.join(' | ')}`);
    }

    if (entry.detailsText) {
      lines.push('   Details:');
      entry.detailsText
        .split(/\r?\n/)
        .forEach((detailLine) => {
          lines.push(`     ${detailLine}`);
        });
    }

    return lines.join('\n');
  }

  function buildExportText() {
    const header = [
      'Mirror Debug Log Export',
      `Generated: ${new Date().toISOString()}`,
      `Total entries: ${entries.length}`
    ];

    if (!entries.length) {
      return `${header.join('\n')}\n\nNo log entries captured.`;
    }

    const formattedEntries = entries.map((entry, index) =>
      formatEntryForExport(entry, index)
    );

    return `${header.join('\n')}\n\n${formattedEntries.join('\n\n')}`;
  }

  function triggerDownload() {
    try {
      const exportText = buildExportText();
      const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const iso = new Date().toISOString().replace(/[:]/g, '-');
      anchor.href = url;
      anchor.download = `mirror-debug-log-${iso}.txt`;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    } catch (error) {
      console.error('Failed to export debug logs', error);
    }
  }

  function updateCount() {
    countElement.textContent = `${entries.length} entries`;
  }

  function ensurePlaceholder() {
    if (placeholder) {
      return;
    }
    placeholder = document.createElement('p');
    placeholder.className = 'debug-log-placeholder';
    placeholder.textContent = 'Logs will appear here as events run.';
    logOutput.appendChild(placeholder);
  }

  function removePlaceholder() {
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }
    placeholder = null;
  }

  ensurePlaceholder();
  updateCount();

  logOutput.addEventListener('scroll', () => {
    const threshold = 24;
    stickToBottom =
      logOutput.scrollTop + logOutput.clientHeight >= logOutput.scrollHeight - threshold;
  });

  function appendEntry(entry) {
    removePlaceholder();
    entries.push(entry);
    if (entries.length > LOG_LIMIT) {
      entries.shift();
      const removed = entryElements.shift();
      if (removed && removed.parentNode === logOutput) {
        removed.parentNode.removeChild(removed);
      }
    }

    const article = document.createElement('article');
    const classes = ['debug-log-entry'];
    if (entry.type === 'blendshape') {
      classes.push('debug-log-entry--blendshape');
    }
    if (entry.source && entry.source.includes('audio2face')) {
      classes.push('debug-log-entry--a2f');
    }
    if (entry.level === 'warn' || entry.level === 'warning') {
      classes.push('debug-log-entry--warning');
    } else if (entry.level === 'error') {
      classes.push('debug-log-entry--error');
    }
    article.className = classes.join(' ');

    const heading = document.createElement('h2');
    heading.textContent = entry.title || entry.message || 'Log entry';
    article.appendChild(heading);

    const meta = document.createElement('div');
    meta.className = 'debug-log-meta';

    const wallTimeChip = formatWallTime(entry.wallTimeMs, entry.isoTime);
    if (wallTimeChip) {
      meta.appendChild(createMetaChip(`Wall: ${wallTimeChip}`));
    }
    const perfTimeChip = formatPerfTime(entry.perfTimeMs);
    if (perfTimeChip) {
      meta.appendChild(createMetaChip(`Perf: ${perfTimeChip}`));
    }
    if (entry.source) {
      meta.appendChild(createMetaChip(`Source: ${entry.source}`));
    }
    if (entry.type && entry.type !== 'log') {
      meta.appendChild(createMetaChip(`Event: ${entry.type}`));
    }
    if (Array.isArray(entry.extraMeta)) {
      entry.extraMeta.forEach((chip) => {
        if (chip) {
          meta.appendChild(createMetaChip(chip));
        }
      });
    }
    article.appendChild(meta);

    if (entry.detailsText) {
      const details = document.createElement('pre');
      details.className = 'debug-log-details';
      details.textContent = entry.detailsText;
      article.appendChild(details);
    }

    logOutput.appendChild(article);
    entryElements.push(article);
    updateCount();

    if (stickToBottom) {
      logOutput.scrollTop = logOutput.scrollHeight;
    }
  }

  function normaliseEntryFromEvent(event) {
    if (!event || typeof event !== 'object') {
      return null;
    }
    const base = {
      type: event.type || 'log',
      message: event.message || event.title || 'Log entry',
      title: event.title || event.message || 'Log entry',
      level: event.level || 'info',
      source: event.source || 'face',
      wallTimeMs: Number.isFinite(event.wallTimeMs) ? event.wallTimeMs : null,
      perfTimeMs: Number.isFinite(event.perfTimeMs) ? event.perfTimeMs : null,
      isoTime: typeof event.isoTime === 'string' ? event.isoTime : null,
      extraMeta: []
    };

    if (event.type === 'blendshape-frame-applied') {
      base.title = 'Blendshape frame applied';
      base.type = 'blendshape';
      if (event.mode) {
        base.extraMeta.push(`Mode: ${event.mode}`);
      }
      if (Number.isFinite(event.totalsCount)) {
        base.extraMeta.push(`Totals: ${event.totalsCount}`);
      }
      if (Number.isFinite(event.frameTimestampMs)) {
        base.extraMeta.push(`Frame: ${event.frameTimestampMs.toFixed(3)} ms`);
      }
      if (Number.isFinite(event.audioTimeSec)) {
        base.extraMeta.push(`Audio: ${event.audioTimeSec.toFixed(3)} s`);
      }
      const detailPayload = {
        mode: event.mode || null,
        totalsCount: event.totalsCount || 0,
        topBlendshapes: event.totalsSummary || [],
        vowelActive: Boolean(event.vowelActive),
        amplitude: Number.isFinite(event.amplitude) ? Number(event.amplitude.toFixed(3)) : event.amplitude,
        audioTimeSec: Number.isFinite(event.audioTimeSec) ? Number(event.audioTimeSec) : event.audioTimeSec,
        metrics: event.metrics || []
      };
      base.detailsText = serializeDetails(detailPayload);
      return base;
    }

    const detailsText = serializeDetails(event.details);
    base.detailsText = detailsText;
    return base;
  }

  const sink = {
    log(payload = {}) {
      const entry = normaliseEntryFromEvent({ type: 'log', ...payload });
      if (entry) {
        appendEntry(entry);
      }
    },
    handleEvent(event) {
      const entry = normaliseEntryFromEvent(event);
      if (entry) {
        appendEntry(entry);
      }
    },
    clear() {
      entries.splice(0, entries.length);
      while (entryElements.length) {
        const el = entryElements.shift();
        if (el && el.parentNode === logOutput) {
          el.parentNode.removeChild(el);
        }
      }
      ensurePlaceholder();
      updateCount();
      stickToBottom = true;
    },
    exportAsText() {
      return buildExportText();
    },
    download() {
      triggerDownload();
    }
  };

  clearButton.addEventListener('click', () => {
    sink.clear();
  });

  downloadButton.addEventListener('click', () => {
    sink.download();
  });

  return sink;
}

window.__FACE_DEBUG_FORCE_A2F__ = true;
const sink = createDebugSink();
window.__FACE_DEBUG_SINK__ = sink;

sink.log({
  message: 'Debug monitor ready',
  details: { hint: 'Waiting for realtime events…' },
  source: 'debug',
  wallTimeMs: Date.now(),
  perfTimeMs: typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
});

import('./face.js');
