module.exports = {
  apps: [
    {
      name: 'monad-prize-keeper',
      script: './scripts/keeper-execute-next.js',
      cwd: '/home/c/.openclaw/workspace/monad-prize',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      time: true,
      env_file: './scripts/keeper.env',
      out_file: './logs/keeper.out.log',
      error_file: './logs/keeper.err.log',
      merge_logs: true
    }
  ]
}
