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

    // Formats map from frontend index
    let formats = req.body.formats;
    if (typeof formats === 'string') {
        formats = [formats];
    }

    const timestamp = Date.now();
    const outputDir = path.join(__dirname, `output_${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const convertedFiles = [];

    try {
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const targetFormat = formats[i] ? formats[i].toLowerCase().replace('.', '') : 'png';
            const originalName = path.parse(file.originalname).name;
            const outputFileName = `${originalName}.${targetFormat}`;
            const outputPath = path.join(outputDir, outputFileName);

            try {
                await sharp(file.path)
                    .toFormat(targetFormat)
                    .toFile(outputPath);
                convertedFiles.push(outputPath);
            } catch (err) {
                console.error(`Conversion error for ${file.originalname}:`, err.message);
            }

            // Cleanup raw upload
            fs.unlinkSync(file.path);
        }

        if (convertedFiles.length === 0) {
            return res.status(500).send('All conversions failed.');
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=pseudoconvert-batch.zip');

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
    console.log(`PseudoConvert 10X running on port ${PORT}`);
});
