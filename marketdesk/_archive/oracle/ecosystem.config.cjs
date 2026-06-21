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
        // Defina estas variáveis no ambiente do shell antes de "pm2 start",
        // ou substitua os valores abaixo diretamente (não versione segredos reais).
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        DANELFIN_API_KEY: process.env.DANELFIN_API_KEY || '',
        GLASSNODE_API_KEY: process.env.GLASSNODE_API_KEY || '',
        MESSARI_API_KEY: process.env.MESSARI_API_KEY || '',
        CRYPTOQUANT_WEBHOOK_SECRET: process.env.CRYPTOQUANT_WEBHOOK_SECRET || '',
      },
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      out_file: './logs/out.log',
      error_file: './logs/error.log',
    },
  ],
};
