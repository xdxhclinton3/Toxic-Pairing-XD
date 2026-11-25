const express = require('express');
  const app = express();
  const __path = process.cwd()
  const bodyParser = require("body-parser");
  const fs = require('fs');
  const path = require('path');
  const PORT = process.env.PORT || 8000;

  function sweepTemp() {
    try {
      const tempRoot = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempRoot)) return;
      const cutoff = Date.now() - 15 * 60 * 1000;
      for (const name of fs.readdirSync(tempRoot)) {
        const dir = path.join(tempRoot, name);
        try {
          const stat = fs.statSync(dir);
          if (stat.isDirectory() && stat.mtimeMs < cutoff) {
            fs.rmSync(dir, { recursive: true, force: true });
          }
        } catch (e) { console.error('[sweep]', name, e?.message || e); }
      }
    } catch (e) { console.error('[sweep]', e?.message || e); }
  }
  sweepTemp();
  setInterval(sweepTemp, 10 * 60 * 1000);
  let server = require('./qr'),
      code = require('./pair');
  require('events').EventEmitter.defaultMaxListeners = 500;
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use('/qr/code', server);
  app.use('/code', code);
  const { loadRetrievalBundle } = require('./sessionBundle');
  app.get('/session/:code', async (req, res) => {
  const bundle = loadRetrievalBundle(req.params.code);
  if (!bundle) {
  return res.status(404).send('Not found or expired');
  }
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-store');
  res.send(bundle);
  })
  app.use('/qr', async (req, res, next) => {
  res.sendFile(__path + '/qr_page.html')
  })
  app.use('/pair', async (req, res, next) => {
  res.sendFile(__path + '/pair.html')
  })
  app.use('/', async (req, res, next) => {
  res.sendFile(__path + '/main.html')
  })
  app.listen(PORT, () => {
      console.log(`
  xD xD 🚨

   Server running on http://localhost:` + PORT)
  })

  module.exports = app
  