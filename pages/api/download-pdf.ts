import { NextApiRequest, NextApiResponse } from 'next';

// Minimal LaTeX sanitizer — only fix clearly broken syntax without corrupting valid LaTeX.
// Gemini already produces well-formed LaTeX, so aggressive escaping does more harm than good.
function sanitizeLatex(latex: string): string {
  let sanitized = latex;

  // Fix incorrect enumerate syntax for enumitem package
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(a\)\]/g, '\\begin{enumerate}[label=(\\alph*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(i\)\]/g, '\\begin{enumerate}[label=(\\roman*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(1\)\]/g, '\\begin{enumerate}[label=(\\arabic*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[a\)\]/g, '\\begin{enumerate}[label=\\alph*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[1\)\]/g, '\\begin{enumerate}[label=\\arabic*)]');

  // Fix sequences of raw underscores (like _____ for fill-in-the-blanks) into proper blanks
  sanitized = sanitized.replace(/_{3,}/g, (match) => {
    const length = Math.min(match.length * 0.3, 4);
    return `\\underline{\\hspace{${length}cm}}`;
  });

  // Remove extra spaces before braces in common commands
  sanitized = sanitized.replace(/\\textbf\s*\{/g, '\\textbf{');
  sanitized = sanitized.replace(/\\textit\s*\{/g, '\\textit{');

  // Ensure document has \end{document}
  if (sanitized.includes('\\begin{document}') && !sanitized.includes('\\end{document}')) {
    sanitized += '\n\\end{document}\n';
  }

  return sanitized;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { latex, includeSolutions = true, subject = 'subject', studentClass = 'class' } = req.body;

    if (!latex) {
      return res.status(400).json({ error: 'No LaTeX content provided' });
    }

    // Process LaTeX to remove solutions if needed
    let processedLatex = latex;
    
    // Sanitize LaTeX to fix common syntax errors
    processedLatex = sanitizeLatex(processedLatex);
    
    if (!includeSolutions) {
      // Remove all solution sections comprehensively
      // Pattern 0: Explicit markers (High Priority)
      processedLatex = processedLatex.replace(/% START SOLUTION[\s\S]*?% END SOLUTION/gi, '');

      // Pattern 1: \subsection*{Solution} ... until next question or end
      processedLatex = processedLatex.replace(/\\subsection\*\{Solution\}[\s\S]*?(?=\\noindent\\textbf\{Q\.|\\subsection\*\{Q|\\subsection\*\{Question|\\end\{document\})/gi, '');
      
      // Pattern 2: \noindent\textbf{Solution:} format
      processedLatex = processedLatex.replace(/\\noindent\\textbf\{Solution:\}[\s\S]*?(?=\\noindent\\textbf\{Q\.|\\subsection\*\{Q|\\subsection\*\{Question|\\end\{document\})/gi, '');
      
      // Pattern 3: \textbf{Solution:} without \noindent
      processedLatex = processedLatex.replace(/\\textbf\{Solution[:\.]?\}[\s\S]*?(?=\\noindent\\textbf\{Q\.|\\subsection\*\{Q|\\subsection\*\{Question|\\textbf\{Q\.|\\end\{document\})/gi, '');
      
      // Pattern 4: Plain "Solution:" text
      processedLatex = processedLatex.replace(/\n\s*Solution:\s*[\s\S]*?(?=\\noindent\\textbf\{Q\.|\\subsection\*\{Q|\\subsection\*\{Question|\\end\{document\})/gi, '');
      
      // Clean up excessive vertical spaces that might be left after removing solutions
      processedLatex = processedLatex.replace(/(\\vspace\{[^}]*\}\s*){2,}/g, '\\vspace{0.5cm}\n');
      
      // Clean up multiple consecutive rule commands
      processedLatex = processedLatex.replace(/(\\noindent\\rule\{[^}]*\}\{[^}]*\}\s*){2,}/g, '\\noindent\\rule{0.5\\textwidth}{0.3pt}\n');
      
      // Remove any orphaned "Solution" headers that might be left
      processedLatex = processedLatex.replace(/\\textbf\{Solution\}/gi, '');
      processedLatex = processedLatex.replace(/\\subsection\*\{Solution\}/gi, '');
    }

    try {
      // Compile LaTeX to PDF using external service
      // Try pdflatex first (faster, more compatible), fallback to lualatex
      const compilers = ['pdflatex', 'lualatex'];
      let pdfData: Buffer | null = null;
      let lastError = '';

      for (const compiler of compilers) {
        try {
          console.log(`Attempting LaTeX compilation with ${compiler}... (content length: ${processedLatex.length})`);
          const response = await fetch('https://latex.ytotech.com/builds/sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
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
            console.error(`LaTeX compilation failed with ${compiler} (${response.status}):`, errorText.substring(0, 500));
            lastError = `${compiler}: ${response.status} - ${errorText.substring(0, 200)}`;
            continue; // Try next compiler
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
          console.log(`LaTeX compilation successful with ${compiler}. PDF size: ${pdfData.length} bytes`);
          break; // Success
        } catch (compilerErr: any) {
          console.error(`${compiler} attempt failed:`, compilerErr.message);
          lastError = `${compiler}: ${compilerErr.message}`;
          continue;
        }
      }

      if (!pdfData) {
        throw new Error(`LaTeX compilation failed with all compilers. Last error: ${lastError}`);
      }

      // Format: studdybuddy_subjectname_class_date
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format
      const sanitizedSubject = subject.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const sanitizedClass = studentClass.replace(/[^a-z0-9]+/g, '');
      const filename = `studdybuddy_${sanitizedSubject}_${sanitizedClass}_${dateStr}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(pdfData);
    } catch (compileError: any) {
      console.error('LaTeX compilation error:', compileError);
      throw new Error(`PDF compilation failed: ${compileError.message}`);
    }
  } catch (error: any) {
    console.error('PDF generation error:', error);
    res.status(500).json({ 
      error: `PDF generation failed: ${error.message}` 
    });
  }
}
