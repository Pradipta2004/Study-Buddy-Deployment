import { NextApiRequest, NextApiResponse } from 'next';

// Sanitize LaTeX to fix common syntax errors
function sanitizeLatex(latex: string): string {
  let sanitized = latex;
  
  // Fix incorrect enumerate syntax for enumitem package
  // Old style: \begin{enumerate}[(a)] -> New style: \begin{enumerate}[label=(\alph*)]
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(a\)\]/g, '\\begin{enumerate}[label=(\\alph*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(i\)\]/g, '\\begin{enumerate}[label=(\\roman*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[\(1\)\]/g, '\\begin{enumerate}[label=(\\arabic*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[a\)\]/g, '\\begin{enumerate}[label=\\alph*)]');
  sanitized = sanitized.replace(/\\begin\{enumerate\}\[1\)\]/g, '\\begin{enumerate}[label=\\arabic*)]');
  
  // Fix bare underscores outside math mode
  // First, protect math mode content and tabular environments
  const mathBlocks: string[] = [];
  const verbatimBlocks: string[] = [];
  const tabularBlocks: string[] = [];
  let counter = 0;
  
  // Temporarily replace tabular/table environments (they use & as column separator)
  sanitized = sanitized.replace(/\\begin\{tabular\}(\[[^\]]*\])?\{[^}]*\}[\s\S]*?\\end\{tabular\}/g, (match) => {
    const placeholder = `TABULARBLOCK${counter}`;
    tabularBlocks[counter] = match;
    counter++;
    return placeholder;
  });
  
  // Also protect longtable environments
  sanitized = sanitized.replace(/\\begin\{longtable\}(\[[^\]]*\])?\{[^}]*\}[\s\S]*?\\end\{longtable\}/g, (match) => {
    const placeholder = `TABULARBLOCK${counter}`;
    tabularBlocks[counter] = match;
    counter++;
    return placeholder;
  });
  
  // Also protect array environments (used in math for column alignment)
  sanitized = sanitized.replace(/\\begin\{array\}\{[^}]*\}[\s\S]*?\\end\{array\}/g, (match) => {
    const placeholder = `TABULARBLOCK${counter}`;
    tabularBlocks[counter] = match;
    counter++;
    return placeholder;
  });

  // Temporarily replace inline math
  sanitized = sanitized.replace(/\$([^$]+)\$/g, (match) => {
    const placeholder = `MATHBLOCK${counter}`;
    mathBlocks[counter] = match;
    counter++;
    return placeholder;
  });
  
  // Temporarily replace display math
  sanitized = sanitized.replace(/\\\[([^\]]+)\\\]/g, (match) => {
    const placeholder = `MATHBLOCK${counter}`;
    mathBlocks[counter] = match;
    counter++;
    return placeholder;
  });
  
  // Temporarily replace display math $$...$$
  sanitized = sanitized.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
    const placeholder = `MATHBLOCK${counter}`;
    mathBlocks[counter] = match;
    counter++;
    return placeholder;
  });
  
  // Temporarily replace verbatim content
  sanitized = sanitized.replace(/\\verb([^a-zA-Z])(.+?)\1/g, (match) => {
    const placeholder = `VERBBLOCK${counter}`;
    verbatimBlocks[counter] = match;
    counter++;
    return placeholder;
  });
  
  // Temporarily replace LaTeX comments (lines starting with %)
  const commentLines: { [key: string]: string } = {};
  let commentCounter = 0;
  sanitized = sanitized.replace(/^[ \t]*%.*/gm, (match) => {
    const placeholder = `LATEXCOMMENT${commentCounter}`;
    commentLines[placeholder] = match;
    commentCounter++;
    return placeholder;
  });

  // Fix bare special characters outside math mode
  sanitized = sanitized.replace(/(?<!\\)_(?![_\s])/g, '\\_');
  sanitized = sanitized.replace(/(?<!\\)&/g, '\\&');
  sanitized = sanitized.replace(/(?<!\\)#/g, '\\#');
  sanitized = sanitized.replace(/(?<!\\)\^/g, '\\^{}');

  // IMPORTANT: Do NOT globally escape '%' here.
  // In LaTeX, '%' begins a comment and is frequently used in templates/patterned papers.
  // Escaping it would turn comments into visible text (e.g. "\\% For ..."), which is exactly
  // the artifact the user is seeing.
  // Instead, only escape numeric percents that are clearly meant to be rendered, like "50%".
  sanitized = sanitized.replace(/(\d)\s*%(\s|$)/g, '$1\\\\%$2');
  
  // Fix sequences of underscores (like _____ for fill-in-the-blanks)
  // Replace 2 or more consecutive escaped underscores with proper LaTeX blank
  sanitized = sanitized.replace(/(\\_){2,}/g, (match) => {
    const length = Math.min(match.length * 0.15, 4); // Cap at 4cm
    return `\\underline{\\hspace{${length}cm}}`;
  });
  
  // Also handle raw underscore sequences that might have been missed
  sanitized = sanitized.replace(/_{2,}/g, (match) => {
    const length = Math.min(match.length * 0.3, 4);
    return `\\underline{\\hspace{${length}cm}}`;
  });
  
  // Restore math blocks and tabular blocks
  for (let i = counter - 1; i >= 0; i--) {
    if (mathBlocks[i]) {
      sanitized = sanitized.replace(`MATHBLOCK${i}`, mathBlocks[i]);
    }
    if (verbatimBlocks[i]) {
      sanitized = sanitized.replace(`VERBBLOCK${i}`, verbatimBlocks[i]);
    }
    if (tabularBlocks[i]) {
      sanitized = sanitized.replace(`TABULARBLOCK${i}`, tabularBlocks[i]);
    }
  }
  
  // Restore LaTeX comment lines
  for (let i = commentCounter - 1; i >= 0; i--) {
    const placeholder = `LATEXCOMMENT${i}`;
    if (commentLines[placeholder]) {
      sanitized = sanitized.replace(placeholder, commentLines[placeholder]);
    }
  }
  
  // Fix common LaTeX issues
  sanitized = sanitized.replace(/\\\\/g, '\\\\'); // Ensure proper line breaks
  sanitized = sanitized.replace(/\\textbf\s*\{/g, '\\textbf{'); // Remove extra spaces
  sanitized = sanitized.replace(/\\textit\s*\{/g, '\\textit{'); // Remove extra spaces
  
  // Fix unmatched braces (basic check)
  const openBraces = (sanitized.match(/(?<!\\)\{/g) || []).length;
  const closeBraces = (sanitized.match(/(?<!\\)\}/g) || []).length;
  if (openBraces > closeBraces) {
    console.warn(`Unmatched braces detected: ${openBraces} open, ${closeBraces} close`);
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
      const response = await fetch('https://latex.ytotech.com/builds/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          compiler: 'lualatex',
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
        console.error('LaTeX compilation service error:', errorText);
        throw new Error(`LaTeX compilation failed: ${response.status} ${response.statusText}`);
      }

      // Get PDF buffer from response
      const pdfBuffer = await response.arrayBuffer();
      const pdfData = Buffer.from(pdfBuffer);

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
