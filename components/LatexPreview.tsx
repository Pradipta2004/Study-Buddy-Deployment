'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  content: string;
  onQuestionsLoaded?: (questions: Array<{ number: number; question: string; solution: string }>) => void;
}

interface Question {
  number: number;
  question: string;
  solution: string;
}

export default function LatexPreview({ content, onQuestionsLoaded }: Props) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [visibleSolutions, setVisibleSolutions] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Parse questions and solutions from LaTeX content
    const parseQuestions = () => {
      const parsedQuestions: Question[] = [];
      
      console.log('Starting to parse LaTeX content...');
      console.log('Full content length:', content.length);
      
      // First, extract just the questions section to avoid parsing preamble
      let questionsContent = content;
      
      // Remove everything before \begin{document}
      const docStart = content.indexOf('\\begin{document}');
      if (docStart !== -1) {
        questionsContent = content.substring(docStart);
      }
      
      // Look for the main questions section after instructions
      // Try multiple section markers
      const sectionMarkers = [
        /(?:SECTION:\s*QUESTIONS|Questions Section|QUESTIONS|BEGIN QUESTIONS)([\s\S]*?)(?=\\end\{document\}|$)/i,
        /(?:\\end\{tabular\}[\s\S]*?\\end\{tabular\})([\s\S]*?)(?=\\end\{document\}|$)/, // After header tables
        /(?:\\end\{enumerate\}[\s\S]{0,200})(\\textbf\{Q|\\noindent[\s\S]*?Q\.|^\s*\d+\.)/m // After instructions enumerate
      ];
      
      for (const marker of sectionMarkers) {
        const match = questionsContent.match(marker);
        if (match) {
          questionsContent = match[1] || match[0];
          console.log('Found questions section with marker');
          break;
        }
      }
      
      console.log('Questions content length after extraction:', questionsContent.length);
      console.log('First 500 chars:', questionsContent.substring(0, 500));
      
      // ENHANCED: Try multiple patterns in order of specificity
      const patterns = [
        // Pattern 1: \noindent\textbf{Q.N} format (standard format)
        {
          regex: /\\noindent\\textbf\{Q\.(\d+)\}\s*\\hfill\s*\\textbf\{\[([^\]]+)\]\}([\s\S]*?)(?=\\noindent\\textbf\{Q\.\d+\}|\\end\{document\}|$)/g,
          solutionPattern: /([\s\S]*?)\\noindent\\textbf\{Solution:\}([\s\S]*?)(?=\\noindent\\rule|$)/
        },
        // Pattern 2: \textbf{Q.N} \hfill format (common in patterns) - MORE FLEXIBLE
        {
          regex: /\\textbf\{Q\.(\d+)\}\s*\\hfill\s*\\textbf\{\[([^\]]+)\]\}([\s\S]*?)(?=\\textbf\{Q\.\d+\}|\\end\{document\}|$)/g,
          solutionPattern: /([\s\S]*?)(?:\\textbf\{)?Solution[:\.]?(?:\})?[\s\S]*?([\s\S]*?)$/
        },
        // Pattern 2b: \textbf{Q.N} without \hfill (pattern variations)
        {
          regex: /\\textbf\{Q\.(\d+)\}[\s\S]*?\[([^\]]+)\]([\s\S]*?)(?=\\textbf\{Q\.\d+\}|\\end\{document\}|$)/g,
          solutionPattern: /([\s\S]*?)(?:\\textbf\{)?(?:Solution|Ans)[:\.\)]?(?:\})?[\s\S]*?([\s\S]*?)$/
        },
        // Pattern 3: \subsection* format
        {
          regex: /\\subsection\*\{(?:Q\.|Question)\s*(\d+)\s*\[([^\]]+)\]\}([\s\S]*?)(?=\\subsection\*\{(?:Q\.|Question)|\\end\{document\}|$)/g,
          solutionPattern: /([\s\S]*?)\\subsection\*\{Solution\}([\s\S]*?)(?=\\vspace|$)/
        },
        // Pattern 4: Simple numbered format (Q1, Q.1, Question 1, etc.) - very flexible
        {
          regex: /(?:^|\\noindent\s*)(?:\\textbf\{)?(?:Q\.?|Question)\s*(\d+)(?:\})?(?:\s*[\(\[]?([^\]\)]*?marks?)[\]\)]?)?[:\.\)]?\s*([\s\S]*?)(?=(?:^|\\noindent\s*)(?:\\textbf\{)?(?:Q\.?|Question)\s*\d+|\\end\{document\}|$)/gm,
          solutionPattern: /([\s\S]*?)(?:\\textbf\{)?(?:Solution|Answer|Ans)[:\.\)]?(?:\})?[\s\S]*?([\s\S]*?)$/
        },
        // Pattern 5: Section-based
        {
          regex: /\\section\*\{(?:Question\s+)?(\d+)(?:\s*\[([^\]]+)\])?\}([\s\S]*?)(?=\\section\*\{|\\end\{document\}|$)/g,
          solutionPattern: /([\s\S]*?)\\section\*\{Solution\}([\s\S]*?)$/
        },
        // Pattern 6: Number with period at start of line (very common in custom patterns)
        {
          regex: /(?:^|\n)\s*(\d+)[\.\)]\s*([\s\S]*?)(?=(?:^|\n)\s*\d+[\.\)]|\\end\{document\}|$)/gm,
          solutionPattern: /([\s\S]*?)(?:Solution|Answer|Ans)[:\.\)]?\s*([\s\S]*?)$/
        }
      ];
      
      for (const pattern of patterns) {
        let match;
        pattern.regex.lastIndex = 0;
        
        console.log('Trying pattern with regex:', pattern.regex.source.substring(0, 100));
        
        while ((match = pattern.regex.exec(questionsContent)) !== null) {
          const questionNumber = parseInt(match[1]);
          const marks = match[2] || 'N/A';
          const fullContent = match[3] || match[2]; // Some patterns have content in different groups
          
          console.log(`Found potential question ${questionNumber}, content length: ${fullContent?.length}`);
          
          if (isNaN(questionNumber) || !fullContent || fullContent.trim().length < 5) {
            console.log('Skipping - invalid number or too short');
            continue;
          }
          
          // Filter out instructions/non-questions - be more lenient
          const lowerContent = fullContent.toLowerCase();
          if (lowerContent.includes('instructions to candidates') ||
              lowerContent.includes('general instructions') ||
              (lowerContent.includes('answer any') && fullContent.length < 100) ||
              lowerContent.includes('examination paper') ||
              lowerContent.includes('duration:') && lowerContent.includes('maximum marks:')) {
            console.log('Skipping - matches instruction pattern');
            continue;
          }
          
          // Try to split by solution
          let questionText, solutionText;
          
          // Priority 1: Check for explicit solution markers
          const markerMatch = fullContent.match(/([\s\S]*?)% START SOLUTION([\s\S]*?)% END SOLUTION/);
          
          if (markerMatch) {
            questionText = markerMatch[1].trim();
            solutionText = markerMatch[2].trim();
            console.log(`Found solution with explicit markers for Q${questionNumber}`);
          } else {
            // Priority 2: Use pattern-specific solution regex
            const solutionMatch = fullContent.match(pattern.solutionPattern);
            
            if (solutionMatch) {
              questionText = solutionMatch[1].trim();
              solutionText = solutionMatch[2]?.trim() || '';
            } else {
              questionText = fullContent.trim();
              solutionText = '';
            }
          }
          
          // More lenient length check
          if (questionText.length > 5) {
            console.log(`Adding question ${questionNumber}`);
            parsedQuestions.push({
              number: questionNumber,
              question: questionText,
              solution: solutionText
            });
          }
        }
        
        if (parsedQuestions.length > 0) {
          console.log(`Found ${parsedQuestions.length} questions with pattern`);
          break;
        }
      }

      // Remove duplicates and sort by question number
      const uniqueQuestions = Array.from(
        new Map(parsedQuestions.map(q => [q.number, q])).values()
      ).sort((a, b) => a.number - b.number);

      console.log(`Final parsed questions count: ${uniqueQuestions.length}`);
      if (uniqueQuestions.length > 0) {
        console.log('First question:', uniqueQuestions[0]);
      }

      setQuestions(uniqueQuestions);
      if (onQuestionsLoaded) {
        onQuestionsLoaded(uniqueQuestions);
      }
    };

    if (content) {
      parseQuestions();
    }
  }, [content, onQuestionsLoaded]);

  useEffect(() => {
    if (previewRef.current && typeof window !== 'undefined' && questions.length > 0) {
      // Render LaTeX math using KaTeX via script tag
      const renderMath = () => {
        try {
          // Load katex and auto-render via CDN for reliability
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js';
          script.onload = () => {
            const script2 = document.createElement('script');
            script2.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js';
            script2.onload = () => {
              // Call the render function from window
              if (window && (window as any).renderMathInElement && previewRef.current) {
                (window as any).renderMathInElement(previewRef.current, {
                  delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\(', right: '\\)', display: false },
                  ],
                  throwOnError: false,
                  trust: true,
                });
              }
            };
            document.head.appendChild(script2);
          };
          document.head.appendChild(script);
        } catch (error) {
          console.error('KaTeX rendering error:', error);
        }
      };

      // Use setTimeout to ensure DOM is ready
      setTimeout(renderMath, 100);
    }
  }, [questions, visibleSolutions]);

  const toggleSolution = (questionNumber: number) => {
    setVisibleSolutions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionNumber)) {
        newSet.delete(questionNumber);
      } else {
        newSet.add(questionNumber);
      }
      return newSet;
    });
  };

  // Convert LaTeX content to HTML-friendly format
  const formatContent = (latex: string) => {
    // Remove documentclass and preamble for preview
    let formatted = latex.split('\n').filter(line => !line.trim().startsWith('%')).join('\n');
    
    formatted = formatted
      .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/g, '')
      .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]*\}/g, '')
      .replace(/\\geometry\{[^}]*\}/g, '')
      .replace(/\\pagestyle\{[^}]*\}/g, '')
      .replace(/\\setlength\{[^}]*\}\{[^}]*\}/g, '')
      .replace(/\\addtolength\{[^}]*\}\{[^}]*\}/g, '')
      .replace(/\\fancyhf\{\}/g, '')
      .replace(/\\fancyhead\[[^\]]*\]\{[^}]*\}/g, '')
      .replace(/\\fancyfoot\[[^\]]*\]\{[^}]*\}/g, '')
      .replace(/\\begin\{document\}/g, '')
      .replace(/\\end\{document\}/g, '')
      .replace(/\\maketitle/g, '')
      .replace(/\\title\{([^}]*)\}/g, '')
      .replace(/\\author\{([^}]*)\}/g, '')
      .replace(/\\date\{([^}]*)\}/g, '')
      .replace(/\\noindent/g, '')
      .replace(/\\centering/g, '')
      .replace(/\\phantom\{[^}]*\}/g, '')
      .replace(/\\dimexpr[^}]*\\fboxsep[^}]*\\fboxrule/g, '100%')
      .replace(/\\vspace\{[^}]*\}/g, '<div class="my-4"></div>')
      // Handle fill-in-the-blank pattern BEFORE processing standalone hspace and underline
      .replace(/\\underline\{\\hspace\{([^}]+)\}\}/g, (match, size) => {
        console.log('Found fill-in-blank:', match, 'Size:', size);
        // Convert LaTeX size to pixels (approximate: 1cm ≈ 37.8px)
        const numMatch = size.match(/([\d.]+)/);
        const num = numMatch ? parseFloat(numMatch[1]) : 2;
        const pixels = Math.max(num * 37.8, 80); // Minimum 80px for visibility
        const replacement = `<span class="inline-block border-b-2 border-gray-800" style="width: ${pixels}px; min-width: 80px; height: 1.5em; vertical-align: bottom;"></span>`;
        console.log('Replacement:', replacement);
        return replacement;
      })
      .replace(/\\hspace\{[^}]*\}/g, '<span class="inline-block w-4"></span>')
      .replace(/\\newpage/g, '<div class="border-t-2 border-gray-300 my-8"></div>');

    // Convert center environment
    formatted = formatted
      .replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g, '<div class="text-center">$1</div>');

    // Convert fbox and parbox - special handling for instruction boxes
    formatted = formatted
      .replace(/\\fbox\{\\parbox\{[^}]*\}\{([\s\S]*?)\}\}/g, (match, content) => {
        // For instruction boxes, use special formatting
        const processed = content
          .replace(/\\begin\{itemize\}\[leftmargin=\*,?\s*itemsep=[^\]]*\]/g, '<ul class="list-disc ml-5 space-y-0.5 my-2">')
          .replace(/\\begin\{itemize\}\[itemsep=[^\]]*\]/g, '<ul class="list-disc ml-5 space-y-0.5 my-2">')
          .replace(/\\begin\{itemize\}/g, '<ul class="list-disc ml-5 space-y-1 my-2">');
        return `<div class="border-2 border-black p-4 my-6 bg-white">${processed}</div>`;
      })
      .replace(/\\fbox\{([\s\S]*?)\}/g, '<div class="border-2 border-gray-800 p-4 rounded-md inline-block">$1</div>');

    // Convert rules and lines
    formatted = formatted
      .replace(/\\rule\{[^}]*\}\{[^}]*\}/g, '<hr class="border-t-2 border-gray-400 my-2" />');

    // Convert sections
    formatted = formatted
      .replace(/\\section\*\{([^}]*)\}/g, '<h2 class="text-2xl font-bold mt-8 mb-4 text-purple-700">$1</h2>')
      .replace(/\\subsection\*\{([^}]*)\}/g, '<h3 class="text-xl font-semibold mt-6 mb-3 text-indigo-600">$1</h3>')
      .replace(/\\section\{([^}]*)\}/g, '<h2 class="text-2xl font-bold mt-8 mb-4 text-purple-700">$1</h2>')
      .replace(/\\subsection\{([^}]*)\}/g, '<h3 class="text-xl font-semibold mt-6 mb-3 text-indigo-600">$1</h3>');

    // Convert font sizes
    formatted = formatted
      .replace(/\{\\Large\s+(.*?)\}/g, '<span class="text-2xl">$1</span>')
      .replace(/\{\\large\s+(.*?)\}/g, '<span class="text-xl">$1</span>')
      .replace(/\{\\small\s+(.*?)\}/g, '<span class="text-sm">$1</span>')
      .replace(/\{\\tiny\s+(.*?)\}/g, '<span class="text-xs">$1</span>');

    // Convert lists with better support for itemize options (default case)
    formatted = formatted
      .replace(/\\begin\{itemize\}(?:\[[^\]]*\])?/g, '<ul class="list-disc ml-6 my-3 space-y-1">')
      .replace(/\\end\{itemize\}/g, '</ul>')
      .replace(/\\begin\{enumerate\}(?:\[[^\]]*\])?/g, '<ol class="list-decimal ml-6 my-3 space-y-1">')
      .replace(/\\end\{enumerate\}/g, '</ol>')
      .replace(/\\item(?:\s*\[[^\]]*\])?/g, '<li class="ml-0 pl-1">');

    // Convert text formatting
    formatted = formatted
      .replace(/\\textbf\{([^}]*)\}/g, '<strong>$1</strong>')
      .replace(/\\textit\{([^}]*)\}/g, '<em>$1</em>')
      .replace(/\\emph\{([^}]*)\}/g, '<em>$1</em>')
      .replace(/\\underline\{([^}]*)\}/g, '<u>$1</u>');

    // Convert line breaks
    formatted = formatted
      .replace(/\\\\\[?[^\]]*\]?/g, '<br/>')
      .replace(/\\newline/g, '<br/>');

    // Handle special characters (but preserve $ for math mode)
    formatted = formatted
      .replace(/\\&/g, '&')
      .replace(/\\%/g, '%')
      .replace(/\\#/g, '#')
      // Only unescape underscores outside math mode (simplified approach)
      .replace(/\\_(?![^$]*\$)/g, '_');
    
    // Handle additional LaTeX commands
    formatted = formatted
      .replace(/\\bigskip/g, '<div class="my-6"></div>')
      .replace(/\\medskip/g, '<div class="my-4"></div>')
      .replace(/\\smallskip/g, '<div class="my-2"></div>')
      .replace(/\\quad/g, '<span class="inline-block w-8"></span>')
      .replace(/\\qquad/g, '<span class="inline-block w-16"></span>')
      .replace(/\\par\s*/g, '</p><p class="my-4">');

    // Add paragraph breaks for double newlines
    formatted = formatted
      .split('\n\n')
      .map(para => para.trim())
      .filter(para => para.length > 0 && !para.match(/^<[^>]+>$/))
      .map(para => {
        // Don't wrap if already wrapped in HTML tags
        if (para.match(/^<(div|h[1-6]|ul|ol|hr)/)) {
          return para;
        }
        return `<p class="my-4">${para}</p>`;
      })
      .join('\n');

    return formatted;
  };

  return (
    <div className="bg-gradient-to-br from-gray-50 to-purple-50 border-2 border-purple-200 rounded-xl p-3 sm:p-6 max-h-[700px] overflow-y-auto">
      {questions.length > 0 ? (
        <div className="space-y-4">
          <div className="text-center mb-4">
            <h1 className="text-xl sm:text-2xl font-bold text-purple-700">📚 Questions</h1>
            <p className="text-xs text-gray-600 mt-1">{questions.length} question{questions.length > 1 ? 's' : ''}</p>
          </div>
          
          <div ref={previewRef} className="space-y-3">
            {questions.map((q) => (
              <div key={q.number} className="bg-white rounded-lg shadow hover:shadow-md transition-all overflow-hidden border border-purple-200">
                {/* Card Header */}
                <div className="bg-gradient-to-r from-purple-500 to-indigo-600 p-3 flex justify-between items-center gap-2">
                  <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2 flex-1">
                    <span className="bg-white text-purple-600 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {q.number}
                    </span>
                    <span className="truncate">Q{q.number}</span>
                  </h2>
                </div>

                {/* Question Content */}
                <div className="p-3 sm:p-4 border-b border-gray-200">
                  <div
                    className="prose prose-sm max-w-none text-gray-800 text-xs sm:text-sm leading-relaxed [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&_li]:my-0.5"
                    dangerouslySetInnerHTML={{ __html: formatContent(q.question) }}
                  />
                </div>

                {/* Solution */}
                {q.solution && visibleSolutions.has(q.number) && (
                  <>
                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-t-2 border-green-300 px-3 sm:px-4 py-2">
                      <p className="font-bold text-green-700 text-xs sm:text-sm mb-2">✓ Solution</p>
                      <div
                        className="prose prose-sm max-w-none text-gray-800 text-xs sm:text-sm leading-relaxed [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&_li]:my-0.5"
                        dangerouslySetInnerHTML={{ __html: formatContent(q.solution) }}
                      />
                    </div>
                  </>
                )}

                {/* Solution Button - At the End */}
                {q.solution && (
                  <div className="bg-gray-50 border-t border-gray-200 p-3 flex justify-end">
                    <button
                      onClick={() => toggleSolution(q.number)}
                      className={`px-3 py-1 rounded text-xs sm:text-sm font-semibold transition-all ${
                        visibleSolutions.has(q.number)
                          ? 'bg-white text-purple-600 hover:bg-purple-50 border border-purple-300'
                          : 'bg-purple-600 text-white hover:bg-purple-700'
                      }`}
                    >
                      {visibleSolutions.has(q.number) ? '▼ Hide Solution' : '► View Solution'}
                    </button>
                  </div>
                )}

                {/* Divider */}
                <div className="h-px bg-gradient-to-r from-purple-200 via-purple-100 to-purple-200"></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div ref={previewRef} className="bg-white rounded-lg shadow p-6">
          <div className="text-5xl mb-3 text-center">⚠️</div>
          <h3 className="text-lg font-bold text-gray-700 mb-3 text-center">No Questions Detected</h3>
          <p className="text-sm text-gray-600 text-center mb-4">
            Questions couldn't be parsed. Download the PDF to view formatted content.
          </p>
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-2">LaTeX generated:</p>
            <div className="bg-gray-50 border border-gray-300 rounded text-left overflow-hidden">
              <pre className="text-xs whitespace-pre-wrap font-mono text-gray-700 p-2 max-h-48 overflow-y-auto">{content.substring(0, 1000)}...</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
