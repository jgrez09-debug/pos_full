module.exports = {
  apps: [
    // BACKEND
    {
      name: "pos-server",
      cwd: "./server",
      script: "node",
      args: "src/app.js",             // si tu entry es index.js cámbialo
      interpreter: "node",
      watch: ["src"],
      ignore_watch: ["node_modules", "logs"],
      env: {
        NODE_ENV: "development",
        PORT: "3001"
      },
      env_production: {
        NODE_ENV: "production",
        PORT: "3001"
      },
      out_file: "../logs/pos-server.out.log",
      error_file: "../logs/pos-server.err.log",
      time: true,                     // timestamp en logs
      max_restarts: 10,
      restart_delay: 2000
    },

    // FRONTEND (Vite/React)
    {
      name: "pos-client",
      cwd: "./client",
      script: "npm",
      args: "run dev",                // vite dev server
      watch: false,                   // vite ya hace HMR
      out_file: "../logs/pos-client.out.log",
      error_file: "../logs/pos-client.err.log",
      time: true,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        BROWSER: "none"               // no abrir navegador automáticamente
      }
    }

    // Si tienes un "printer-agent", puedes agregar otro bloque similar aquí.
  ]
};
