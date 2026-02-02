import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

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
  // First, protect math mode content
  const mathBlocks: string[] = [];
  const verbatimBlocks: string[] = [];
  let counter = 0;
  
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
  sanitized = sanitized.replace(/(?<!\\)%/g, '\\%');
  sanitized = sanitized.replace(/(?<!\\)#/g, '\\#');
  sanitized = sanitized.replace(/(?<!\\)\^/g, '\\^{}');
  
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
  
  // Restore math blocks
  for (let i = counter - 1; i >= 0; i--) {
    if (mathBlocks[i]) {
      sanitized = sanitized.replace(`MATHBLOCK${i}`, mathBlocks[i]);
    }
    if (verbatimBlocks[i]) {
      sanitized = sanitized.replace(`VERBBLOCK${i}`, verbatimBlocks[i]);
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

  let tempDir: string | null = null;

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

    // Create temporary directory
    const tmpBaseDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpBaseDir)) {
      fs.mkdirSync(tmpBaseDir, { recursive: true });
    }

    tempDir = fs.mkdtempSync(path.join(tmpBaseDir, 'latex-'));

    // Check if pdflatex is installed
    try {
      await execPromise('which pdflatex');
    } catch (checkError) {
      return res.status(500).json({
        error: 'PDF generation is not available. pdflatex is not installed. Please download the LaTeX file instead and compile it locally, or install texlive-latex-base and texlive-latex-extra packages.',
      });
    }

    // Write LaTeX content to file
    const texFile = path.join(tempDir, 'questions.tex');
    fs.writeFileSync(texFile, processedLatex, 'utf-8');

    try {
      // Compile LaTeX to PDF using pdflatex
      // Run twice to resolve references (standard LaTeX practice)
      try {
        await execPromise(
          `pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texFile}"`,
          { timeout: 30000 }
        );
      } catch (firstPassError) {
        // First pass might fail, but we still want to try second pass
        console.log('First pdflatex pass completed with warnings/errors');
      }

      // Second pass to resolve references
      try {
        await execPromise(
          `pdflatex -interaction=nonstopmode -output-directory="${tempDir}" "${texFile}"`,
          { timeout: 30000 }
        );
      } catch (secondPassError) {
        // Second pass might also have warnings/errors, but check if PDF was created
        console.log('Second pdflatex pass completed with warnings/errors');
      }

      const pdfFile = path.join(tempDir, 'questions.pdf');

      if (!fs.existsSync(pdfFile)) {
        // Check for errors in log file
        const logFile = path.join(tempDir, 'questions.log');
        let errorMsg = 'LaTeX compilation failed.';
        let errorDetails: string[] = [];
        
        if (fs.existsSync(logFile)) {
          const logContent = fs.readFileSync(logFile, 'utf-8');
          
          // Extract error lines with more context
          const lines = logContent.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('!') || lines[i].includes('Error')) {
              // Get the error and next 2 lines for context
              errorDetails.push(lines.slice(i, i + 3).join('\n'));
            }
          }
          
          if (errorDetails.length > 0) {
            errorMsg = errorDetails.slice(0, 2).join(' | ').substring(0, 300);
            console.error('LaTeX compilation errors:', errorDetails.slice(0, 3));
          }
          
          // Also check for specific common errors
          if (logContent.includes('Missing $ inserted')) {
            errorMsg = 'LaTeX syntax error: Math mode issue. Please check underscores and special characters.';
          }
          if (logContent.includes('Undefined control sequence')) {
            const match = logContent.match(/Undefined control sequence[.\s\S]{0,100}/);
            errorMsg = match ? match[0].substring(0, 200) : 'LaTeX syntax error: Invalid command used.';
          }
          if (logContent.includes('! Package')) {
            errorMsg = 'Missing LaTeX package. The generated code uses packages that may not be installed.';
          }
          
          // Save the log file for debugging
          console.error('Full LaTeX log saved to:', logFile);
          console.error('LaTeX file:', texFile);
        }
        
        throw new Error(errorMsg);
      }

      // Read PDF file
      const pdfData = fs.readFileSync(pdfFile);

      // Format: studdybuddy_subjectname_class_date
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format
      const sanitizedSubject = subject.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const sanitizedClass = studentClass.replace(/[^a-z0-9]+/g, '');
      const filename = `studdybuddy_${sanitizedSubject}_${sanitizedClass}_${dateStr}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(pdfData);
    } catch (execError: any) {
      if (execError.code === 'ENOENT') {
        return res.status(500).json({
          error: 'PDF compilation not available. pdflatex is not installed. Please download the LaTeX file instead and compile it locally.',
        });
      }
      if (execError.killed) {
        return res.status(500).json({ error: 'PDF compilation timed out' });
      }
      throw execError;
    }
  } catch (error: any) {
    console.error('PDF generation error:', error);
    console.error('Temp directory (preserved for debugging):', tempDir);
    res.status(500).json({ 
      error: `PDF generation failed: ${error.message}` 
    });
    // Don't clean up on error so we can debug
    tempDir = null;
  } finally {
    // Clean up temporary directory only on success
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
  }
}
