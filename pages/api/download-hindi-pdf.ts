import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Dedicated PDF download endpoint for Hindi cheatsheets.
 * Uses LuaLaTeX exclusively (required for Devanagari/fontspec).
 */

function sanitizeLatex(latex: string): string {
  let sanitized = latex;

  // Fix incorrect enumerate syntax for enumitem package
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(a\)\]/g, '\\begin{enumerate}[label=(\\alph*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(i\)\]/g, '\\begin{enumerate}[label=(\\roman*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(1\)\]/g, '\\begin{enumerate}[label=(\\arabic*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[a\)\]/g, '\\begin{enumerate}[label=\\alph*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[1\)\]/g, '\\begin{enumerate}[label=\\arabic*)]');

  // Fix fill-in-the-blanks underscores
  sanitized = sanitized.replace(/_{3,}/g, (match) => {
    const length = Math.min(match.length * 0.3, 4);
    return `\\underline{\\hspace{${length}cm}}`;
  });

  // Fix spacing in common commands
  sanitized = sanitized.replace(/\\textbf\s*\{/g, '\\textbf{');
  sanitized = sanitized.replace(/\\textit\s*\{/g, '\\textit{');

  // Remove \ce{} commands (mhchem not loaded) — convert to plain text math
  sanitized = sanitized.replace(/\\ce\{([^}]*)\}/g, (_, content) => {
    return `$\\text{${content}}$`;
  });

  // Remove any \tcolorbox usage
  sanitized = sanitized.replace(/\\begin\{tcolorbox\}(\[[^\]]*\])?/g, '\\begin{center}\\rule{\\textwidth}{0.4pt}');
  sanitized = sanitized.replace(/\\end\{tcolorbox\}/g, '\\rule{\\textwidth}{0.4pt}\\end{center}');

  // Remove \usepackage{multicol} and \begin{multicols} if accidentally included
  sanitized = sanitized.replace(/\\begin\{multicols\}\{[^}]*\}/g, '');
  sanitized = sanitized.replace(/\\end\{multicols\}/g, '');

  // === FIX FONT SETUP: Replace polyglossia + Noto Sans Devanagari with FreeSerif ===
  // Remove polyglossia and old font commands that cause boxes for English text
  sanitized = sanitized.replace(/\\usepackage\{polyglossia\}\s*/g, '');
  sanitized = sanitized.replace(/\\setdefaultlanguage\{[^}]*\}\s*/g, '');
  sanitized = sanitized.replace(/\\setotherlanguage\{[^}]*\}\s*/g, '');
  sanitized = sanitized.replace(/\\newfontfamily\\hindifont\{[^}]*\}(\[[^\]]*\])?\s*/g, '');
  sanitized = sanitized.replace(/\\newfontfamily\\englishfont\{[^}]*\}(\[[^\]]*\])?\s*/g, '');
  sanitized = sanitized.replace(/\\newfontfamily\\devanagarifont\{[^}]*\}(\[[^\]]*\])?\s*/g, '');
  // Replace any \setmainfont with FreeSerif (handles both Latin + Devanagari)
  sanitized = sanitized.replace(/\\setmainfont\{[^}]*\}(\[[^\]]*\])?/g, '\\setmainfont{FreeSerif}');
  // Remove polyglossia language-switch commands from body text
  sanitized = sanitized.replace(/\\textenglish\{([^}]*)\}/g, '$1');
  sanitized = sanitized.replace(/\\texthi(ndi)?\{([^}]*)\}/g, '$2');
  sanitized = sanitized.replace(/\\begin\{english\}/g, '');
  sanitized = sanitized.replace(/\\end\{english\}/g, '');

  // Ensure \usepackage{fontspec} and \setmainfont exist
  if (!sanitized.includes('\\usepackage{fontspec}')) {
    sanitized = sanitized.replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/, '$&\n\\usepackage{fontspec}\n\\setmainfont{FreeSerif}');
  }
  if (!sanitized.includes('\\setmainfont')) {
    sanitized = sanitized.replace(/\\usepackage\{fontspec\}/, '$&\n\\setmainfont{FreeSerif}');
  }

  // Ensure document has \end{document}
  if (sanitized.includes('\\begin{document}') && !sanitized.includes('\\end{document}')) {
    sanitized += '\n\\end{document}\n';
  }

  return sanitized;
}

function fixUnbalancedEnvironments(latex: string): string {
  let fixed = latex;

  // Count and fix unbalanced braces
  let braceDepth = 0;
  let inComment = false;
  for (let i = 0; i < fixed.length; i++) {
    const ch = fixed[i];
    if (ch === '%' && (i === 0 || fixed[i - 1] !== '\\')) {
      inComment = true;
      continue;
    }
    if (ch === '\n') {
      inComment = false;
      continue;
    }
    if (inComment) continue;
    if (ch === '{' && (i === 0 || fixed[i - 1] !== '\\')) braceDepth++;
    if (ch === '}' && (i === 0 || fixed[i - 1] !== '\\')) braceDepth--;
  }

  if (braceDepth > 0) {
    const closingBraces = '}'.repeat(braceDepth);
    fixed = fixed.replace(/\\end\{document\}/, closingBraces + '\n\\end{document}');
  }

  // Fix unbalanced environments
  const envRegex = /\\begin\{(\w+)\}/g;
  const endRegex = /\\end\{(\w+)\}/g;
  const envCounts: Record<string, number> = {};

  let m;
  while ((m = envRegex.exec(fixed)) !== null) {
    const env = m[1];
    if (env === 'document') continue;
    envCounts[env] = (envCounts[env] || 0) + 1;
  }
  while ((m = endRegex.exec(fixed)) !== null) {
    const env = m[1];
    if (env === 'document') continue;
    envCounts[env] = (envCounts[env] || 0) - 1;
  }

  const unclosed: string[] = [];
  for (const [env, count] of Object.entries(envCounts)) {
    for (let i = 0; i < count; i++) {
      unclosed.push(`\\end{${env}}`);
    }
  }
  if (unclosed.length > 0) {
    fixed = fixed.replace(
      /\\end\{document\}/,
      unclosed.join('\n') + '\n\\end{document}'
    );
  }

  return fixed;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { latex, subject = 'hindi', studentClass = '10' } = req.body;

    if (!latex) {
      return res.status(400).json({ error: 'No LaTeX content provided' });
    }

    // Sanitize and fix
    let processedLatex = sanitizeLatex(latex);
    processedLatex = fixUnbalancedEnvironments(processedLatex);

    console.log(`Hindi PDF: Compiling LaTeX (${processedLatex.length} chars) with lualatex...`);

    // Compile with lualatex only (required for fontspec + Devanagari)
    const compilers = ['lualatex', 'xelatex'];
    let pdfData: Buffer | null = null;
    let lastError = '';

    for (const compiler of compilers) {
      try {
        console.log(`Attempting Hindi LaTeX compilation with ${compiler}...`);
        const response = await fetch('https://latex.ytotech.com/builds/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            compiler,
            resources: [
              {
                main: true,
                content: processedLatex,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Hindi LaTeX compilation failed with ${compiler} (${response.status}):`, errorText.substring(0, 500));
          lastError = `${compiler}: ${response.status} - ${errorText.substring(0, 200)}`;
          continue;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/pdf')) {
          const bodyText = await response.text();
          console.error(`${compiler} returned non-PDF response:`, bodyText.substring(0, 500));
          lastError = `${compiler} returned non-PDF content`;
          continue;
        }

        const pdfBuffer = await response.arrayBuffer();
        pdfData = Buffer.from(pdfBuffer);
        console.log(`Hindi LaTeX compilation successful with ${compiler}. PDF size: ${pdfData.length} bytes`);
        break;
      } catch (compilerErr: any) {
        console.error(`${compiler} attempt failed:`, compilerErr.message);
        lastError = `${compiler}: ${compilerErr.message}`;
        continue;
      }
    }

    if (!pdfData) {
      throw new Error(`Hindi PDF compilation failed with all compilers. Last error: ${lastError}`);
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const sanitizedSubject = subject.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const sanitizedClass = studentClass.replace(/[^a-z0-9]+/g, '');
    const filename = `hindi_cheatsheet_${sanitizedSubject}_${sanitizedClass}_${dateStr}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(pdfData);
  } catch (error: any) {
    console.error('Hindi PDF generation error:', error);
    res.status(500).json({
      error: `PDF generation failed: ${error.message}`,
    });
  }
}
