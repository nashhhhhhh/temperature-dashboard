const container = document.getElementById('floorplan-container');
const tooltip = document.getElementById('temperature-tooltip');

let scale = 1;
let panX = 0;
let panY = 0;
let viewport = null;
let overlayLayer = null;
let roomShapeData = {};
let roomDataByCode = {};

let latestData = [];

function toNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatNumber(value, digits = 2, fallback = "N/A") {
  const num = toNumber(value);
  return num === null ? fallback : num.toFixed(digits);
}

function buildExpectedRangeText(range) {
  if (!range || !range.configured) return null;
  if (range.label) {
    return `Configured Threshold: ${range.label}`;
  }
  if (range.min_normal === null || range.min_normal === undefined) {
    return `Configured Threshold: <= ${formatNumber(range.max_normal)} deg C`;
  }
  if (range.max_normal === null || range.max_normal === undefined) {
    return `Configured Threshold: >= ${formatNumber(range.min_normal)} deg C`;
  }
  const min = formatNumber(range.min_normal);
  const max = formatNumber(range.max_normal);
  return min === max
    ? `Configured Threshold: ${min} deg C`
    : `Configured Threshold: ${min} to ${max} deg C`;
}

function buildThresholdDeviationText(room) {
  const range = room?.expected_range;
  const actual = toNumber(room?.["Actual Temp"]);
  if (!range?.configured || actual === null) return null;

  const min = toNumber(range.min_normal);
  const max = toNumber(range.max_normal);

  if (min !== null && actual < min) {
    return `Deviation vs Threshold: -${formatNumber(min - actual)} deg C`;
  }
  if (max !== null && actual > max) {
    return `Deviation vs Threshold: +${formatNumber(actual - max)} deg C`;
  }
  return `Deviation vs Threshold: 0.00 deg C`;
}

function buildEnergyTooltipLines(energy, insight) {
  if (!energy || !energy.mapped) return [];
  if (!energy.available) {
    return [
      `Energy: ${energy.label || energy.source_key || "Mapped source"} unavailable`,
      `Energy Status: ${energy.status || "UNAVAILABLE"}`
    ];
  }

  const lines = [
    `Energy: ${formatNumber(energy.latest_value, 3)} ${energy.unit || "kWh"}`,
    `Energy Status: ${energy.status || "NORMAL"}`
  ];
  if (energy.baseline !== null && energy.baseline !== undefined) {
    lines.push(`Energy Baseline: ${formatNumber(energy.baseline, 3)} ${energy.unit || "kWh"}`);
  }
  if (insight) lines.push(`Insight: ${insight}`);
  return lines;
}

function normalizeRoomCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(':', '-');
}

function getTemperatureColour(status) {
  return status === 'OK' ? '#22c55e' : '#ef4444';
}

function getTemperatureLabel(status) {
  return status === 'OK' ? 'Within Requirements' : 'Out of Tolerance';
}

function applyNoDataStyle(shape) {
  shape.dataset.status = 'NO_DATA';
  shape.dataset.temperatureMapped = 'false';
  shape.dataset.baseColour = 'url(#no-data-hatch)';
  shape.dataset.hoverColour = '';
  shape.style.display = '';
  shape.style.fill = 'url(#no-data-hatch)';
  shape.style.fillOpacity = '0.62';
  shape.style.stroke = '#64748b';
  shape.style.strokeWidth = '0.24';
  shape.style.strokeOpacity = '0.78';
  shape.style.strokeLinejoin = 'round';
  shape.style.strokeLinecap = 'round';
  shape.style.vectorEffect = 'none';
  shape.style.filter = '';
}

function shadeHexColour(hex, amount = -34) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return hex;

  const clamp = value => Math.max(0, Math.min(255, value));
  const channels = [0, 2, 4].map(index => {
    const next = clamp(parseInt(clean.slice(index, index + 2), 16) + amount);
    return next.toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

function getUnitDisplayName(unit, index) {
  const code = unit?.source_code || unit?.unit_code ? String(unit.source_code || unit.unit_code).replace(':', '-') : `Unit ${index + 1}`;
  const label = String(unit?.unit_label || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!label) return code;
  if (label.toUpperCase().includes(code.toUpperCase())) return label;

  const unitCoolerMatch = label.match(/\bUC\.?\s*\d+\b/i);
  if (unitCoolerMatch) {
    return `${unitCoolerMatch[0].replace(/\s+/g, '').toUpperCase()} (${code})`;
  }

  const compactLabel = label
    .replace(/\bOUTGOING WAREHOUSE\s*/i, '')
    .replace(/\bMANUAL PALLETISING\s*/i, '')
    .replace(/\bMANUAL PALLETIZING\s*/i, '')
    .replace(/\bSTAGING AREA CHILLED\s*/i, '')
    .trim();

  return compactLabel ? `${compactLabel} (${code})` : code;
}

function getUnitRowsHtml(units = []) {
  if (!Array.isArray(units) || units.length === 0) return '';
  const unitCount = units.length;
  const gridClass = unitCount >= 10 ? 'many' : unitCount >= 5 ? 'medium' : 'small';
  const rows = units.map((unit, index) => {
    const status = unit.status || 'UNKNOWN';
    const statusClass = status === 'OK' ? 'ok' : 'critical';
    return `
      <div class="tooltip-unit ${statusClass}">
        <div class="tooltip-unit-head">
          <span>${getUnitDisplayName(unit, index)}</span>
          <b>${getTemperatureLabel(status)}</b>
        </div>
        <div class="tooltip-unit-grid">
          <span>Actual</span><b>${formatNumber(unit["Actual Temp"])} deg C</b>
          <span>Required</span><b>${formatNumber(unit.Requirement)} deg C</b>
          <span>Delta</span><b>${formatNumber(unit.temp_diff)} deg C</b>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="tooltip-units ${gridClass}">
      <div class="tooltip-section-title">${unitCount === 1 ? 'Unit Cooler' : 'Unit Coolers'}</div>
      ${rows}
    </div>
  `;
}

function getTooltipHtml(roomCode) {
  const room = roomDataByCode[roomCode];
  const shape = roomShapeData[roomCode] || {};
  const displayName = shape.name || room?.room_name || 'Temperature room';
  if (!room) {
    return `
      <div class="tooltip-heading">
        <span>${roomCode}</span>
        <strong>${displayName}</strong>
      </div>
      <div class="tooltip-status no-data">
        <i></i>
        No Live Data
      </div>
      <div class="tooltip-muted">No matching source cooler in the current temperature export</div>
    `;
  }

  const status = room.status || 'UNKNOWN';
  const statusClass = status === 'OK' ? 'ok' : 'critical';
  return `
    <div class="tooltip-heading">
      <span>${roomCode}</span>
      <strong>${displayName}</strong>
    </div>
    <div class="tooltip-status ${statusClass}">
      <i></i>
      ${getTemperatureLabel(status)}
    </div>
    <div class="tooltip-grid">
      <span>Actual</span><b>${formatNumber(room["Actual Temp"])} deg C</b>
      <span>Required</span><b>${formatNumber(room.Requirement)} deg C</b>
      <span>Difference</span><b>${formatNumber(room.temp_diff)} deg C</b>
    </div>
    ${getUnitRowsHtml(room.units)}
  `;
}

function positionTooltipForShape(shape, event) {
  if (!tooltip || !tooltip.classList.contains('open')) return;
  const offset = 14;
  const shapeRect = shape?.getBoundingClientRect?.();
  const containerRect = container?.getBoundingClientRect?.();
  const tooltipRect = tooltip.getBoundingClientRect();
  const safeLeft = 12;
  const safeTop = 12;
  const maxLeft = window.innerWidth - tooltipRect.width - safeLeft;
  const maxTop = window.innerHeight - tooltipRect.height - safeTop;

  if (!shapeRect || !containerRect) {
    tooltip.style.left = `${Math.max(safeLeft, Math.min(event.clientX + offset, maxLeft))}px`;
    tooltip.style.top = `${Math.max(safeTop, Math.min(event.clientY + offset, maxTop))}px`;
    return;
  }

  if (tooltip.classList.contains('wide')) {
    tooltip.style.left = `${Math.max(safeLeft, Math.min(window.innerWidth - tooltipRect.width - offset, maxLeft))}px`;
    tooltip.style.top = `${Math.max(safeTop, Math.min(containerRect.top + offset, maxTop))}px`;
    return;
  }

  const shapeCenterX = shapeRect.left + shapeRect.width / 2;
  const shapeCenterY = shapeRect.top + shapeRect.height / 2;
  const containerCenterX = containerRect.left + containerRect.width / 2;
  const sideLeft = shapeCenterX > containerCenterX;
  const preferredLeft = sideLeft
    ? containerRect.left + offset
    : containerRect.right - tooltipRect.width - offset;
  const preferredTop = shapeCenterY > (containerRect.top + containerRect.height / 2)
    ? containerRect.top + offset
    : containerRect.bottom - tooltipRect.height - offset;

  tooltip.style.left = `${Math.max(safeLeft, Math.min(preferredLeft, maxLeft))}px`;
  tooltip.style.top = `${Math.max(safeTop, Math.min(preferredTop, maxTop))}px`;
}

function showTooltip(roomCode, event, shape = event?.currentTarget) {
  if (!tooltip) return;
  const room = roomDataByCode[roomCode];
  tooltip.classList.toggle('wide', Array.isArray(room?.units) && room.units.length >= 10);
  tooltip.innerHTML = getTooltipHtml(roomCode);
  tooltip.classList.add('open');
  positionTooltipForShape(shape, event);
}

function hideTooltip() {
  tooltip?.classList.remove('open', 'wide');
}

function createRoomShape(room) {
  const shape = document.createElementNS('http://www.w3.org/2000/svg', room.svgPath ? 'path' : 'rect');
  shape.classList.add('room', 'temperature-room');
  shape.dataset.roomCode = room.code;
  shape.dataset.status = 'NO_DATA';
  shape.setAttribute('role', 'img');
  shape.setAttribute('aria-label', `${room.code} ${room.name}`);
  shape.setAttribute('focusable', 'false');

  if (room.svgPath) {
    shape.setAttribute('d', room.svgPath);
  } else {
    shape.setAttribute('x', room.left);
    shape.setAttribute('y', room.top);
    shape.setAttribute('width', room.width);
    shape.setAttribute('height', room.height);
  }

  shape.addEventListener('mouseenter', event => showTooltip(room.code, event, shape));
  shape.addEventListener('mousemove', event => positionTooltipForShape(shape, event));
  shape.addEventListener('mouseleave', hideTooltip);
  shape.addEventListener('mouseenter', () => {
    if (shape.dataset.status === 'NO_DATA') {
      applyNoDataStyle(shape);
      return;
    }
    const hoverColour = shape.dataset.hoverColour;
    if (!hoverColour || shape.style.display === 'none') return;
    shape.style.fill = hoverColour;
    shape.style.stroke = hoverColour;
    shape.style.fillOpacity = '0.76';
    shape.style.strokeOpacity = '0.76';
    shape.style.strokeWidth = '0.3';
  });
  shape.addEventListener('mouseleave', () => {
    if (shape.dataset.status === 'NO_DATA') {
      applyNoDataStyle(shape);
      return;
    }
    const colour = shape.dataset.baseColour;
    if (!colour) return;
    shape.style.fill = colour;
    shape.style.stroke = colour;
    shape.style.fillOpacity = '0.68';
    shape.style.strokeOpacity = '0.68';
    shape.style.strokeWidth = '0.3';
    shape.style.filter = '';
  });
  shape.addEventListener('mousedown', event => {
    event.preventDefault();
    shape.blur();
  });
  shape.addEventListener('focus', event => {
    const rect = event.currentTarget.getBoundingClientRect();
    showTooltip(room.code, {
      clientX: rect.left + rect.width,
      clientY: rect.top
    }, event.currentTarget);
  });
  shape.addEventListener('blur', hideTooltip);
  return shape;
}

function prepareRoomLayers(rooms) {
  return Object.values(rooms)
    .map(room => ({
      ...room,
      area: Number(room.width || 0) * Number(room.height || 0)
    }))
    .sort((a, b) => b.area - a.area);
}

function buildPptMap(rooms) {
  roomShapeData = rooms;
  container.innerHTML = `
    <div id="viewport" class="temperature-map-stage">
      <img class="temperature-floorplan-image" src="/static/images/stage2_layout.png?v=slide3-crop-20260521-1" alt="Stage 2 floor plan">
      <svg id="temperature-room-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Temperature room status overlay">
        <defs>
          <pattern id="no-data-hatch" width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="2.2" stroke="#64748b" stroke-width="0.28" opacity="0.75"></line>
          </pattern>
        </defs>
      </svg>
    </div>
  `;

  viewport = document.getElementById('viewport');
  overlayLayer = document.getElementById('temperature-room-overlay');

  prepareRoomLayers(rooms)
    .filter(room => room.interactive !== false)
    .forEach(room => {
      overlayLayer.appendChild(createRoomShape(room));
    });
}

/* =========================
   LOAD PPT MAP
========================= */
fetch('/static/data/room_shapes.json')
  .then(res => {
    if (!res.ok) throw new Error(`Room map failed: HTTP ${res.status}`);
    return res.json();
  })
  .then(rooms => {
    buildPptMap(rooms);
    initPanZoom();
    syncRoomData();
    fitToWidth();
  })
  .catch(err => {
    console.error('Floorplan load error:', err);
  });

/* =========================
   FETCH DATA FROM API
========================= */
async function syncRoomData() {
  try {
    const res = await fetch('/api/temperature/rooms');
    latestData = await res.json();

    updateSummary(latestData);
    applyDataToSVG(latestData);
  } catch (err) {
    console.error('API Sync Error:', err);
  }
}

/* =========================
   APPLY DATA TO SVG
========================= */
function applyDataToSVG(data) {
  roomDataByCode = {};
  document.querySelectorAll('.temperature-room').forEach(room => {
    applyNoDataStyle(room);
  });

  data.forEach(room => {
    if (!room.base_room) {
      console.error('Missing base_room in API payload:', room);
      return;
    }

    const roomCode = normalizeRoomCode(room.base_room);
    roomDataByCode[roomCode] = room;

    const el = overlayLayer?.querySelector(`[data-room-code="${roomCode}"]`);
    if (!el) {
      console.warn('PPT room shape not found:', roomCode);
      return;
    }

    const status = room.status || 'UNKNOWN';
    const colour = getTemperatureColour(status);

    el.style.display = '';
    el.style.fill = colour;
    el.style.fillOpacity = '0.68';
    el.style.stroke = colour;
    el.style.strokeWidth = '0.3';
    el.style.strokeOpacity = '0.68';
    el.style.strokeLinejoin = 'round';
    el.style.strokeLinecap = 'round';
    el.style.vectorEffect = 'none';

    el.dataset.status = status;
    el.dataset.baseColour = colour;
    el.dataset.hoverColour = shadeHexColour(colour, -42);
    el.dataset.temperatureMapped = 'true';
  });
}

/* =========================
   SUMMARY COUNTERS
========================= */
function updateSummary(data) {
  let req = 0;
  let out = 0;

  data.forEach(room => {
    if (room.status === 'OK') req++;
    else out++;
  });

  document.getElementById('count-req').textContent = req;
  document.getElementById('count-out').textContent = out;
}

/* =========================
   FILTER ROOMS
========================= */
function filterRooms(type) {
  document.querySelectorAll('.room').forEach(room => {
    const status = room.dataset.status;
    const hasNoData = status === 'NO_DATA';

    if (type === 'all') room.style.display = '';
    else if (hasNoData) room.style.display = '';
    else if (type === 'req' && status === 'OK') room.style.display = '';
    else if (type === 'out' && status !== 'OK' && status !== 'UNKNOWN') room.style.display = '';
    else room.style.display = 'none';
  });
}

/* =========================
   PAN & ZOOM
========================= */
function initPanZoom() {
  if (!container || !viewport) return;

  container.addEventListener('scroll', hideTooltip, { passive: true });
  document.addEventListener('scroll', hideTooltip, true);
}

/* =========================
   FIT SVG TO CONTAINER
========================= */
function fitToWidth() {
  if (!container || !viewport) return;
  scale = 1;
  panX = 0;
  panY = 0;
  viewport.style.setProperty('--temp-pan-x', '0px');
  viewport.style.setProperty('--temp-pan-y', '0px');
  viewport.style.setProperty('--temp-drag-scale', '1');
}
