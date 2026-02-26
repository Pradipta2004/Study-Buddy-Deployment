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
  const { maxRetries = 2, baseDelay = 3000, label = 'operation' } = options;
  let lastError: Error = new Error(`${label} failed`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const waitTime = baseDelay * Math.pow(2, attempt - 1);
        console.log(`Retry ${attempt}/${maxRetries} for ${label}, waiting ${waitTime}ms...`);
        await delay(waitTime);
      }
      return await fn();
    } catch (error: any) {
      lastError = error;
      const msg = error?.message || '';
      const status = error?.status || error?.httpCode || 0;

      if (status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
        console.log(`Rate limited on attempt ${attempt}, will retry...`);
        continue;
      }
      if (status >= 500 || msg.includes('500') || msg.includes('overloaded') || msg.includes('UNAVAILABLE')) {
        console.log(`Server error on attempt ${attempt}, will retry...`);
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
- प्रत्येक अध्याय में सभी रासायनिक समीकरण (संतुलित रूप में) अलग से सूचीबद्ध करें
- अभिक्रिया के प्रकार (संयोजन, वियोजन, विस्थापन, आदि) स्पष्ट करें
- महत्वपूर्ण नियम और सिद्धांत
- परीक्षा में बार-बार पूछे जाने वाले समीकरणों को **(परीक्षा महत्वपूर्ण)** लिखें`;
  }

  if (subject === 'physics') {
    return `
भौतिक विज्ञान के लिए अतिरिक्त अनुभाग:
- प्रत्येक अध्याय के सभी सूत्र एक साथ, प्रत्येक चर का अर्थ और SI इकाई सहित
- सभी नियम/सिद्धांत उनके गणितीय रूप में
- महत्वपूर्ण आरेखों का विवरण (क्या बनाना है, क्या label करना है)`;
  }

  if (subject === 'mathematics' || subject === 'statistics') {
    return `
गणित के लिए अतिरिक्त अनुभाग:
- सभी सूत्र, सर्वसमिकाएं, प्रमेय एक साथ
- त्रिकोणमितीय सर्वसमिकाएं, बीजगणितीय सर्वसमिकाएं सब
- प्रत्येक प्रमेय की शर्तें और विशेष स्थितियां
- सामान्य गलतियाँ जो छात्र करते हैं`;
  }

  if (subject === 'history' || subject === 'social-science') {
    return `
इतिहास के लिए अतिरिक्त अनुभाग:
- प्रत्येक अध्याय के लिए वर्षवार घटना तालिका (वर्ष | घटना | महत्व)
- महत्वपूर्ण व्यक्तित्व: नाम | भूमिका | योगदान
- कारण → घटना → प्रभाव श्रृंखला
- महत्वपूर्ण संधियाँ, अधिनियम, आंदोलन (वर्ष + मुख्य बिंदु)`;
  }

  if (subject === 'biology' || subject === 'life-science') {
    return `
जीव विज्ञान के लिए अतिरिक्त अनुभाग:
- जैविक प्रक्रियाओं के चरण-दर-चरण विवरण
- महत्वपूर्ण आरेखों का विवरण (भाग और कार्य)
- रोग/विकार: नाम | कारण | लक्षण | उपचार (तालिका में)
- वैज्ञानिक नाम और वर्गीकरण`;
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

  return `You are an expert academic content creator. Analyze this ENTIRE textbook PDF and create a COMPREHENSIVE cheatsheet in HINDI (Devanagari script).

SUBJECT: ${hindiSubject} (${englishSubject})
CLASS: ${classLabel} (${classLabelEn})

══════════════════════════════════════════
MANDATORY RULES:
══════════════════════════════════════════

1. ALL text content MUST be written in HINDI (Devanagari script). Technical terms can have English in parentheses.
2. Cover EVERY SINGLE chapter from the PDF — do NOT skip any.
3. Each chapter MUST have at least 15-25 bullet points across all sections.
4. Extract content ONLY from this PDF — do NOT add external information.
5. ALL math formulas MUST be in LaTeX math mode: $...$ for inline, \\[ \\] for display.
6. The output MUST be a COMPLETE, COMPILABLE LaTeX document for LuaLaTeX.

══════════════════════════════════════════
GOAL: One-shot revision in Hindi
══════════════════════════════════════════

A student should be able to:
- Revise the ENTIRE textbook by reading this cheatsheet (1--2 hours)
- Find EVERY important formula/definition in one place
- Use the 5-mark notes directly in exams

══════════════════════════════════════════
CONTENT STRUCTURE FOR EACH CHAPTER:
══════════════════════════════════════════

For EACH chapter include ALL of these:

** मुख्य विषय एवं अवधारणाएं (Key Topics & Concepts) **
- Every important topic with 3-4 line explanation in Hindi
- Subtopics and their relationships

** महत्वपूर्ण परिभाषाएं (Important Definitions) **
- Every term: \\textbf{शब्द (English Term):} परिभाषा...
- All technical terms, scientific terms

** सूत्र एवं समीकरण (Formulas & Equations) ** (for STEM/Commerce)
- ALL formulas in proper LaTeX math mode
- For each formula: equation + meaning of each variable + unit
- Mark important ones with \\textbf{(परीक्षा महत्वपूर्ण)}

** याद रखने योग्य बिंदु (Key Points to Remember) **
- 10-15 must-know facts per chapter
- Rules, principles, exceptions
- Common exam traps

** तुलनात्मक तालिका (Comparison Tables) ** (where applicable)
- Use tabularx with at least 4-5 rows
- All table content in Hindi

** त्वरित पुनरावृत्ति (Quick Revision) **
- 8-10 last-minute bullets
- Mnemonics or memory tricks

** 5 अंक महत्वपूर्ण नोट्स (5 Marks Important Notes) **
- 2-3 exam-ready notes per chapter (80-120 words each in Hindi)
- Format: \\textbf{विषय का नाम} \\hfill \\textit{[5 अंक]}
- Include formulas where relevant

${extra}

══════════════════════════════════════════
LaTeX OUTPUT FORMAT (LuaLaTeX):
══════════════════════════════════════════

Generate a COMPLETE, COMPILABLE LaTeX document using this EXACT preamble:

\\documentclass[10pt,a4paper]{article}
\\usepackage{fontspec}
\\usepackage{polyglossia}
\\setdefaultlanguage{hindi}
\\setotherlanguage{english}
\\newfontfamily\\hindifont{Noto Sans Devanagari}[Script=Devanagari]
\\newfontfamily\\englishfont{Latin Modern Roman}
\\setmainfont{Noto Sans Devanagari}[Script=Devanagari]
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
11. For English text within Hindi content, you can use it directly — polyglossia handles it
12. For chemical equations, use LaTeX math: $\\text{reactant} \\rightarrow \\text{product}$
13. Do NOT use \\ce{} command (mhchem package is NOT loaded)
14. Do NOT use tcolorbox, multicol, or any packages NOT in the preamble
15. Make the document LONG and DETAILED — 40-80 pages when compiled

IMPORTANT: Start directly with \\documentclass and end with \\end{document}.
Do NOT wrap output in markdown code blocks.
Write ALL content in Hindi (Devanagari). Only formulas stay in LaTeX math.`;
}

function wrapInLatexDocument(content: string, subject: string, studentClass: string): string {
  const hindiSubject = getHindiSubjectName(subject);
  const classLabel = studentClass === 'college' ? 'कॉलेज/विश्वविद्यालय' : `कक्षा ${studentClass}`;

  return `\\documentclass[10pt,a4paper]{article}
\\usepackage{fontspec}
\\usepackage{polyglossia}
\\setdefaultlanguage{hindi}
\\setotherlanguage{english}
\\newfontfamily\\hindifont{Noto Sans Devanagari}[Script=Devanagari]
\\newfontfamily\\englishfont{Latin Modern Roman}
\\setmainfont{Noto Sans Devanagari}[Script=Devanagari]
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
      { maxRetries: 2, baseDelay: 3000, label: 'hindi-cheatsheet-generation' }
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
    return res.status(500).json({
      error: error.message || 'चीटशीट बनाने में समस्या हुई',
    });
  }
}
