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

/**
 * Fix unbalanced LaTeX environments that can cause compilation errors.
 * This checks for unclosed begin/end pairs and tries to repair them.
 */
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
  // Append missing closing braces before \end{document}
  if (braceDepth > 0) {
    const closingBraces = '}'.repeat(braceDepth);
    fixed = fixed.replace(/\\end\{document\}/, closingBraces + '\n\\end{document}');
  }

  // Fix unbalanced environments (begin without end)
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

  // Close any unclosed environments before \end{document}
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

/**
 * Restructure LaTeX so that ALL questions appear first, followed by ALL solutions at the end.
 * This extracts solutions from their inline positions and appends them as a separate "ANSWER KEY" section.
 */
function restructureWithSolutionsAtEnd(latex: string): string {
  const solutions: { number: string; content: string }[] = [];

  // ── Step 1 : Extract solutions from  % START SOLUTION … % END SOLUTION markers ──
  // Build a list of {startIdx, endIdx, solutionBody} by scanning line-by-line so we
  // don't accidentally break multi-line LaTeX (align, tabular, etc.)

  const lines = latex.split('\n');
  let inSolution = false;
  let solutionLines: string[] = [];
  let solutionStartLine = -1;
  const solutionBlocks: { startLine: number; endLine: number; body: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^%\s*START\s+SOLUTION/i.test(trimmed)) {
      inSolution = true;
      solutionLines = [];
      solutionStartLine = i;
      continue;
    }
    if (/^%\s*END\s+SOLUTION/i.test(trimmed)) {
      if (inSolution) {
        solutionBlocks.push({
          startLine: solutionStartLine,
          endLine: i,
          body: solutionLines.join('\n').trim(),
        });
      }
      inSolution = false;
      continue;
    }
    if (inSolution) {
      solutionLines.push(lines[i]);
    }
  }

  // ── Step 2 : Determine question number for each solution ──
  for (const block of solutionBlocks) {
    // Scan backwards from the solution start to find the nearest question heading
    const textBefore = lines.slice(0, block.startLine).join('\n');

    // Multiple question-heading patterns Gemini may use
    const qRegexes = [
      /\\subsection\*\{(?:Question|Q\.?)\s*(\d+)/g,
      /\\textbf\{(?:Question|Q\.?)\s*(\d+)/g,
      /\\noindent\s*\\textbf\{(?:Question|Q\.?)\s*(\d+)/g,
      /\\item\s*\[Q\.?\s*(\d+)/g,
      /\\textbf\{(\d+)\./g,              // \textbf{1.  ...}
      /\\noindent\s*(\d+)\.\s*\\textbf/g, // 1. \textbf{...}
      /\\section\*\{(?:Question|Q\.?)\s*(\d+)/g,
    ];

    let qNum = '';
    let maxPos = -1;

    for (const rx of qRegexes) {
      let m;
      while ((m = rx.exec(textBefore)) !== null) {
        if (m.index > maxPos) {
          maxPos = m.index;
          qNum = m[1];
        }
      }
    }

    if (!qNum) {
      qNum = String(solutions.length + 1); // fallback: sequential
    }

    // Clean the solution body — strip redundant headers
    let body = block.body;
    body = body.replace(/^\\subsection\*\{Solution[^}]*\}\s*/i, '');
    body = body.replace(/^\\textbf\{Solution[^}]*\}\s*/i, '');
    body = body.replace(/^\\noindent\s*\\textbf\{Solution[^}]*\}\s*/i, '');
    body = body.replace(/^\s*\\paragraph\*?\{Solution[^}]*\}\s*/i, '');
    body = body.replace(/^\s*Solution[:\.]?\s*/i, '');
    body = body.trim();

    solutions.push({ number: qNum, content: body });
  }

  // ── Step 3 : Rebuild the document — questions only, then solutions at end ──
  // Remove solution blocks by zeroing out lines between markers (inclusive)
  const outputLines = [...lines];
  for (const block of solutionBlocks) {
    for (let i = block.startLine; i <= block.endLine; i++) {
      outputLines[i] = ''; // blank out
    }
  }

  let questionsOnly = outputLines.join('\n');

  // Also remove any stray \subsection*{Solution} ... blocks that were NOT inside markers
  questionsOnly = questionsOnly.replace(
    /\\subsection\*\{Solution\}[\s\S]*?(?=\\subsection\*\{(?:Question|Q)|\\section\*|\\end\{document\})/gi,
    ''
  );
  questionsOnly = questionsOnly.replace(
    /\\noindent\s*\\textbf\{Solution:\}[\s\S]*?(?=\\noindent\s*\\textbf\{(?:Q|Question)|\\subsection\*\{(?:Question|Q)|\\section\*|\\end\{document\})/gi,
    ''
  );
  questionsOnly = questionsOnly.replace(
    /\\textbf\{Solution[:\.]?\}[\s\S]*?(?=\\noindent\s*\\textbf\{(?:Q|Question)|\\subsection\*\{(?:Question|Q)|\\textbf\{(?:Q|Question)|\\section\*|\\end\{document\})/gi,
    ''
  );

  // Final cleanup — remove orphaned "Solution" headers & collapse excessive whitespace
  questionsOnly = questionsOnly.replace(/\\subsection\*\{Solution\}/gi, '');
  questionsOnly = questionsOnly.replace(/\\textbf\{Solution\}/gi, '');
  questionsOnly = questionsOnly.replace(/(\\vspace\{[^}]*\}\s*){2,}/g, '\\vspace{0.5cm}\n');
  // collapse runs of 3+ blank lines to 2
  questionsOnly = questionsOnly.replace(/\n{4,}/g, '\n\n\n');

  // ── Step 4 : Append ANSWER KEY section ──
  if (solutions.length > 0) {
    const solParts = solutions.map(
      (sol) =>
        `\\subsection*{Answer ${sol.number}}\n${sol.content}\n\n\\vspace{0.4cm}`
    );

    const answerSection = `
\\newpage
\\begin{center}
{\\Large \\textbf{ANSWER KEY \\& SOLUTIONS}}\\\\[0.3cm]
\\rule{\\textwidth}{0.4pt}
\\end{center}
\\vspace{0.5cm}

${solParts.join('\n\n')}
`;

    questionsOnly = questionsOnly.replace(
      /\\end\{document\}/,
      answerSection + '\n\\end{document}'
    );
  }

  // ── Step 5 : Fix any broken LaTeX caused by extraction ──
  questionsOnly = fixUnbalancedEnvironments(questionsOnly);

  return questionsOnly;
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

    // Process LaTeX to handle solutions placement
    let processedLatex = latex;
    
    // Sanitize LaTeX to fix common syntax errors
    processedLatex = sanitizeLatex(processedLatex);
    
    if (includeSolutions) {
      // Restructure: ALL questions first, then ALL solutions at the end with proper numbering
      processedLatex = restructureWithSolutionsAtEnd(processedLatex);
    } else {
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

    // Always fix unbalanced environments after any processing
    processedLatex = fixUnbalancedEnvironments(processedLatex);

    console.log(`Processed LaTeX length: ${processedLatex.length}, includeSolutions: ${includeSolutions}`);

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
