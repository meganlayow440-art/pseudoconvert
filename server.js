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

// Helper to create valid Windows .ico or .cur buffers from PNG buffers
async function createWindowsCursorOrIcon(pngBuffer, type = 'ico') {
    const metadata = await sharp(pngBuffer).metadata();
    const width = metadata.width >= 256 ? 0 : metadata.width; // 0 means 256px inico spec
    const height = metadata.height >= 256 ? 0 : metadata.height;
    
    const imageType = type === 'cur' ? 2 : 1; // 2 = CUR, 1 = ICO
    const headerSize = 6;
    const directoryEntrySize = 16;
    const imageOffset = headerSize + directoryEntrySize;

    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0); // Reserved
    header.writeUInt16LE(imageType, 2); // Type (1=ICO, 2=CUR)
    header.writeUInt16LE(1, 1); // Image count

    const entry = Buffer.alloc(directoryEntrySize);
    entry.writeUInt8(width, 0);
    entry.writeUInt8(height, 1);
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    
    if (type === 'cur') {
        // Hotspot coordinates (center of the image by default)
        entry.writeUInt16LE(Math.floor(metadata.width / 2), 4);
        entry.writeUInt16LE(Math.floor(metadata.height / 2), 6);
    } else {
        entry.writeUInt16LE(1, 4); // Color planes
        entry.writeUInt16LE(32, 6); // Bits per pixel
    }

    entry.writeUInt32LE(pngBuffer.length, 8); // Size of image data
    entry.writeUInt32LE(imageOffset, 12); // Offset of image data

    return Buffer.concat([header, entry, pngBuffer]);
}

app.post('/convert', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded.');
    }

    let formats = req.body.formats;
    if (typeof formats === 'string') {
        formats = [formats];
    }

    let removeBgs = req.body.removeBg;
    if (typeof removeBgs === 'string') {
        removeBgs = [removeBgs];
    }

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

            try {
                let pipeline = sharp(file.path);

                if (shouldRemoveBg) {
                    pipeline = pipeline.ensureAlpha().flatten({ background: { r: 255, g: 255, b: 255 } });
                }

                if (targetFormat === 'ico' || targetFormat === 'cur') {
                    // Resize to a standard cursor/icon resolution (e.g., 64x64 or 128x128 works best for Windows cursors)
                    const pngBuffer = await pipeline
                        .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .png()
                        .toBuffer();

                    const validBinaryBuffer = await createWindowsCursorOrIcon(pngBuffer, targetFormat);
                    fs.writeFileSync(outputPath, validBinaryBuffer);
                    convertedFiles.push(outputPath);
                } else {
                    // Standard raster formats (PNG, JPG, WEBP)
                    await pipeline
                        .toFormat(targetFormat)
                        .toFile(outputPath);
                    convertedFiles.push(outputPath);
                }
            } catch (err) {
                console.error(`Conversion error for ${file.originalname}:`, err.message);
                // Prevent writing 1-byte corrupt files by cleaning up failed outputs
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
            }

            // Cleanup raw upload
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        }

        if (convertedFiles.length === 0) {
            return res.status(500).send('All conversions failed.');
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=pseudoconvert-fixed.zip');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        convertedFiles.forEach(filePath => {
            archive.file(filePath, { name: path.basename(filePath) });
        });

        await archive.finalize();

        setTimeout(() => {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }, 10000);

    } catch (error) {
        console.error(error);
        res.status(500).send('Processing error.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`PseudoConvert Fixed running on port ${PORT}`);
});
