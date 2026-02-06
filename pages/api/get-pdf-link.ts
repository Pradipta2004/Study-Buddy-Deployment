import { NextApiRequest, NextApiResponse } from 'next';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// This endpoint stores the PDF temporarily and returns a direct link
// This is a workaround for WebView environments that block blob URLs

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { pdfBuffer, filename } = req.body;

    if (!pdfBuffer || !filename) {
      return res.status(400).json({ error: 'Missing PDF data or filename' });
    }

    // Create temp directory if it doesn't exist
    const tempDir = join(process.cwd(), 'public', 'temp-pdfs');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const uniqueFilename = `${timestamp}_${filename}`;
    const filePath = join(tempDir, uniqueFilename);

    // Convert base64 back to buffer and save
    const buffer = Buffer.from(pdfBuffer, 'base64');
    writeFileSync(filePath, buffer);

    // Return the public URL
    const publicUrl = `/temp-pdfs/${uniqueFilename}`;

    // Schedule cleanup after 5 minutes (optional)
    setTimeout(() => {
      try {
        const fs = require('fs');
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        console.error('Failed to cleanup temp file:', err);
      }
    }, 5 * 60 * 1000);

    res.status(200).json({ url: publicUrl });
  } catch (error: any) {
    console.error('PDF link generation error:', error);
    res.status(500).json({ 
      error: `Failed to generate PDF link: ${error.message}` 
    });
  }
}
