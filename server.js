const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const sharp = require('sharp');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

app.post('/convert', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded.');
    }

    const targetFormat = req.body.format ? req.body.format.toLowerCase().replace('.', '') : 'png';
    const convertedFiles = [];
    const timestamp = Date.now();
    const outputDir = path.join(__dirname, `output_${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        for (const file of req.files) {
            const originalName = path.parse(file.originalname).name;
            const outputFileName = `${originalName}.${targetFormat}`;
            const outputPath = path.join(outputDir, outputFileName);

            // Dynamic conversion logic using Sharp (handles standard images, can be expanded)
            try {
                await sharp(file.path)
                    .toFormat(targetFormat)
                    .toFile(outputPath);
                
                convertedFiles.push(outputPath);
            } catch (conversionError) {
                console.error(`Failed to convert ${file.originalname}:`, conversionError.message);
                // Fallback: If format isn't directly supported by Sharp, copy original or handle gracefully
            }

            // Clean up uploaded raw file
            fs.unlinkSync(file.path);
        }

        if (convertedFiles.length === 0) {
            return res.status(500).send('Conversion failed for all uploaded files.');
        }

        // Create a ZIP archive of converted files
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=pseudoconvert-files.zip');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        convertedFiles.forEach(filePath => {
            archive.file(filePath, { name: path.basename(filePath) });
        });

        await archive.finalize();

        // Clean up output folder after sending
        setTimeout(() => {
            fs.rmSync(outputDir, { recursive: true, force: true });
        }, 10000);

    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred during conversion processing.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`PseudoConvert running on port ${PORT}`);
});
