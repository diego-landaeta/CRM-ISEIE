// PM2 config en CJS porque el proyecto usa "type": "module" (ESM) en package.json.
// PM2 no parsea `export default`, necesita module.exports. Tambien exec_mode: 'fork'
// obligatorio: cluster mode no es compatible con ESM apps.
module.exports = {
  apps: [{
    name: 'crm-iseie-api',
    script: './src/app.js',
    exec_mode: 'fork',
    cwd: '/opt/crm-iseie',
    node_args: '--env-file=/opt/crm-iseie/.env',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: '3005',
    },
    error_file: '/opt/crm-iseie/logs/error.log',
    out_file: '/opt/crm-iseie/logs/out.log',
    merge_logs: true,
    time: true,
  }],
};
