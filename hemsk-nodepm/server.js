const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 20130;
const DATA_DIR = process.env.DATA_DIR || '/app/data';
const NPM_GLOBAL_DIR = process.env.NPM_CONFIG_PREFIX || path.join(DATA_DIR, 'npm-global');
const NPM_BIN_DIR = path.join(NPM_GLOBAL_DIR, 'bin');
const HOME_DIR = process.env.HOME || path.join(DATA_DIR, 'home');
const PM2_HOME = process.env.PM2_HOME || path.join(HOME_DIR, '.pm2');

// Ensure persistent directories exist immediately
try {
  fs.mkdirSync(NPM_BIN_DIR, { recursive: true });
  fs.mkdirSync(path.join(NPM_GLOBAL_DIR, 'lib'), { recursive: true });
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.mkdirSync(PM2_HOME, { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'processes'), { recursive: true });
} catch (err) {
  console.warn('Directory initialization notice:', err.message);
}

// Update process environment for spawned processes
process.env.PATH = `${NPM_BIN_DIR}:${process.env.PATH || ''}:/usr/local/bin:/usr/bin:/bin`;
process.env.NPM_CONFIG_PREFIX = NPM_GLOBAL_DIR;
process.env.HOME = HOME_DIR;
process.env.PM2_HOME = PM2_HOME;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to execute commands returning a promise
function runExec(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, {
      ...options,
      env: { ...process.env, ...options.env }
    }, (error, stdout, stderr) => {
      if (error) {
        return resolve({ success: false, stdout: stdout || '', stderr: stderr || error.message, code: error.code || 1 });
      }
      resolve({ success: true, stdout: stdout || '', stderr: stderr || '', code: 0 });
    });
  });
}

// --- API Endpoints ---

// 1. System Metrics & Persistence Health
app.get('/api/system', async (req, res) => {
  let isDataWritable = false;
  let persistenceTestError = null;

  try {
    const testFile = path.join(DATA_DIR, '.write_test');
    fs.writeFileSync(testFile, 'ok', 'utf8');
    fs.unlinkSync(testFile);
    isDataWritable = true;
  } catch (e) {
    persistenceTestError = e.message;
  }

  // Get disk usage of /app/data if available
  let diskUsage = 'Unknown';
  try {
    const dfResult = await runExec(`df -h "${DATA_DIR}" | tail -1 | awk '{print $4 " free of " $2}'`);
    if (dfResult.success && dfResult.stdout.trim()) {
      diskUsage = dfResult.stdout.trim();
    }
  } catch {
    // fallback
  }

  res.json({
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    systemUptime: Math.floor(os.uptime()),
    hostname: os.hostname(),
    memory: {
      freeMemMb: Math.round(os.freemem() / (1024 * 1024)),
      totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
      processRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024))
    },
    paths: {
      dataDir: DATA_DIR,
      npmGlobal: NPM_GLOBAL_DIR,
      npmBin: NPM_BIN_DIR,
      home: HOME_DIR,
      pm2Home: PM2_HOME
    },
    diskUsage,
    persistence: {
      isWritable: isDataWritable,
      error: persistenceTestError
    }
  });
});

// 2. PM2 Processes List
app.get('/api/processes', async (req, res) => {
  try {
    const result = await runExec('pm2 jlist');
    if (!result.success) {
      return res.status(500).json({ error: 'Failed to query PM2', details: result.stderr });
    }
    const processes = JSON.parse(result.stdout || '[]');
    const formatted = processes.map(p => ({
      id: p.pm_id,
      name: p.name,
      status: p.pm2_env ? p.pm2_env.status : 'unknown',
      pid: p.pid,
      uptime: p.pm2_env ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000) : 0,
      restarts: p.pm2_env ? p.pm2_env.restart_time : 0,
      memory: p.monit ? Math.round(p.monit.memory / (1024 * 1024)) : 0,
      cpu: p.monit ? p.monit.cpu : 0,
      script: p.pm2_env ? p.pm2_env.pm_exec_path : '',
      exec_mode: p.pm2_env ? p.pm2_env.exec_mode : ''
    }));
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching process list', details: err.message });
  }
});

// 3. Start Process
app.post('/api/processes/start', async (req, res) => {
  const { name, command, args, cwd, env, port } = req.body;
  if (!name || !command) {
    return res.status(400).json({ error: 'name and command are required' });
  }

  let cmdArgs = args ? ` ${args}` : '';
  let cmdCwd = cwd ? ` --cwd "${cwd}"` : ` --cwd "${DATA_DIR}"`;
  let portArg = port ? ` --env PORT=${port}` : '';

  let envArgs = '';
  if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env)) {
      envArgs += ` --env ${k}="${v}"`;
    }
  }

  const startCmd = `pm2 start "${command}" --name "${name}"${cmdArgs}${cmdCwd}${portArg}${envArgs}`;
  const startResult = await runExec(startCmd);
  
  if (!startResult.success) {
    return res.status(500).json({ error: 'Failed to start process', details: startResult.stderr });
  }

  // Automatically save state so it resurrects on reboot
  await runExec('pm2 save');
  res.json({ success: true, message: `Process ${name} started and saved successfully.` });
});

// 4. Stop Process
app.post('/api/processes/stop', async (req, res) => {
  const { id } = req.body;
  if (id === undefined) return res.status(400).json({ error: 'id is required' });

  const result = await runExec(`pm2 stop ${id}`);
  if (!result.success) {
    return res.status(500).json({ error: 'Failed to stop process', details: result.stderr });
  }
  await runExec('pm2 save');
  res.json({ success: true, message: `Process ${id} stopped.` });
});

// 5. Restart Process
app.post('/api/processes/restart', async (req, res) => {
  const { id } = req.body;
  if (id === undefined) return res.status(400).json({ error: 'id is required' });

  const result = await runExec(`pm2 restart ${id}`);
  if (!result.success) {
    return res.status(500).json({ error: 'Failed to restart process', details: result.stderr });
  }
  res.json({ success: true, message: `Process ${id} restarted.` });
});

// 6. Delete Process (Clean Stop & Removal from Autostart)
app.post('/api/processes/delete', async (req, res) => {
  const { id } = req.body;
  if (id === undefined) return res.status(400).json({ error: 'id is required' });

  const result = await runExec(`pm2 delete ${id}`);
  if (!result.success) {
    return res.status(500).json({ error: 'Failed to delete process', details: result.stderr });
  }
  await runExec('pm2 save');
  res.json({ success: true, message: `Process ${id} deleted and autostart state updated.` });
});

// 7. Save PM2 State Explicitly
app.post('/api/processes/save', async (req, res) => {
  const result = await runExec('pm2 save');
  if (!result.success) {
    return res.status(500).json({ error: 'Failed to save PM2 state', details: result.stderr });
  }
  res.json({ success: true, message: 'PM2 process list successfully dumped to persistent disk.' });
});

// 8. Process Logs
app.get('/api/processes/:id/logs', async (req, res) => {
  const { id } = req.params;
  const lines = req.query.lines || 100;
  const result = await runExec(`pm2 logs ${id} --lines ${lines} --nostream`);
  res.json({ logs: result.stdout || result.stderr || 'No logs found.' });
});

// 9. List Installed Global NPM Packages
app.get('/api/npm/list', async (req, res) => {
  try {
    const result = await runExec('npm list -g --depth=0 --json');
    let packages = {};
    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout);
        packages = parsed.dependencies || {};
      } catch {
        // parsing fallback
      }
    }
    
    // Also check physical node_modules in case of parsing quirks
    const modulesDir = path.join(NPM_GLOBAL_DIR, 'lib', 'node_modules');
    let installedList = [];
    if (fs.existsSync(modulesDir)) {
      const items = fs.readdirSync(modulesDir);
      for (const item of items) {
        if (item.startsWith('.')) continue;
        if (item.startsWith('@')) {
          // scoped package
          try {
            const scopedItems = fs.readdirSync(path.join(modulesDir, item));
            for (const s of scopedItems) {
              const fullName = `${item}/${s}`;
              installedList.push({
                name: fullName,
                version: packages[fullName]?.version || 'installed'
              });
            }
          } catch {}
        } else {
          installedList.push({
            name: item,
            version: packages[item]?.version || 'installed'
          });
        }
      }
    }
    res.json(installedList);
  } catch (err) {
    res.status(500).json({ error: 'Error reading npm list', details: err.message });
  }
});

// 10. NPM Actions (Install, Update, Uninstall) with Real-Time SSE Log Streaming
app.get('/api/npm/stream-action', (req, res) => {
  const { action, pkg } = req.query;

  if (!action || !pkg) {
    return res.status(400).send('action and pkg query params required');
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('start', { message: `Executing npm ${action} -g ${pkg}...` });

  let npmArgs = [];
  if (action === 'install') {
    npmArgs = ['install', '-g', pkg, '--loglevel=info'];
  } else if (action === 'update') {
    npmArgs = ['update', '-g', pkg, '--loglevel=info'];
  } else if (action === 'uninstall') {
    npmArgs = ['uninstall', '-g', pkg, '--loglevel=info'];
  } else {
    sendEvent('error', { message: `Invalid action: ${action}` });
    return res.end();
  }

  const child = spawn('npm', npmArgs, {
    env: { ...process.env }
  });

  child.stdout.on('data', chunk => {
    sendEvent('log', { text: chunk.toString() });
  });

  child.stderr.on('data', chunk => {
    sendEvent('log', { text: chunk.toString() });
  });

  child.on('close', code => {
    sendEvent('end', {
      success: code === 0,
      code,
      message: code === 0 
        ? `npm ${action} -g ${pkg} completed successfully.` 
        : `npm ${action} -g ${pkg} exited with code ${code}.`
    });
    res.end();
  });

  req.on('close', () => {
    child.kill();
  });
});

// 11. One-Click AI Gateway & App Presets
app.post('/api/presets/launch', async (req, res) => {
  const { preset } = req.body;

  if (preset === 'omniroute') {
    const omnirouteDir = path.join(DATA_DIR, 'omniroute');
    fs.mkdirSync(omnirouteDir, { recursive: true });

    // Check if omniroute binary is installed
    const omniBin = path.join(NPM_BIN_DIR, 'omniroute');
    const isInstalled = fs.existsSync(omniBin);

    if (!isInstalled) {
      return res.status(400).json({
        error: 'OmniRoute is not installed yet.',
        actionRequired: 'install_npm',
        package: 'omniroute'
      });
    }

    // Launch omniroute with persistent env
    const cmd = `pm2 start "${omniBin}" --name omniroute --cwd "${omnirouteDir}" --env PORT=20128 --env DATA_DIR="${omnirouteDir}" --env STORAGE_ENCRYPTION_KEY="omniroute-persistent-key-umbrel-secure" --env JWT_SECRET="omniroute-jwt-umbrel-secure"`;
    const result = await runExec(cmd);
    if (!result.success) {
      return res.status(500).json({ error: 'Failed to launch OmniRoute', details: result.stderr });
    }
    await runExec('pm2 save');
    return res.json({ success: true, message: 'OmniRoute launched on port 20128 and saved to autostart!' });
  }

  if (preset === '9router') {
    const routerDir = path.join(DATA_DIR, '9router');
    fs.mkdirSync(routerDir, { recursive: true });

    const routerBin = path.join(NPM_BIN_DIR, '9router');
    const isInstalled = fs.existsSync(routerBin);

    if (!isInstalled) {
      return res.status(400).json({
        error: '9Router is not installed yet.',
        actionRequired: 'install_npm',
        package: '9router'
      });
    }

    const cmd = `pm2 start "${routerBin}" --name 9router --cwd "${routerDir}" -- --port 20129`;
    const result = await runExec(cmd);
    if (!result.success) {
      return res.status(500).json({ error: 'Failed to launch 9Router', details: result.stderr });
    }
    await runExec('pm2 save');
    return res.json({ success: true, message: '9Router launched on port 20129 and saved to autostart!' });
  }

  if (preset === 'free-llm-api') {
    const apiBin = path.join(NPM_BIN_DIR, 'free-llm-api');
    const isInstalled = fs.existsSync(apiBin);

    if (!isInstalled) {
      return res.status(400).json({
        error: 'free-llm-api is not installed yet.',
        actionRequired: 'install_npm',
        package: 'free-llm-api'
      });
    }

    const cmd = `pm2 start "${apiBin}" --name free-llm-api --env PORT=8080`;
    const result = await runExec(cmd);
    if (!result.success) {
      return res.status(500).json({ error: 'Failed to launch free-llm-api', details: result.stderr });
    }
    await runExec('pm2 save');
    return res.json({ success: true, message: 'free-llm-api launched on port 8080 and saved to autostart!' });
  }

  res.status(400).json({ error: 'Unknown preset requested.' });
});

// 12. Persistence & SQLite Integrity Diagnostic Tool
app.post('/api/diagnostics/verify-persistence', async (req, res) => {
  const steps = [];
  let allPassed = true;

  // Step 1: Base Mount Check
  try {
    const testFile = path.join(DATA_DIR, `.integrity_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'persistent write ok', 'utf8');
    const readBack = fs.readFileSync(testFile, 'utf8');
    fs.unlinkSync(testFile);
    if (readBack === 'persistent write ok') {
      steps.push({ name: 'Host Mount /app/data R/W', status: 'PASS', details: 'Direct host volume write and unlink succeeded.' });
    } else {
      throw new Error('Data mismatch on readback');
    }
  } catch (err) {
    allPassed = false;
    steps.push({ name: 'Host Mount /app/data R/W', status: 'FAIL', details: err.message });
  }

  // Step 2: Global NPM Directory & PATH Check
  try {
    const npmTestFile = path.join(NPM_GLOBAL_DIR, `.npm_check_${Date.now()}`);
    fs.writeFileSync(npmTestFile, 'npm ok', 'utf8');
    fs.unlinkSync(npmTestFile);
    const inPath = process.env.PATH.includes(NPM_BIN_DIR);
    steps.push({
      name: 'NPM Global Storage & PATH',
      status: inPath ? 'PASS' : 'WARN',
      details: `Directory writable. ${inPath ? 'Bin directory active in PATH.' : 'Warning: Bin directory not yet in PATH.'}`
    });
  } catch (err) {
    allPassed = false;
    steps.push({ name: 'NPM Global Storage & PATH', status: 'FAIL', details: err.message });
  }

  // Step 3: HOME Directory & Dotfile Check
  try {
    const dotTestFile = path.join(HOME_DIR, `.dotfile_check_${Date.now()}`);
    fs.writeFileSync(dotTestFile, 'dotfile ok', 'utf8');
    fs.unlinkSync(dotTestFile);
    steps.push({ name: 'HOME & Dotfile Persistence (~/)', status: 'PASS', details: `HOME points to ${HOME_DIR} and is fully writable.` });
  } catch (err) {
    allPassed = false;
    steps.push({ name: 'HOME & Dotfile Persistence (~/)', status: 'FAIL', details: err.message });
  }

  // Step 4: PM2 Dump & Resurrect Check
  try {
    const dumpPath = path.join(PM2_HOME, 'dump.pm2');
    const dumpExists = fs.existsSync(dumpPath);
    steps.push({
      name: 'PM2 State Autostart Dump',
      status: 'PASS',
      details: dumpExists ? `dump.pm2 present (${fs.statSync(dumpPath).size} bytes) in ${PM2_HOME}` : `Directory ${PM2_HOME} ready. No dumped state yet (use "Save" in GUI to create).`
    });
  } catch (err) {
    steps.push({ name: 'PM2 State Autostart Dump', status: 'FAIL', details: err.message });
  }

  // Step 5: SQLite Database & WAL Transaction Test
  // Test using Node 22 native sqlite or sqlite3 cli or python3 sqlite3
  try {
    const dbPath = path.join(DATA_DIR, 'persistence_test.sqlite');
    // Run python3 one-liner to verify sqlite3 WAL transaction commit and temp file permissions
    const pyScript = `python3 -c "import sqlite3; conn = sqlite3.connect('${dbPath}'); conn.execute('PRAGMA journal_mode=WAL'); conn.execute('CREATE TABLE IF NOT EXISTS probe (ts TEXT)'); conn.execute('INSERT INTO probe VALUES (datetime())'); conn.commit(); cursor = conn.execute('SELECT COUNT(*) FROM probe'); count = cursor.fetchone()[0]; conn.close(); print(count)"`;
    const sqliteResult = await runExec(pyScript);
    if (sqliteResult.success && sqliteResult.stdout.trim()) {
      steps.push({
        name: 'SQLite Database & WAL Transaction Test',
        status: 'PASS',
        details: `Created/updated SQLite DB with WAL mode. Total records: ${sqliteResult.stdout.trim()}. Zero EACCES temp file errors!`
      });
    } else {
      throw new Error(sqliteResult.stderr || 'SQLite execution failed');
    }
  } catch (err) {
    allPassed = false;
    steps.push({ name: 'SQLite Database & WAL Transaction Test', status: 'FAIL', details: err.message });
  }

  res.json({
    timestamp: new Date().toISOString(),
    overallStatus: allPassed ? 'HEALTHY' : 'ATTENTION_NEEDED',
    allPassed,
    steps
  });
});

// 13. Safe Console Command Execution
app.post('/api/terminal/exec', async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: 'Command is required' });

  // Whitelist or safety check: prevent dangerous rm -rf / commands
  const trimmed = command.trim();
  if (trimmed.startsWith('rm -rf /') || trimmed.includes('mkfs')) {
    return res.status(403).json({ error: 'Command prohibited for safety.' });
  }

  const result = await runExec(command);
  res.json({
    command,
    success: result.success,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code
  });
});

// Default catch-all routes to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Node Process Manager GUI listening on http://0.0.0.0:${PORT}`);
  console.log(`Persistent DATA_DIR: ${DATA_DIR}`);
  console.log(`NPM Global Prefix:   ${NPM_GLOBAL_DIR}`);
  console.log(`HOME Directory:      ${HOME_DIR}`);
  console.log(`PM2 Home Directory:  ${PM2_HOME}`);
});
