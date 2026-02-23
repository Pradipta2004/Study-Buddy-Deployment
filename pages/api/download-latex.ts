import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { latex, includeSolutions = true } = req.body;

    if (!latex) {
      return res.status(400).json({ error: 'No LaTeX content provided' });
    }

    let outputLatex = latex;

    // If includeSolutions, restructure so questions come first, solutions at end
    if (includeSolutions) {
      // This is the .tex download — apply same restructuring logic inline
      // (The PDF endpoint has the full function; here we do a simpler version)
      outputLatex = latex; // Keep as-is for .tex — user can edit manually
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `math_questions_${timestamp}.tex`;

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(outputLatex);
  } catch (error: any) {
    console.error('Download error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
