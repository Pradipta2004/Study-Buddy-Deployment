import { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File } from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
    externalResolver: true,
  },
  maxDuration: 300,
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelay?: number; label?: string } = {}
): Promise<T> {
  const { maxRetries = 4, baseDelay = 15000, label = 'operation' } = options;
  let lastError: Error = new Error(`${label} failed`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // For rate limits, wait longer — Gemini rate limit window is ~60s
        const waitTime = baseDelay * Math.pow(1.5, attempt - 1);
        console.log(`Retry ${attempt}/${maxRetries} for ${label}, waiting ${Math.round(waitTime / 1000)}s...`);
        await delay(waitTime);
      }
      return await fn();
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || '';
      const status = error?.status || error?.httpCode || 0;

      const isRateLimit = status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('rate limit');
      const isServerError = status >= 500 || msg.includes('500') || msg.includes('overloaded') || msg.includes('UNAVAILABLE');

      if (isRateLimit) {
        console.log(`Rate limited on attempt ${attempt}/${maxRetries}, will retry after delay...`);
        if (attempt === maxRetries) {
          lastError = new Error('AI सेवा की सीमा पूरी हो गई है (Rate limit)। कृपया 1-2 मिनट बाद पुनः प्रयास करें। बड़ी PDF के लिए अधिक समय लग सकता है।');
        }
        continue;
      }
      if (isServerError) {
        console.log(`Server error on attempt ${attempt}/${maxRetries}, will retry...`);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// Hindi subject name mapping
function getHindiSubjectName(subject: string): string {
  const map: Record<string, string> = {
    'mathematics': 'गणित',
    'physics': 'भौतिक विज्ञान',
    'chemistry': 'रसायन विज्ञान',
    'biology': 'जीव विज्ञान',
    'physical-science': 'भौतिक विज्ञान',
    'life-science': 'जीव विज्ञान',
    'hindi': 'हिंदी',
    'english': 'अंग्रेज़ी',
    'history': 'इतिहास',
    'geography': 'भूगोल',
    'economics': 'अर्थशास्त्र',
    'computer-science': 'कम्प्यूटर विज्ञान',
    'environmental-science': 'पर्यावरण विज्ञान',
    'political-science': 'राजनीति विज्ञान',
    'accountancy': 'लेखाशास्त्र',
    'business-studies': 'व्यवसाय अध्ययन',
    'psychology': 'मनोविज्ञान',
    'sociology': 'समाजशास्त्र',
    'statistics': 'सांख्यिकी',
    'science': 'विज्ञान',
    'social-science': 'सामाजिक विज्ञान',
    'others': 'सामान्य',
  };
  return map[subject] || subject.replace(/-/g, ' ');
}

function getSubjectType(subject: string): 'stem' | 'humanities' | 'language' | 'commerce' {
  const stem = ['mathematics', 'physics', 'chemistry', 'biology', 'physical-science', 'life-science', 'computer-science', 'statistics', 'science', 'environmental-science'];
  const lang = ['hindi', 'english'];
  const commerce = ['accountancy', 'business-studies', 'economics'];
  if (stem.includes(subject)) return 'stem';
  if (lang.includes(subject)) return 'language';
  if (commerce.includes(subject)) return 'commerce';
  return 'humanities';
}

function getSubjectSpecificHindi(subject: string, type: string): string {
  if (subject === 'chemistry' || subject === 'physical-science') {
    return `
रसायन विज्ञान के लिए अतिरिक्त अनुभाग:
- प्रत्येक अध्याय में PDF से सभी रासायनिक समीकरण (संतुलित रूप में) अलग से सूचीबद्ध करें
- पाठ्यपुस्तक में दिए गए अभिक्रिया के प्रकार (संयोजन, वियोजन, विस्थापन, आदि) स्पष्ट करें
- समीकरण संतुलन की tricks और shortcuts (यदि PDF में दिए गए हैं)
- रंग परीक्षण (color tests) याद रखने के लिए memory aids
- IUPAC नामकरण की shortcuts
- PDF में उल्लिखित महत्वपूर्ण नियम और सिद्धांत (exact statements)
- परीक्षा में बार-बार पूछे जाने वाले समीकरणों (जो अभ्यास प्रश्नों में आते हैं) को **(परीक्षा महत्वपूर्ण)** लिखें
- अभिक्रिया की शर्तें (तापमान, दाब, उत्प्रेरक) जैसे PDF में दी गई हैं
- तुलनात्मक तालिका तभी जब textbook में दो अवधारणाओं की तुलना हो`;
  }

  if (subject === 'physics') {
    return `
भौतिक विज्ञान के लिए अतिरिक्त अनुभाग:
- प्रत्येक अध्याय से PDF के सभी सूत्र एक साथ, प्रत्येक चर का अर्थ और SI इकाई सहित
- कौन सा सूत्र कब apply करें — formula selection guide
- सामान्य sign conventions और unit conversions
- Free-body diagram बनाने के tips (यदि PDF में दिए गए हैं)
- गणना shortcuts और approximation techniques
- पाठ्यपुस्तक में दिए गए सभी नियम/सिद्धांत उनके गणितीय रूप में (exact statements)
- PDF में दिखाए गए महत्वपूर्ण आरेखों का विवरण (क्या बनाना है, क्या label करना है)
- यदि पाठ्यपुस्तक में व्युत्पत्ति (derivation) दी गई है तो उसके मुख्य चरण
- सामान्य गलतियाँ और उनसे कैसे बचें (यदि textbook में mentioned हैं)
- तुलनात्मक तालिका केवल तभी जब different methods की तुलना हो`;
  }

  if (subject === 'mathematics' || subject === 'statistics') {
    return `
गणित के लिए अतिरिक्त अनुभाग:
- अध्याय से सभी सूत्र, सर्वसमिकाएं, प्रमेय एक साथ (जैसे PDF में दिए गए हैं)
- त्रिकोणमितीय सर्वसमिकाएं, बीजगणितीय सर्वसमिकाएं सब (PDF में mention की गई)
- त्वरित गणना के लिए tricks और shortcuts (जैसे squares, cubes के pattern)
- Pattern recognition tips — किस प्रकार के प्रश्न में कौन सी विधि use करें
- Formula selection guide — कौन सा formula कब apply करें
- प्रत्येक प्रमेय की शर्तें और विशेष स्थितियां (पाठ्यपुस्तक के अनुसार)
- यदि पाठ्यपुस्तक में "common mistakes" या "note" boxes हैं तो वे include करें
- तुलनात्मक तालिका केवल तभी जब दो solution methods की तुलना हो, अन्यथा skip करें
- गणित में formulas और tricks को priority दें, न कि comparison tables को`;
  }

  if (subject === 'history' || subject === 'social-science') {
    return `
इतिहास के लिए अतिरिक्त अनुभाग:
- प्रत्येक अध्याय के लिए PDF से वर्षवार घटना तालिका (वर्ष | घटना | महत्व)
- पाठ्यपुस्तक में उल्लिखित महत्वपूर्ण व्यक्तित्व: नाम | भूमिका | योगदान
- PDF में बताई गई कारण → घटना → प्रभाव श्रृंखला
- पाठ्यपुस्तक में दी गई महत्वपूर्ण संधियाँ, अधिनियम, आंदोलन (वर्ष + मुख्य बिंदु)
- अगर timeline या chronology box है तो use करें`;
  }

  if (subject === 'biology' || subject === 'life-science') {
    return `
जीव विज्ञान के लिए अतिरिक्त अनुभाग:
- पाठ्यपुस्तक में समझाई गई जैविक प्रक्रियाओं के चरण-दर-चरण विवरण
- PDF में दिखाए गए महत्वपूर्ण आरेखों का विवरण (भाग और कार्य)
- यदि chapter में diseases/disorders दिए गए हैं: नाम | कारण | लक्षण | उपचार (तालिका में)
- पाठ्यपुस्तक में mention किए गए वैज्ञानिक नाम और वर्गीकरण`;
  }

  // default: nothing extra
  return '';
}

function buildHindiPrompt(subject: string, studentClass: string): string {
  const hindiSubject = getHindiSubjectName(subject);
  const englishSubject = subject.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const classLabel = studentClass === 'college' ? 'कॉलेज/विश्वविद्यालय' : `कक्षा ${studentClass}`;
  const classLabelEn = studentClass === 'college' ? 'College/University' : `Class ${studentClass}`;
  const type = getSubjectType(subject);
  const extra = getSubjectSpecificHindi(subject, type);

  return `You are an expert academic content creator and exam preparation specialist. Your job is to analyze this ENTIRE textbook PDF from cover to cover and create the MOST COMPREHENSIVE, DETAILED exam cheatsheet possible in HINDI (Devanagari script).

SUBJECT: ${hindiSubject} (${englishSubject})
CLASS: ${classLabel} (${classLabelEn})

══════════════════════════════════════════
MANDATORY RULES (VIOLATING ANY = FAILURE):
══════════════════════════════════════════

1. **TEXTBOOK-ONLY**: Extract content ONLY from this PDF. Do NOT add external information. Do NOT use general knowledge.
2. **USE EXACT CONTENT**: Use the textbook's exact definitions, statements, and explanations (translated to Hindi). Do NOT paraphrase unnecessarily.
3. **ALL CHAPTERS**: Cover EVERY SINGLE chapter from the PDF in textbook order — do NOT skip even one chapter.
4. **CHAPTER-WISE ORGANIZATION**: Group ALL content chapter by chapter exactly as they appear in the textbook.
5. **BE EXHAUSTIVE**: This cheatsheet should be SO comprehensive that a student reading ONLY this can revise the entire syllabus before the exam.
6. **DO NOT SUMMARIZE TOO BRIEFLY**: Each chapter section should be DETAILED — include every important point from the PDF.
7. **MINIMUM CONTENT**: Each chapter MUST have at least 15-25 bullet points across all sections. Short chapters = at least 10 points.
8. **REAL CONTENT**: Every bullet point must contain actual useful information from the PDF, not vague placeholders.
9. **ALL text content MUST be written in HINDI (Devanagari script)**. Technical terms can have English in parentheses.
10. **ALL math formulas MUST be in LaTeX math mode**: $...$ for inline, \\[ \\] for display.
11. The output MUST be a COMPLETE, COMPILABLE LaTeX document for LuaLaTeX.

══════════════════════════════════════════
🎯 GOAL: "ONE-SHOT" REVISION IN HINDI
══════════════════════════════════════════

A student should be able to:
- Read this cheatsheet in 1-2 hours and feel they've revised the ENTIRE textbook
- Find EVERY important formula/definition from the PDF in one place
- See ALL key facts, dates, events, processes from the textbook organized clearly
- Use the 5-mark notes directly in exams
- Trust that EVERYTHING in this cheatsheet comes FROM the PDF, nothing extra

══════════════════════════════════════════
⚙️ विषय-विशिष्ट आवश्यकताओं के अनुसार स्मार्ट बनें:
══════════════════════════════════════════

- **STEM विषय (गणित, भौतिकी, रसायन)**: सूत्र, tricks, shortcuts, problem-solving tips को PRIORITY दें। तुलनात्मक तालिका तभी बनाएं जब solution methods की तुलना हो।
- **गणित विशेष रूप से**: सूत्र, सर्वसमिकाएं, प्रमेय, calculation shortcuts, pattern recognition पर focus करें। तुलनात्मक तालिका यहाँ उपयोगी नहीं।
- **इतिहास/भूगोल**: timeline, तिथियां, कारण-प्रभाव chains, map points को PRIORITY दें। तुलनात्मक तालिका उपयोगी है।
- **वाणिज्य**: सूत्र और तुलनात्मक तालिका दोनों महत्वपूर्ण हैं।
- **भाषा विषय**: grammar, formats, literary devices पर focus करें। कोई सूत्र नहीं चाहिए।

══════════════════════════════════════════
CONTENT TO EXTRACT FOR EACH CHAPTER:
══════════════════════════════════════════

📌 CRITICAL: Extract content FROM THE PDF ONLY. Read each chapter carefully and include what's actually written there.

For EACH chapter, include ALL of these sections (skip ONLY if truly not applicable to the subject or not in the PDF):

** मुख्य विषय एवं अवधारणाएं (Key Topics & Concepts) **
- List EVERY important topic and concept mentioned in this chapter of the PDF
- 3-5 line explanation each in Hindi (translate from the textbook explanation)
- Explain the core idea clearly enough that a student understands it
- Include subtopics and their relationships as described in the PDF

** महत्वपूर्ण परिभाषाएं (Important Definitions) **
- EVERY important term defined in the chapter with its textbook definition (in Hindi)
- Use exact textbook wording translated to Hindi where possible
- All technical terms, scientific terms, named concepts from the PDF
- Format: \\textbf{शब्द (English Term):} परिभाषा...

** सूत्र एवं समीकरण (Formulas & Equations) ** (STEM/वाणिज्य के लिए — महत्वपूर्ण खंड)
- ALL formulas and equations mentioned in this chapter of the PDF (in proper LaTeX math mode)
- प्रत्येक सूत्र के लिए: समीकरण + प्रत्येक चर का अर्थ (हिंदी में) + इकाई
- संबंधित सूत्रों को एक साथ group करें (जैसे सभी गति के सूत्र एक साथ)
- For chemistry: ALL balanced chemical equations from the chapter with conditions (तापमान, उत्प्रेरक)
- For physics: कौन सा सूत्र कब use करें, sign conventions
- For math: त्वरित गणना के लिए tricks, shortcuts, pattern की पहचान
- सूत्र चयन गाइड — किस स्थिति में कौन सा सूत्र use करें
- यदि PDF में व्युत्पत्ति दी गई है तो मुख्य steps
- Group related formulas together as they appear in the textbook
- Mark important ones mentioned multiple times with \\textbf{(परीक्षा महत्वपूर्ण)}
- Include conditions under which each formula applies (as stated in PDF)
- Include derived forms if shown in the textbook

** याद रखने योग्य बिंदु (Key Points to Remember) **
- 10-15 must-know facts per chapter extracted from the PDF
- Important rules, principles, laws, properties as stated in the textbook
- Special cases and exceptions mentioned in the PDF
- Common exam traps mentioned in textbook exercises or notes
- Mark frequently-tested concepts from exercise questions with \\textbf{(IMP)}

** तुलनात्मक तालिका (Comparison Tables) ** (विषय-विशिष्ट)
- गणित/भौतिकी/रसायन के लिए: तुलनात्मक तालिका केवल तब जब विभिन्न विधियों/approaches की तुलना हो
- वाणिज्य/मानविकी के लिए: समान अवधारणाओं के बीच अंतर (कम से कम 4-5 पंक्तियां)
- वाणिज्य के लिए: वर्गीकरण तालिकाएं (खातों के प्रकार, कंपनियों के प्रकार आदि)
- इतिहास के लिए: वर्षवार घटना तालिका (वर्ष | घटना | महत्व)
- जीव विज्ञान के लिए: वर्गीकरण और गुण तुलना तालिकाएं
- यदि पाठ्यपुस्तक में तुलना दी गई है तो उसे शामिल करें

** त्वरित पुनरावृत्ति (Quick Revision) **
- 8-10 absolute last-minute bullets extracted from chapter summaries or key points in the PDF
- Chapter की सबसे महत्वपूर्ण बातें जो student को अवश्य पता होनी चाहिए
- STEM विषयों के लिए: गणना की tricks, shortcuts, सामान्य गलतियों से बचाव
- गणित के लिए: Pattern पहचानने की tips, कौन सा formula कब use करें
- सभी विषयों के लिए: यदि पाठ्यपुस्तक में mnemonics या याद रखने की tricks दी गई हैं तो include करें
- यदि chapter में example questions हैं तो उनसे key takeaways
- सबसे महत्वपूर्ण point को \\textbf{अति महत्वपूर्ण} से mark करें

** 5 अंक महत्वपूर्ण नोट्स (5 Marks Important Notes) **
- 2-3 exam-ready notes per chapter (80-120 words each in Hindi)
- These should be based on important topics/questions from the chapter exercises or examples in the PDF
- Format: \\textbf{विषय का नाम} \\hfill \\textit{[5 अंक]}
- Write complete answers that students can directly use in exams
- Include formulas from the PDF where relevant

${extra}

══════════════════════════════════════════
LaTeX OUTPUT FORMAT (LuaLaTeX):
══════════════════════════════════════════

Generate a COMPLETE, COMPILABLE LaTeX document using this EXACT preamble:

\\documentclass[10pt,a4paper]{article}
\\usepackage{fontspec}
\\setmainfont{Noto Sans Devanagari}[Script=Devanagari, Renderer=HarfBuzz]
\\usepackage[margin=1.5cm]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{enumitem}
\\usepackage{array}
\\usepackage{tabularx}
\\usepackage{booktabs}
\\usepackage{xcolor}
\\usepackage{titlesec}
\\usepackage{fancyhdr}

\\definecolor{chaptercolor}{RGB}{25,25,112}
\\definecolor{sectioncolor}{RGB}{0,100,0}
\\definecolor{formulacolor}{RGB}{139,0,0}
\\definecolor{tipcolor}{RGB}{184,134,11}
\\definecolor{defcolor}{RGB}{75,0,130}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\textbf{${hindiSubject} -- ${classLabel} चीटशीट}}
\\fancyhead[R]{\\textit{त्वरित पुनरावृत्ति नोट्स}}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{1pt}

\\titleformat{\\section}{\\Large\\bfseries\\color{chaptercolor}}{\\thesection}{1em}{}[\\titlerule]
\\titleformat{\\subsection}{\\large\\bfseries\\color{sectioncolor}}{\\thesubsection}{0.5em}{}

\\begin{document}

\\begin{center}
{\\Huge\\bfseries\\color{chaptercolor} ${hindiSubject} चीटशीट}\\\\[6pt]
{\\Large ${classLabel} -- त्वरित पुनरावृत्ति नोट्स}\\\\[4pt]
{\\small परीक्षा की तैयारी के लिए संपूर्ण अध्यायवार सारांश}\\\\[2pt]
\\rule{\\textwidth}{1.5pt}
\\end{center}

\\vspace{0.5cm}

% FOR EACH CHAPTER:
\\section{अध्याय का नाम}

\\subsection*{\\color{sectioncolor} मुख्य विषय एवं अवधारणाएं}
\\begin{itemize}[leftmargin=1.5em, itemsep=2pt]
  \\item ...
\\end{itemize}

\\subsection*{\\color{defcolor} महत्वपूर्ण परिभाषाएं}
\\begin{itemize}[leftmargin=1.5em, itemsep=2pt]
  \\item \\textbf{शब्द:} परिभाषा...
\\end{itemize}

\\subsection*{\\color{formulacolor} सूत्र एवं समीकरण}
% Use $...$ for inline math and \\[ \\] for display math

\\subsection*{\\color{tipcolor} याद रखने योग्य बिंदु}
\\begin{enumerate}[leftmargin=1.5em, itemsep=2pt]
  \\item ...
\\end{enumerate}

\\subsection*{तुलनात्मक तालिका}
\\begin{tabularx}{\\textwidth}{|l|X|X|}
\\hline
\\textbf{पहलू} & \\textbf{अवधारणा A} & \\textbf{अवधारणा B} \\\\
\\hline
... \\\\
\\hline
\\end{tabularx}

\\subsection*{\\color{sectioncolor} त्वरित पुनरावृत्ति}
\\begin{enumerate}[leftmargin=1.5em, itemsep=1pt]
  \\item ...
\\end{enumerate}

\\subsection*{\\color{formulacolor} 5 अंक महत्वपूर्ण नोट्स}
\\noindent\\textbf{1. विषय का नाम} \\hfill \\textit{\\small [5 अंक]} \\\\
80-120 शब्दों में परीक्षा-तैयार उत्तर...

\\noindent\\rule{\\textwidth}{0.2pt}

% Repeat for ALL chapters with \\newpage between chapters

\\end{document}

══════════════════════════════════════════
FORMATTING RULES:
══════════════════════════════════════════

1. Use \\section{} for chapter names (numbered)
2. Use \\subsection*{} for section headings within chapters (unnumbered)
3. ALL math MUST be in LaTeX math mode ($...$ inline, \\[ \\] display)
4. Use \\textbf{} for important terms being defined
5. Tables must use tabularx with \\hline borders
6. Use enumerate for numbered lists, itemize for bullet points
7. Do NOT use any Unicode emoji — use text labels like (परीक्षा महत्वपूर्ण), (IMP)
8. Ensure EVERY \\begin{} has a matching \\end{}
9. Ensure EVERY { has a matching }
10. Use \\newpage between chapters
11. English text mixed with Hindi is fine — Noto Sans Devanagari font supports BOTH Latin and Devanagari characters with proper conjuncts
12. Do NOT use \\textenglish{}, \\texthindi{}, or any polyglossia commands
13. For chemical equations, use LaTeX math: $\\text{reactant} \\rightarrow \\text{product}$
14. Do NOT use \\ce{} command (mhchem package is NOT loaded)
15. Do NOT use tcolorbox, multicol, polyglossia, or any packages NOT in the preamble
16. Make the document LONG and DETAILED — 40-80 pages when compiled
17. LENGTH GUIDELINE: The output should be 40-80 pages when compiled. Do NOT shorten it. Include EVERYTHING important from the PDF.

══════════════════════════════════════════
⚠️ CRITICAL REMINDERS:
══════════════════════════════════════════

1. **EXTRACT, DON'T GENERATE**: Your job is to EXTRACT content from this PDF and present it in an organized way. Do NOT add information from your general knowledge.
2. **VERIFY AGAINST PDF**: Every definition, formula, fact, date, or concept you include MUST be present in the uploaded PDF.
3. **COMPLETE COVERAGE**: Go through the PDF systematically, chapter by chapter. Do NOT skip chapters.
4. **USE TEXTBOOK LANGUAGE**: Translate the textbook's exact explanations to Hindi. Do NOT write in your own words unless necessary.
5. **NO HALLUCINATIONS**: If a formula or fact is not in the PDF, do NOT include it.

IMPORTANT: Start directly with \\documentclass and end with \\end{document}.
Do NOT wrap output in markdown code blocks.
Write ALL content in Hindi (Devanagari). Only formulas stay in LaTeX math.

Now analyze the PDF carefully and create a comprehensive Hindi cheatsheet that follows ALL the rules above.`;
}

function wrapInLatexDocument(content: string, subject: string, studentClass: string): string {
  const hindiSubject = getHindiSubjectName(subject);
  const classLabel = studentClass === 'college' ? 'कॉलेज/विश्वविद्यालय' : `कक्षा ${studentClass}`;

  return `\\documentclass[10pt,a4paper]{article}
\\usepackage{fontspec}
\\setmainfont{Noto Sans Devanagari}[Script=Devanagari, Renderer=HarfBuzz]
\\usepackage[margin=1.5cm]{geometry}
\\usepackage{amsmath,amssymb}
\\usepackage{enumitem}
\\usepackage{array}
\\usepackage{tabularx}
\\usepackage{booktabs}
\\usepackage{xcolor}
\\usepackage{titlesec}
\\usepackage{fancyhdr}

\\definecolor{chaptercolor}{RGB}{25,25,112}
\\definecolor{sectioncolor}{RGB}{0,100,0}
\\definecolor{formulacolor}{RGB}{139,0,0}
\\definecolor{tipcolor}{RGB}{184,134,11}
\\definecolor{defcolor}{RGB}{75,0,130}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\textbf{${hindiSubject} -- ${classLabel} चीटशीट}}
\\fancyhead[R]{\\textit{त्वरित पुनरावृत्ति नोट्स}}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{1pt}

\\titleformat{\\section}{\\Large\\bfseries\\color{chaptercolor}}{\\thesection}{1em}{}[\\titlerule]
\\titleformat{\\subsection}{\\large\\bfseries\\color{sectioncolor}}{\\thesubsection}{0.5em}{}

\\begin{document}

\\begin{center}
{\\Huge\\bfseries\\color{chaptercolor} ${hindiSubject} चीटशीट}\\\\[6pt]
{\\Large ${classLabel} -- त्वरित पुनरावृत्ति नोट्स}\\\\[4pt]
{\\small परीक्षा की तैयारी के लिए संपूर्ण अध्यायवार सारांश}\\\\[2pt]
\\rule{\\textwidth}{1.5pt}
\\end{center}

\\vspace{0.5cm}

${content}

\\end{document}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured' });
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    const uploadDir = path.join(os.tmpdir(), 'hindi-cheatsheet-uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = formidable({
      maxFileSize: 64 * 1024 * 1024,
      maxTotalFileSize: 128 * 1024 * 1024,
      uploadDir,
      keepExtensions: true,
    });

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve([fields, files]);
        });
      }
    );

    const subject = (Array.isArray(fields.subject) ? fields.subject[0] : fields.subject) || 'science';
    const studentClass = (Array.isArray(fields.studentClass) ? fields.studentClass[0] : fields.studentClass) || '10';

    const fileField = files.file;
    const pdfFile: File | undefined = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!pdfFile) {
      return res.status(400).json({ error: 'कोई PDF फ़ाइल अपलोड नहीं हुई' });
    }

    const filePath = pdfFile.filepath;
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const fileSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);

    console.log(`Hindi Cheatsheet: Processing PDF (${fileSizeMB} MB) for ${subject} class ${studentClass}`);

    const prompt = buildHindiPrompt(subject, studentClass);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        maxOutputTokens: 65536,
        temperature: 0.3,
      },
    });

    // Scale retry delays based on file size — larger PDFs need more time between retries
    const fileSizeMBNum = parseFloat(fileSizeMB);
    const retryConfig = fileSizeMBNum > 5
      ? { maxRetries: 5, baseDelay: 20000, label: 'hindi-cheatsheet-generation (large PDF)' }
      : fileSizeMBNum > 2
      ? { maxRetries: 4, baseDelay: 15000, label: 'hindi-cheatsheet-generation (medium PDF)' }
      : { maxRetries: 3, baseDelay: 10000, label: 'hindi-cheatsheet-generation' };

    console.log(`Using retry config: ${retryConfig.maxRetries} retries, ${retryConfig.baseDelay}ms base delay for ${fileSizeMB}MB PDF`);

    const result = await withRetry(
      async () => {
        const response = await model.generateContent([
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBase64,
            },
          },
          { text: prompt },
        ]);
        return response;
      },
      retryConfig
    );

    const responseText = result.response.text();
    const tokenUsage = {
      promptTokens: result.response.usageMetadata?.promptTokenCount || 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: result.response.usageMetadata?.totalTokenCount || 0,
    };

    console.log(`Hindi Cheatsheet generated. Length: ${responseText.length}. Tokens: ${tokenUsage.totalTokens}`);

    // Extract LaTeX content
    let latex = responseText;

    // If the response is wrapped in markdown code blocks, extract it
    const codeBlockMatch = latex.match(/```(?:latex|tex)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      latex = codeBlockMatch[1].trim();
    }

    // Ensure it's a valid LaTeX document
    if (!latex.includes('\\documentclass')) {
      latex = wrapInLatexDocument(latex, subject, studentClass);
    }

    // Ensure document ends properly
    if (latex.includes('\\begin{document}') && !latex.includes('\\end{document}')) {
      latex += '\n\\end{document}\n';
    }

    // Clean up temp file
    try { fs.unlinkSync(filePath); } catch {}

    return res.status(200).json({ latex, tokenUsage });
  } catch (error: any) {
    console.error('Hindi cheatsheet generation error:', error);
    const msg = error?.message || '';
    const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');
    const statusCode = isRateLimit ? 429 : 500;
    const userMessage = isRateLimit
      ? 'AI सेवा की सीमा पूरी हो गई है। कृपया 1-2 मिनट बाद पुनः प्रयास करें। बड़ी PDF के लिए अधिक समय लग सकता है।'
      : (msg || 'चीटशीट बनाने में समस्या हुई');
    return res.status(statusCode).json({
      error: userMessage,
      isRateLimit,
    });
  }
}
