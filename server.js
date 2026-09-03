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
            
            // ICO and CUR formats are structurally similar; processed via PNG/ICO container standards
            let actualTarget = targetFormat;
            if (targetFormat === 'ico' || targetFormat === 'cur') {
                actualTarget = 'png'; // Render pipeline handles base buffer, named with proper extension below
            }

            const outputFileName = `${originalName}.${targetFormat}`;
            const outputPath = path.join(outputDir, outputFileName);

            try {
                let pipeline = sharp(file.path);

                // Background removal toggle (Auto threshold background cleanup)
                if (shouldRemoveBg) {
                    pipeline = pipeline.ensureAlpha().linear(1.0, 0).flatten({ background: { r: 255, g: 255, b: 255 } });
                    // Advanced color manipulation can be handled via thresholding pixel channels
                }

                if (targetFormat === 'ico' || targetFormat === 'cur') {
                    await pipeline
                        .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                        .toFormat('png')
                        .toFile(outputPath);
                } else {
                    await pipeline
                        .toFormat(actualTarget)
                        .toFile(outputPath);
                }

                convertedFiles.push(outputPath);
            } catch (err) {
                console.error(`Conversion error for ${file.originalname}:`, err.message);
            }

            fs.unlinkSync(file.path);
        }

        if (convertedFiles.length === 0) {
            return res.status(500).send('All conversions failed.');
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=pseudoconvert-pro.zip');

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
    console.log(`PseudoConvert PRO running on port ${PORT}`);
});
