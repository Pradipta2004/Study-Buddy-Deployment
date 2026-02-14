const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;

const execAsync = promisify(exec);

/**
 * Compress a PDF file to maximum compression
 * @param {string} inputPath - Path to input PDF file
 * @param {string} outputPath - Path to output compressed PDF file
 * @param {object} options - Compression options
 * @returns {Promise<object>} - Compression results with file sizes
 */
async function compressPDF(inputPath, outputPath, options = {}) {
  const {
    dpi = 72,              // Lower DPI = smaller file (72 is minimum)
    imageQuality = 0,      // 0 = max compression, 4 = max quality
    compatibilityLevel = '1.4'
  } = options;

  // Quality settings mapping
  const qualitySettings = {
    0: '/screen',      // Maximum compression (72 dpi)
    1: '/ebook',       // Medium compression (150 dpi)
    2: '/printer',     // Good quality (300 dpi)
    3: '/prepress',    // High quality (300 dpi, color preserved)
    4: '/default'      // Highest quality
  };

  const quality = qualitySettings[imageQuality] || '/screen';

  // Detect OS and use appropriate Ghostscript executable
  const isWindows = process.platform === 'win32';
  const gsExecutable = isWindows ? 'gswin64c' : 'gs';

  // Ghostscript command for maximum compression
  const gsCommand = `${gsExecutable} -sDEVICE=pdfwrite \
    -dCompatibilityLevel=${compatibilityLevel} \
    -dPDFSETTINGS=${quality} \
    -dNOPAUSE \
    -dQUIET \
    -dBATCH \
    -dDetectDuplicateImages=true \
    -dCompressFonts=true \
    -dSubsetFonts=true \
    -dColorImageDownsampleType=/Bicubic \
    -dColorImageResolution=${dpi} \
    -dGrayImageDownsampleType=/Bicubic \
    -dGrayImageResolution=${dpi} \
    -dMonoImageDownsampleType=/Bicubic \
    -dMonoImageResolution=${dpi} \
    -dOptimize=true \
    -dEmbedAllFonts=true \
    -sOutputFile="${outputPath}" \
    "${inputPath}"`;

  try {
    // Check if input file exists
    await fs.access(inputPath);

    // Get original file size
    const originalStats = await fs.stat(inputPath);
    const originalSize = originalStats.size;

    console.log(`Compressing: ${inputPath}`);
    console.log(`Original size: ${formatBytes(originalSize)}`);

    // Execute Ghostscript compression
    await execAsync(gsCommand);

    // Get compressed file size
    const compressedStats = await fs.stat(outputPath);
    const compressedSize = compressedStats.size;

    const savedBytes = originalSize - compressedSize;
    const compressionRatio = ((savedBytes / originalSize) * 100).toFixed(2);

    console.log(`Compressed size: ${formatBytes(compressedSize)}`);
    console.log(`Saved: ${formatBytes(savedBytes)} (${compressionRatio}% reduction)`);

    return {
      success: true,
      originalSize,
      compressedSize,
      savedBytes,
      compressionRatio: parseFloat(compressionRatio),
      inputPath,
      outputPath
    };
  } catch (error) {
    if (error.code === 'ENOENT' && error.path === inputPath) {
      throw new Error(`Input file not found: ${inputPath}`);
    }
    if (error.message.includes('command not found') || error.message.includes('is not recognized')) {
      const installInstructions = process.platform === 'win32'
        ? 'Ghostscript is not installed or not in PATH. Download from https://ghostscript.com/releases/gsdnld.html and add to PATH.'
        : 'Ghostscript is not installed. Install it using: sudo apt-get install ghostscript (Linux) or brew install ghostscript (Mac)';
      throw new Error(installInstructions);
    }
    throw error;
  }
}

/**
 * Batch compress multiple PDF files
 * @param {string[]} inputPaths - Array of input PDF paths
 * @param {string} outputDir - Output directory for compressed files
 * @param {object} options - Compression options
 */
async function batchCompress(inputPaths, outputDir, options = {}) {
  // Create output directory if it doesn't exist
  await fs.mkdir(outputDir, { recursive: true });

  const results = [];

  for (const inputPath of inputPaths) {
    const filename = path.basename(inputPath);
    const outputPath = path.join(outputDir, `compressed_${filename}`);

    try {
      const result = await compressPDF(inputPath, outputPath, options);
      results.push(result);
    } catch (error) {
      console.error(`Error compressing ${inputPath}:`, error.message);
      results.push({
        success: false,
        inputPath,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Example usage
async function main() {
  // Single file compression
  try {
    await compressPDF(
      './input.pdf',
      './output-compressed.pdf',
      {
        dpi: 72,           // Maximum compression
        imageQuality: 0,   // Screen quality (smallest)
        compatibilityLevel: '1.4'
      }
    );
  } catch (error) {
    console.error('Compression failed:', error.message);
  }

  // Batch compression example (commented out)
  /*
  const results = await batchCompress(
    ['./file1.pdf', './file2.pdf', './file3.pdf'],
    './compressed-pdfs',
    { dpi: 72, imageQuality: 0 }
  );
  console.log('Batch compression results:', results);
  */
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  compressPDF,
  batchCompress,
  formatBytes
};
