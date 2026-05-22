const TOLERANCE = 2;

let historyData = [];

async function loadHistory() {
  try {
    const res = await fetch('/api/temperature/history');
    historyData = await res.json();

    processDiagnostics(historyData);

  } catch (err) {
    console.error("History load error:", err);
  }
}

function processDiagnostics(data) {
  const roomStats = {};
  let total = 0, compliant = 0, critical = 0;
  let coilSum = 0, coilCount = 0;

  data.forEach(row => {
    const room = row.base_room;
    if (!roomStats[room]) {
      roomStats[room] = {
        air: [],
        coil: [],
        sp: []
      };
    }

    roomStats[room].air.push(row["Actual Temp"]);
    roomStats[room].sp.push(row.Requirement);

    if (row["Coil Temp"] !== undefined)
      roomStats[room].coil.push(row["Coil Temp"]);

    const delta = Math.abs(row["Actual Temp"] - row.Requirement);

    total++;
    if (delta <= TOLERANCE) compliant++;
    else critical++;
  });

  const compliancePct = (compliant / total * 100).toFixed(1);

  let worstRoom = '--';
  let worstDeviation = 0;

  Object.entries(roomStats).forEach(([room, obj]) => {
    const airDeltaMean = mean(obj.air.map((v, i) => v - obj.sp[i]));
    if (Math.abs(airDeltaMean) > worstDeviation) {
      worstDeviation = Math.abs(airDeltaMean);
      worstRoom = room;
    }
  });

  Object.values(roomStats).forEach(obj => {
    obj.coil.forEach((v, i) => {
      coilSum += obj.sp[i] - v;
      coilCount++;
    });
  });

  const coolingEff = Math.min(100, (coilSum / coilCount / 6) * 100).toFixed(1);

  document.getElementById('kpi-compliance').textContent = `${compliancePct}%`;
  document.getElementById('kpi-critical').textContent = critical;
  document.getElementById('kpi-cooling').textContent = `${coolingEff}%`;
  document.getElementById('kpi-worst').textContent = worstRoom;
  document.getElementById('kpi-coil').textContent = coilCount;

  generateTable(roomStats);
  generateCharts(data);
}

function generateTable(stats) {
  const tbody = document.querySelector('#diagnostics-table tbody');
  tbody.innerHTML = '';

  Object.entries(stats).forEach(([room, obj]) => {
    const airDelta = mean(obj.air.map((v, i) => v - obj.sp[i]));
    const coilDelta = obj.coil.length ? mean(obj.sp.map((sp, i) => sp - obj.coil[i])) : 0;

    const compliance = obj.air.filter((v, i) => Math.abs(v - obj.sp[i]) <= TOLERANCE).length / obj.air.length * 100;

    const status = compliance > 95 ? 'OK' : compliance > 85 ? 'WARNING' : 'CRITICAL';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${room}</td>
      <td>${airDelta.toFixed(2)}°C</td>
      <td>${compliance.toFixed(1)}%</td>
      <td>${coilDelta.toFixed(2)}°C</td>
      <td>${Math.min(100, coilDelta / 6 * 100).toFixed(1)}%</td>
      <td class="status ${status.toLowerCase()}">${status}</td>
    `;

    tbody.appendChild(tr);
  });
}

function generateCharts(data) {
  const labels = data.map(d => d.timestamp);

  new Chart(document.getElementById('chart-room'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Room Temp',
          data: data.map(d => d["Actual Temp"]),
          borderWidth: 2
        },
        {
          label: 'Setpoint',
          data: data.map(d => d.Requirement),
          borderDash: [5, 5],
          borderWidth: 2
        }
      ]
    }
  });

  new Chart(document.getElementById('chart-coil'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Coil Temp',
          data: data.map(d => d["Coil Temp"]),
          borderWidth: 2
        },
        {
          label: 'Setpoint',
          data: data.map(d => d.Requirement),
          borderDash: [5, 5],
          borderWidth: 2
        }
      ]
    }
  });

  const complianceTrend = data.map(d => Math.abs(d["Actual Temp"] - d.Requirement) <= TOLERANCE ? 1 : 0);

  new Chart(document.getElementById('chart-compliance'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Compliance',
        data: complianceTrend,
        borderWidth: 2
      }]
    }
  });
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

loadHistory();
