// Node Process Manager - Frontend Controller

let activeTab = 'tab-processes';
let currentLogProcessId = null;
let eventSource = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupModals();
  setupConsole();
  setupForms();

  // Initial Data Fetch
  fetchSystemInfo();
  loadProcesses();
  loadNpmPackages();

  // Periodic Refresh
  setInterval(loadProcesses, 4000);
  setInterval(fetchSystemInfo, 10000);
});

// Toast notification helper
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show';
  if (type === 'error') toast.style.borderColor = '#ef4444';
  else if (type === 'success') toast.style.borderColor = '#10b981';
  else toast.style.borderColor = '#223050';

  setTimeout(() => {
    toast.className = 'toast';
  }, 3500);
}

// Tab navigation
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      document.getElementById(activeTab).classList.add('active');

      if (activeTab === 'tab-presets') checkPresetStatuses();
      if (activeTab === 'tab-npm') loadNpmPackages();
    });
  });
}

// 1. Fetch System Info
async function fetchSystemInfo() {
  try {
    const res = await fetch('/api/system');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('pill-arch').textContent = data.arch.toUpperCase();
    document.getElementById('pill-node').textContent = data.nodeVersion;
    document.getElementById('pill-ram').textContent = `RAM: ${data.memory.processRssMb}MB / ${data.memory.totalMemMb}MB`;

    const persistencePill = document.getElementById('pill-persistence');
    if (data.persistence.isWritable) {
      persistencePill.className = 'pill pill-green';
      persistencePill.innerHTML = '<span class="dot"></span> Persistence: Verified';
    } else {
      persistencePill.className = 'pill pill-danger';
      persistencePill.innerHTML = '<span class="dot"></span> Persistence: Writable Error';
    }

    // Diagnostics pane data
    document.getElementById('diag-data-status').textContent = data.persistence.isWritable ? 'Writable (root:root / 777)' : 'Error';
    document.getElementById('diag-disk-free').textContent = `Storage: ${data.diskUsage}`;
  } catch (err) {
    console.error('System info fetch error:', err);
  }
}

// 2. Load Supervised Processes
async function loadProcesses() {
  try {
    const res = await fetch('/api/processes');
    if (!res.ok) return;
    const processes = await res.json();

    document.getElementById('proc-count').textContent = processes.length;
    const tbody = document.getElementById('process-list-body');

    if (processes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 24px;">No background processes currently supervised. Click "+ New Process" or use an AI Gateway Preset to start one.</td></tr>`;
      return;
    }

    tbody.innerHTML = processes.map(p => {
      let statusClass = 'badge-muted';
      if (p.status === 'online') statusClass = 'badge-online';
      else if (p.status === 'stopped') statusClass = 'badge-stopped';
      else if (p.status === 'errored') statusClass = 'badge-errored';

      const uptimeMin = Math.floor(p.uptime / 60);
      const uptimeStr = uptimeMin > 60 ? `${Math.floor(uptimeMin / 60)}h ${uptimeMin % 60}m` : `${uptimeMin}m`;

      return `
        <tr>
          <td><code>${p.id}</code></td>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td><span class="badge ${statusClass}">${p.status}</span></td>
          <td>${p.pid || '-'}</td>
          <td>${p.cpu}%</td>
          <td>${p.memory} MB</td>
          <td>${p.restarts}</td>
          <td>${uptimeStr}</td>
          <td>
            <div style="display: flex; gap: 6px;">
              ${p.status === 'online' 
                ? `<button class="btn-sm btn-stop-sm" onclick="stopProcess(${p.id})">Stop</button>`
                : `<button class="btn-sm btn-primary" onclick="restartProcess(${p.id})">Start</button>`}
              <button class="btn-sm btn-restart-sm" onclick="restartProcess(${p.id})">Restart</button>
              <button class="btn-sm btn-secondary" onclick="viewLogs(${p.id}, '${escapeHtml(p.name)}')">Logs</button>
              <button class="btn-sm btn-danger-sm" onclick="deleteProcess(${p.id}, '${escapeHtml(p.name)}')">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Check presets if active
    if (activeTab === 'tab-presets') checkPresetStatuses(processes);
  } catch (err) {
    console.error('Failed to load processes:', err);
  }
}

// Process Action Handlers
async function restartProcess(id) {
  try {
    const res = await fetch('/api/processes/restart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Process ${id} restarted`, 'success');
      loadProcesses();
    } else {
      showToast(data.error || 'Failed to restart process', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function stopProcess(id) {
  try {
    const res = await fetch('/api/processes/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Process ${id} stopped and state saved.`, 'info');
      loadProcesses();
    } else {
      showToast(data.error || 'Failed to stop process', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteProcess(id, name) {
  if (!confirm(`Are you sure you want to stop and remove "${name}" from autostart supervision?`)) {
    return;
  }
  try {
    const res = await fetch('/api/processes/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Process "${name}" cleanly deleted and autostart updated.`, 'success');
      loadProcesses();
    } else {
      showToast(data.error || 'Failed to delete process', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function savePm2State() {
  try {
    const res = await fetch('/api/processes/save', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('All process states saved to persistent disk (dump.pm2)!', 'success');
    } else {
      showToast(data.error || 'Failed to save PM2 state', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// 3. AI Gateway Presets
async function checkPresetStatuses(cachedProcesses = null) {
  try {
    let procs = cachedProcesses;
    if (!procs) {
      const res = await fetch('/api/processes');
      procs = res.ok ? await res.json() : [];
    }

    const checkPreset = (name, elemId) => {
      const p = procs.find(item => item.name === name);
      const el = document.getElementById(elemId);
      if (p) {
        if (p.status === 'online') {
          el.className = 'badge badge-online';
          el.textContent = 'Running';
        } else {
          el.className = 'badge badge-stopped';
          el.textContent = p.status;
        }
      } else {
        el.className = 'badge badge-muted';
        el.textContent = 'Not Running';
      }
    };

    checkPreset('omniroute', 'status-omniroute');
    checkPreset('9router', 'status-9router');
    checkPreset('free-llm-api', 'status-freellm');
  } catch (err) {
    console.error('Error checking presets:', err);
  }
}

async function launchPreset(preset) {
  try {
    showToast(`Launching ${preset}...`, 'info');
    const res = await fetch('/api/presets/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(data.message, 'success');
      loadProcesses();
      checkPresetStatuses();
    } else {
      if (data.actionRequired === 'install_npm') {
        if (confirm(`${data.error}\n\nWould you like to install the "${data.package}" package from NPM now?`)) {
          installNpmPackage(data.package);
        }
      } else {
        showToast(data.error || 'Failed to launch preset', 'error');
      }
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// 4. NPM Package Manager
async function loadNpmPackages() {
  try {
    const res = await fetch('/api/npm/list');
    if (!res.ok) return;
    const packages = await res.json();

    document.getElementById('npm-count').textContent = packages.length;
    const tbody = document.getElementById('npm-list-body');

    if (packages.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted" style="padding: 24px;">No global packages installed in /app/data/npm-global yet. Install one using the box above!</td></tr>`;
      return;
    }

    tbody.innerHTML = packages.map(pkg => `
      <tr>
        <td><strong><code>${escapeHtml(pkg.name)}</code></strong></td>
        <td><span class="badge badge-muted">${escapeHtml(pkg.version)}</span></td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn-sm btn-secondary" onclick="streamNpmAction('update', '${escapeHtml(pkg.name)}')">Update ⟳</button>
            <button class="btn-sm btn-danger-sm" onclick="uninstallNpmPackage('${escapeHtml(pkg.name)}')">Uninstall ✕</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading npm packages:', err);
  }
}

function installNpmPackage(pkgName) {
  const tabBtn = document.querySelector('[data-tab="tab-npm"]');
  if (tabBtn) tabBtn.click();
  streamNpmAction('install', pkgName);
}

function uninstallNpmPackage(pkgName) {
  if (!confirm(`Are you sure you want to completely uninstall "${pkgName}" from persistent storage?`)) {
    return;
  }
  streamNpmAction('uninstall', pkgName);
}

function streamNpmAction(action, pkg) {
  const streamCard = document.getElementById('npm-stream-card');
  const streamOutput = document.getElementById('npm-stream-output');
  streamCard.style.display = 'block';
  streamOutput.textContent = `[Init] Starting npm ${action} -g ${pkg}...\n`;
  streamCard.scrollIntoView({ behavior: 'smooth' });

  if (eventSource) eventSource.close();

  eventSource = new EventSource(`/api/npm/stream-action?action=${encodeURIComponent(action)}&pkg=${encodeURIComponent(pkg)}`);

  eventSource.addEventListener('log', e => {
    const data = JSON.parse(e.data);
    streamOutput.textContent += data.text;
    streamOutput.scrollTop = streamOutput.scrollHeight;
  });

  eventSource.addEventListener('end', e => {
    const data = JSON.parse(e.data);
    streamOutput.textContent += `\n[Finished] ${data.message}\n`;
    streamOutput.scrollTop = streamOutput.scrollHeight;
    eventSource.close();
    eventSource = null;

    if (data.success) {
      showToast(`Package "${pkg}" ${action} completed!`, 'success');
      loadNpmPackages();
      checkPresetStatuses();
    } else {
      showToast(`Failed: ${data.message}`, 'error');
    }
  });

  eventSource.addEventListener('error', e => {
    streamOutput.textContent += `\n[Stream Error] Connection lost or terminated.\n`;
    eventSource.close();
    eventSource = null;
  });
}

function closeStreamWindow() {
  document.getElementById('npm-stream-card').style.display = 'none';
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

// 5. Diagnostics & Integrity Test
async function runPersistenceDiagnostics() {
  const container = document.getElementById('test-results-container');
  const stepsList = document.getElementById('test-steps-list');
  const btn = document.getElementById('btn-run-diag');

  container.style.display = 'block';
  stepsList.innerHTML = '<div style="padding: 16px; color: var(--text-muted);">Running probe on host mount, SQLite WAL transactions, and permissions...</div>';
  btn.disabled = true;
  btn.textContent = 'Testing...';

  try {
    const res = await fetch('/api/diagnostics/verify-persistence', { method: 'POST' });
    const data = await res.json();

    stepsList.innerHTML = data.steps.map(step => {
      let badgeClass = step.status === 'PASS' ? 'badge-online' : (step.status === 'WARN' ? 'badge-stopped' : 'badge-errored');
      return `
        <div class="test-step-row">
          <div>
            <div class="test-step-name">${escapeHtml(step.name)}</div>
            <div class="test-step-details">${escapeHtml(step.details)}</div>
          </div>
          <span class="badge ${badgeClass}">${step.status}</span>
        </div>
      `;
    }).join('');

    if (data.allPassed) {
      showToast('100% Persistence Verified: Safe against reboots!', 'success');
    } else {
      showToast('Diagnostic completed with warnings or errors.', 'error');
    }
  } catch (err) {
    stepsList.innerHTML = `<div style="padding: 16px; color: #ef4444;">Diagnostic error: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Run Full Persistence Test';
  }
}

// 6. Quick Console
function setupConsole() {
  const form = document.getElementById('console-form');
  const input = document.getElementById('console-input');

  form.addEventListener('submit', e => {
    e.preventDefault();
    const cmd = input.value.trim();
    if (!cmd) return;
    execCommand(cmd);
    input.value = '';
  });
}

async function execCommand(cmd) {
  const consoleOutput = document.getElementById('console-output');
  consoleOutput.textContent += `\n$ ${cmd}\n`;
  consoleOutput.scrollTop = consoleOutput.scrollHeight;

  try {
    const res = await fetch('/api/terminal/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();

    if (data.stdout) consoleOutput.textContent += data.stdout;
    if (data.stderr) consoleOutput.textContent += `Error: ${data.stderr}\n`;
    consoleOutput.textContent += `[Exit code: ${data.code}]\n`;
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  } catch (err) {
    consoleOutput.textContent += `Request error: ${err.message}\n`;
  }
}

// 7. Modals & Forms
function setupModals() {
  document.getElementById('btn-open-add-proc').addEventListener('click', () => {
    openModal('modal-add-process');
  });

  document.getElementById('btn-save-pm2').addEventListener('click', savePm2State);
  document.getElementById('btn-run-diag').addEventListener('click', runPersistenceDiagnostics);

  document.getElementById('btn-refresh-logs').addEventListener('click', () => {
    if (currentLogProcessId !== null) viewLogs(currentLogProcessId, 'Process Logs');
  });
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function setupForms() {
  // New process form
  document.getElementById('form-add-process').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('proc-name').value.trim();
    const command = document.getElementById('proc-cmd').value.trim();
    const port = document.getElementById('proc-port').value.trim();
    const args = document.getElementById('proc-args').value.trim();
    const cwd = document.getElementById('proc-cwd').value.trim();

    try {
      const res = await fetch('/api/processes/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, command, port, args, cwd })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Process "${name}" started and saved!`, 'success');
        closeModal('modal-add-process');
        document.getElementById('form-add-process').reset();
        loadProcesses();
      } else {
        showToast(data.error || 'Failed to start process', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // NPM install form
  document.getElementById('npm-install-form').addEventListener('submit', e => {
    e.preventDefault();
    const pkg = document.getElementById('npm-pkg-input').value.trim();
    if (!pkg) return;
    streamNpmAction('install', pkg);
    document.getElementById('npm-pkg-input').value = '';
  });
}

async function viewLogs(id, name) {
  currentLogProcessId = id;
  document.getElementById('logs-title').textContent = `Logs for: ${name} (ID: ${id})`;
  document.getElementById('logs-content').textContent = 'Fetching logs from PM2...';
  openModal('modal-logs');

  try {
    const res = await fetch(`/api/processes/${id}/logs?lines=150`);
    const data = await res.json();
    document.getElementById('logs-content').textContent = data.logs;
    const content = document.getElementById('logs-content');
    content.scrollTop = content.scrollHeight;
  } catch (err) {
    document.getElementById('logs-content').textContent = `Error fetching logs: ${err.message}`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
