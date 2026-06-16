module.exports = {
  apps: [
    {
      name: 'marketdesk',
      script: 'server.js',
      cwd: __dirname,
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 8080,
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
    },
  ],
};
