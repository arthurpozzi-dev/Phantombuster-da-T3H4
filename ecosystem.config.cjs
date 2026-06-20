// PM2 process config — Maps Leads Scraper
// Uso na VPS:  pm2 start ecosystem.config.cjs  (ver docs/DEPLOY-CLOUDPANEL.md)
//
// .cjs porque o projeto é ESM (package.json "type":"module") e o PM2 lê CommonJS.
// PORT/HOST e demais variáveis vêm do .env (carregado pelo próprio app em src/main.js).
module.exports = {
  apps: [
    {
      name: "maps-leads",
      script: "src/main.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork", // browsers/scraping não escalam bem em cluster nesta VPS
      autorestart: true,
      // Chromium/Playwright costumam vazar memória em scraping longo: o PM2
      // recicla o processo antes de sufocar a VPS (2 vCPU / 8 GB).
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
      },
      time: true, // timestamp nos logs (pm2 logs maps-leads)
    },
  ],
};
