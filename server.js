const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const sharp = require('sharp');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

async function createWindowsCursorOrIcon(pngBuffer, type = 'ico') {
    const metadata = await sharp(pngBuffer).metadata();
    const width = metadata.width >= 256 ? 0 : metadata.width;
    const height = metadata.height >= 256 ? 0 : metadata.height;
    
    const imageType = type === 'cur' ? 2 : 1;
    const headerSize = 6;
    const directoryEntrySize = 16;
    const imageOffset = headerSize + directoryEntrySize;

    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(imageType, 2);
    header.writeUInt16LE(1, 4);

    const entry = Buffer.alloc(directoryEntrySize);
    entry.writeUInt8(width, 0);
    entry.writeUInt8(height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    
    if (type === 'cur') {
        entry.writeUInt16LE(Math.floor(metadata.width / 2), 4);
        entry.writeUInt16LE(Math.floor(metadata.height / 2), 6);
    } else {
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
    }

    entry.writeUInt32LE(pngBuffer.length, 8);
    entry.writeUInt32LE(imageOffset, 12);

    return Buffer.concat([header, entry, pngBuffer]);
}

async function removeWhiteBackground(inputPath, outputPath) {
    const safeBuffer = await sharp(inputPath)
        .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer();

    const { data, info } = await sharp(safeBuffer)
        .ensureAlpha()
        .raw({ resolveWithObject: true })
        .toBuffer({ resolveWithObject: true });

    const pixelCount = info.width * info.height;
    for (let i = 0; i < pixelCount; i++) {
        const idx = i * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (r > 235 && g > 235 && b > 235) {
            data[idx + 3] = 0;
        }
    }

    await sharp(data, {
        raw: {
            width: info.width,
            height: info.height,
            channels: 4
        }
    })
    .png()
    .toFile(outputPath);
}

app.post('/remove-bg', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    
    const outputPath = path.join(__dirname, `uploads/nobg_${Date.now()}.png`);
    try {
        await removeWhiteBackground(req.file.path, outputPath);

        res.download(outputPath, 'nobg-image.png', () => {
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });
    } catch (err) {
        console.error(err);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send('Background removal failed.');
    }
});

app.post('/convert', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded.');
    }

    let formats = req.body.formats;
    if (typeof formats === 'string') formats = [formats];

    let removeBgs = req.body.removeBg;
    if (typeof removeBgs === 'string') removeBgs = [removeBgs];

    const timestamp = Date.now();
    const outputDir = path.join(__dirname, `output_${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const convertedFiles = [];

    try {
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            let targetFormat = formats[i] ? formats[i].toLowerCase().replace('.', '') : 'png';
            const shouldRemoveBg = removeBgs && (removeBgs[i] === 'true' || removeBgs[i] === true);
            const originalName = path.parse(file.originalname).name;
            const outputFileName = `${originalName}.${targetFormat}`;
            const outputPath = path.join(outputDir, outputFileName);

            let tempWorkingPath = file.path;

            try {
                if (shouldRemoveBg) {
                    const noBgPath = path.join(__dirname, `uploads/temp_nobg_${Date.now()}_${i}.png`);
                    await removeWhiteBackground(file.path, noBgPath);
                    tempWorkingPath = noBgPath;
                }

                let pipeline = sharp(tempWorkingPath);

                if (targetFormat === 'ico' || targetFormat === 'cur') {
                    const pngBuffer = await pipeline
                        .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .png()
                        .toBuffer();

                    const validBinaryBuffer = await createWindowsCursorOrIcon(pngBuffer, targetFormat);
                    fs.writeFileSync(outputPath, validBinaryBuffer);
                    convertedFiles.push(outputPath);
                } else if (targetFormat === 'svg') {
                    await pipeline.png().toFile(outputPath);
                    convertedFiles.push(outputPath);
                } else {
                    await pipeline.toFormat(targetFormat).toFile(outputPath);
                    convertedFiles.push(outputPath);
                }

                if (tempWorkingPath !== file.path && fs.existsSync(tempWorkingPath)) {
                    fs.unlinkSync(tempWorkingPath);
                }
            } catch (err) {
                console.error(`Conversion error for ${file.originalname}:`, err.message);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            }

            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        }

        if (convertedFiles.length === 0) return res.status(500).send('All conversions failed.');

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=pseudoconvert-batch.zip');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);
        convertedFiles.forEach(filePath => archive.file(filePath, { name: path.basename(filePath) }));
        await archive.finalize();

        setTimeout(() => fs.rmSync(outputDir, { recursive: true, force: true }), 10000);
    } catch (error) {
        console.error(error);
        res.status(500).send('Processing error.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PseudoConvert Ultimate running on port ${PORT}`));
