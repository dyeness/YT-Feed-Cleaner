// SVG is the single icon source. Only Chrome's raster-only APIs use these PNG fallbacks.
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const source = fs.readFileSync(path.join(__dirname, '../icons/icon.svg'), 'utf8');
for (const size of [16, 32, 48, 128]) {
    const renderer = new Resvg(source, { fitTo: { mode: 'width', value: size } });
    fs.writeFileSync(path.join(__dirname, `../icons/icon${size}.png`), renderer.render().asPng());
}
