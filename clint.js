const express = require('express');
const app = express();
__path = process.cwd()
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 8000;
const fs = require('fs');
const path = require('path');
let server = require('./qr'),
    code = require('./pair');
require('events').EventEmitter.defaultMaxListeners = 50;
app.use('/qr', server);
app.use('/code', code);
app.use('/pair',async (req, res, next) => {
res.sendFile(__path + '/pair.html')
})
app.use('/',async (req, res, next) => {
res.sendFile(__path + '/main.html')
})
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const tempDir = path.join(__path, 'temp');
setInterval(() => {
    try {
        if (!fs.existsSync(tempDir)) return;
        const dirs = fs.readdirSync(tempDir);
        for (const dir of dirs) {
            const dirPath = path.join(tempDir, dir);
            try {
                const stats = fs.statSync(dirPath);
                if (Date.now() - stats.mtimeMs > 10 * 60 * 1000) {
                    fs.rmSync(dirPath, { recursive: true, force: true });
                    console.log(`Cleaned stale temp session: ${dir}`);
                }
            } catch (e) {}
        }
    } catch (e) {}
}, 5 * 60 * 1000);

app.listen(PORT, () => {
    console.log(`
xD xD 🚨

 Server running on http://localhost:` + PORT)
})

module.exports = app
