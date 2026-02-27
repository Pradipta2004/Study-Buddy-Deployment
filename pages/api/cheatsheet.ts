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
    // Parse form data
    const uploadDir = path.join(os.tmpdir(), 'cheatsheet-uploads');
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

    const subject = (Array.isArray(fields.subject) ? fields.subject[0] : fields.subject) || 'general';
    const studentClass = (Array.isArray(fields.studentClass) ? fields.studentClass[0] : fields.studentClass) || '10';

    // Get the uploaded PDF
    const fileField = files.file;
    const pdfFile: File | undefined = Array.isArray(fileField) ? fileField[0] : fileField;

    if (!pdfFile) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const filePath = pdfFile.filepath;
    const pdfBuffer = fs.readFileSync(filePath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const fileSizeMB = (pdfBuffer.length / (1024 * 1024)).toFixed(2);

    console.log(`Cheatsheet: Processing PDF (${fileSizeMB} MB) for ${subject} class ${studentClass}`);

    // Determine subject-specific instructions
    const subjectType = getSubjectType(subject);
    const subjectSpecificInstructions = getSubjectSpecificPrompt(subject, subjectType);

    // Build the Gemini prompt
    const cheatsheetPrompt = buildCheatsheetPrompt(subject, studentClass, subjectType, subjectSpecificInstructions);

    // Call Gemini with the PDF — use high output tokens for comprehensive cheatsheet
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
          { text: cheatsheetPrompt },
        ]);
        return response;
      },
      { maxRetries: 2, baseDelay: 3000, label: 'cheatsheet-generation' }
    );

    const responseText = result.response.text();
    const tokenUsage = {
      promptTokens: result.response.usageMetadata?.promptTokenCount || 0,
      outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: result.response.usageMetadata?.totalTokenCount || 0,
    };

    console.log(`Cheatsheet generated. Response length: ${responseText.length}. Tokens: ${tokenUsage.totalTokens}`);

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
    try {
      fs.unlinkSync(filePath);
    } catch {}

    return res.status(200).json({
      latex,
      tokenUsage,
    });
  } catch (error: any) {
    console.error('Cheatsheet generation error:', error);
    return res.status(500).json({
      error: error.message || 'Failed to generate cheatsheet',
    });
  }
}

function getSubjectType(subject: string): 'stem' | 'humanities' | 'language' | 'commerce' {
  const stemSubjects = [
    'mathematics', 'physics', 'chemistry', 'biology',
    'physical-science', 'life-science', 'computer-science',
    'engineering', 'medical-science', 'statistics',
    'environmental-science',
  ];
  const languageSubjects = ['english'];
  const commerceSubjects = ['accountancy', 'business-studies', 'commerce', 'economics'];
  
  if (stemSubjects.includes(subject)) return 'stem';
  if (languageSubjects.includes(subject)) return 'language';
  if (commerceSubjects.includes(subject)) return 'commerce';
  return 'humanities';
}

function getSubjectSpecificPrompt(subject: string, type: 'stem' | 'humanities' | 'language' | 'commerce'): string {
  // Subject-specific extra sections based on exact subject
  let extraSections = '';

  if (subject === 'chemistry' || subject === 'physical-science') {
    extraSections = `
══ CHEMISTRY / PHYSICAL SCIENCE — EXTRA MANDATORY SECTIONS ══

For EACH chapter, you MUST also include:

** ONE-SHOT EQUATION BANK **
- Create a dedicated "Important Chemical Equations" subsection
- List ALL important chemical reactions from the chapter in balanced form
- Group reactions by type: combination, decomposition, displacement, redox, acid-base, precipitation, etc.
- For each reaction include: balanced equation + type of reaction + one-line significance
- Use \\[ \\ce{...} \\] style or plain LaTeX math for equations
- Mark frequently-asked-in-exams reactions with \\textbf{(FAQ)}
- Include conditions above/below the arrow (catalyst, temperature, pressure)

** BALANCING TRICKS & SHORTCUTS **
- Equation balancing shortcuts
- IUPAC naming quick rules
- Color test memory aids (e.g., "Brown ring test for nitrate")
- pH calculation shortcuts
- Valency tricks

** PERIODIC TABLE TRENDS ** (if applicable to chapter)
- Trends in properties across periods and down groups
- Key values (electronegativity, ionization energy, electron affinity)

** NAMED REACTIONS & LAWS **
- Every named reaction/law mentioned in the chapter with statement + equation
`;
  }

  if (subject === 'physics') {
    extraSections = `
══ PHYSICS — EXTRA MANDATORY SECTIONS ══

For EACH chapter, you MUST also include:

** ONE-SHOT FORMULA SHEET **
- Create a dedicated "All Formulas" subsection listing EVERY formula
- Group by subtopic within the chapter
- For each formula: equation + what each symbol means + SI unit
- Mark board-exam-important formulas with \\textbf{(IMP)}
- Include derived formulas and alternate forms
- **WHEN TO USE WHICH FORMULA** — selection guide for problem-solving

** PROBLEM-SOLVING TIPS **
- Sign conventions for the chapter
- Common mistakes and how to avoid them
- Quick approximation methods
- Free-body diagram tips (if applicable)
- Unit conversion shortcuts

** LAWS & PRINCIPLES **
- Statement of every law/principle in the chapter (word-for-word from textbook)
- Mathematical form of each law
- Conditions/limitations of each law

** KEY DIAGRAMS **
- Describe important diagrams (circuit diagrams, ray diagrams, force diagrams) in words
- List what to label in each diagram
- Common diagram mistakes in exams
`;
  }

  if (subject === 'mathematics' || subject === 'statistics') {
    extraSections = `
══ MATHEMATICS — EXTRA MANDATORY SECTIONS ══

For EACH chapter, you MUST also include:

** COMPLETE FORMULA BANK **
- List EVERY formula, identity, and theorem from the chapter
- Group formulas by subtopic
- Include ALL trigonometric identities, algebraic identities, coordinate geometry formulas, etc.
- Provide conditions/domain restrictions for each formula
- Mark frequently used formulas with \\textbf{(IMP)}

** CALCULATION TRICKS & SHORTCUTS **
- Quick calculation methods (mental math tricks, pattern shortcuts)
- Formula selection guide — which formula to use when
- Pattern recognition tips for typical question types
- Memory aids for complex formulas
- Step-saving techniques

** THEOREM STATEMENTS **
- State every theorem with proper mathematical notation
- Include corollaries and special cases
- Conditions under which theorem applies

** COMMON MISTAKES TO AVOID **
- List 3-5 common calculation errors for the chapter
- Sign errors, domain errors, unit errors
- Typical conceptual misunderstandings
- "Watch out for" points in exam questions
`;
  }

  if (subject === 'history') {
    extraSections = `
══ HISTORY — EXTRA MANDATORY SECTIONS ══

For EACH chapter, you MUST also include:

** YEAR-WISE EVENT TIMELINE **
- Create a comprehensive table: Year | Event | Significance (1-line)
- List ALL important dates/years mentioned in the chapter
- Sort chronologically
- Use a tabularx table for clean formatting
- Mark board-exam-important events with \\textbf{(IMP)}

** KEY PERSONALITIES **
- Name | Role/Title | Key Contribution (1-2 lines)
- Use tabular format

** CAUSE → EVENT → EFFECT CHAINS **
- For major events: What caused it → What happened → What was the result
- Use numbered lists or flow description

** IMPORTANT TREATIES/ACTS/MOVEMENTS **
- Name | Year | Key provisions/outcomes
- Use tabular format

** MAP WORK POINTS ** (if applicable)
- List places/locations that are important for map-based questions
`;
  }

  if (subject === 'geography') {
    extraSections = `
══ GEOGRAPHY — EXTRA MANDATORY SECTIONS ══

For EACH chapter, you MUST also include:

** LOCATION & MAP FACTS **
- Important places, rivers, mountains, boundaries mentioned
- Latitude/longitude references if given

** DATA & STATISTICS **
- Important numerical data (population, area, production figures)
- Rankings and comparisons between regions/countries

** CLASSIFICATION TABLES **
- Types of soils, rocks, climate zones, vegetation, etc.
- Features and distribution of each type
`;
  }

  if (subject === 'biology' || subject === 'life-science') {
    extraSections = `
══ BIOLOGY / LIFE SCIENCE — EXTRA MANDATORY SECTIONS ══

For EACH chapter, you MUST also include:

** PROCESSES & MECHANISMS **
- Step-by-step description of biological processes (photosynthesis, respiration, cell division, etc.)
- Include substrates, products, enzymes, and conditions

** DIAGRAM DESCRIPTIONS **
- Describe every important diagram: what to draw, what to label
- Include parts and their functions

** DISEASES/DISORDERS ** (if applicable)
- Name | Cause | Symptoms | Prevention/Cure in tabular format

** SCIENTIFIC NAMES & CLASSIFICATION **
- Important organisms with their scientific names
- Classification hierarchy where mentioned
`;
  }

  if (subject === 'computer-science' || subject === 'engineering') {
    extraSections = `
══ COMPUTER SCIENCE / ENGINEERING — EXTRA MANDATORY SECTIONS ══

For EACH chapter, you MUST also include:

** ALGORITHMS & PSEUDOCODE **
- Key algorithms in step-by-step format
- Time and space complexity where applicable

** SYNTAX REFERENCE **
- Important programming constructs/commands
- Common code patterns

** COMPARISON TABLES **
- Differences between similar concepts (e.g., compiler vs interpreter, stack vs queue)
`;
  }

  switch (type) {
    case 'stem':
      return `
STEM-SPECIFIC REQUIREMENTS:
- **FORMULAS ARE PRIORITY**: Extract ALL formulas, equations, and mathematical expressions (use proper LaTeX math mode: $...$ for inline, \\[ \\] for display)
- Include derivation steps for key formulas (brief outline, not full derivation)
- List ALL important constants and their standard values with units
- **TRICKS & SHORTCUTS**: Include calculation shortcuts, approximation techniques, quick-check methods
- **PROBLEM-SOLVING TIPS**: Common mistakes, sign conventions, unit conversions
- For Math: Include pattern recognition tips, formula selection guidelines, typical question types
- For Physics: When to apply which law/formula, free-body diagram tips
- For Chemistry: Balancing tricks, IUPAC naming shortcuts, color-test memory aids
- Include units, dimensions, and SI notation where applicable
- Describe important diagrams (what the diagram shows, key labels)
- Include ALL important reactions/processes/algorithms
- For numerical subjects: include 2-3 quick worked examples per chapter showing formula application
- Highlight frequently-asked formulas with \\textbf{(FAQ)} or \\textbf{(IMP)}
- Group related formulas together so students see connections
- Include special cases and boundary conditions for formulas
- **SKIP comparison tables** unless comparing different derivation methods or solution approaches
- 5 MARKS NOTES: For each chapter write 2-4 exam-ready notes on derivations, explain-with-example type topics, prove-that problems, or "write the principle and applications" style answers
${extraSections}`;
    case 'language':
      return `
LANGUAGE-SPECIFIC REQUIREMENTS:
- Extract important literary terms and their definitions
- List key themes, motifs, and symbols from each chapter/text
- Include important quotations with context and who said them
- Grammar rules, tenses, voice, narration with examples
- Writing formats (letters, essays, reports, notices) with structure outlines and sample openings
- Vocabulary lists with meanings and usage
- Author/poet biographical info relevant to the syllabus
- Figure of speech examples extracted from the text
- Character sketches with key traits
- Chapter-wise summary in 5-8 lines
- 5 MARKS NOTES: For each chapter write 2-4 exam-ready notes on character analysis, theme discussion, summary explanations, context-of-the-quote answers, or "discuss the significance" type answers
${extraSections}`;
    case 'commerce':
      return `
COMMERCE-SPECIFIC REQUIREMENTS:
- Extract ALL important formulas (ratios, accounting equations, interest, depreciation, etc.) in proper LaTeX math
- Include journal entry formats, rules, and golden rules of accounting
- List ALL important definitions and legal provisions with section numbers
- Include classification tables (types of accounts, types of companies, etc.)
- Key differences/comparisons in tabular format (at least 5 points each)
- Important sections/acts/laws with brief one-line descriptions
- Include commonly confused terms with clear distinctions
- Format-wise examples for balance sheet, P&L, cash flow statement
- Important numerical formulas with worked mini-examples
- 5 MARKS NOTES: For each chapter write 2-4 exam-ready notes on "explain with journal entry", "differentiate between X and Y", "describe the process of", or "advantages and limitations" type answers
${extraSections}`;
    case 'humanities':
      return `
HUMANITIES-SPECIFIC REQUIREMENTS:
- Extract ALL important dates, events, and their significance
- Create year-wise chronological timeline tables per chapter
- List key personalities with their roles and contributions in tabular format
- Include cause-and-effect chains for major events
- Map references and geographical features (for geography)
- Constitutional articles/amendments with brief descriptions (for political science)
- Important theories and their proponents with one-line explanation
- Key differences/comparisons in tabular format (at least 5 points each)
- Important treaties, acts, movements with year + key provisions
- Movements: leaders + demands + outcomes
- 5 MARKS NOTES: For each chapter write 2-4 exam-ready notes on "describe the causes and effects of", "role of X in Y", "explain the significance of", year-wise event narrations, or "discuss the reforms/acts" type answers
${extraSections}`;
  }
}

function buildCheatsheetPrompt(
  subject: string,
  studentClass: string,
  subjectType: string,
  subjectSpecificInstructions: string
): string {
  const subjectLabel = subject.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const classLabel = studentClass === 'college' ? 'College/University' : `Class ${studentClass}`;

  return `You are an expert academic content creator and exam preparation specialist. Your job is to analyze this ENTIRE textbook PDF from cover to cover and create the MOST COMPREHENSIVE, DETAILED exam cheatsheet possible.

SUBJECT: ${subjectLabel}
CLASS: ${classLabel}

═══════════════════════════════════════════════════
MANDATORY RULES (VIOLATING ANY = FAILURE):
═══════════════════════════════════════════════════

1. TEXTBOOK-ONLY: Extract content ONLY from this PDF. Do NOT add external information.
2. ALL CHAPTERS: Cover EVERY SINGLE chapter. Do NOT skip even one chapter.
3. CHAPTER-WISE: Group ALL content chapter by chapter in textbook order.
4. BE EXHAUSTIVE: This cheatsheet should be SO comprehensive that a student reading ONLY this cheatsheet can revise the entire syllabus before the exam.
5. DO NOT SUMMARIZE TOO BRIEFLY: Each chapter section should be DETAILED — include every important point. A student should be able to read this and feel they"ve revised the whole chapter.
6. MINIMUM LENGTH: Each chapter MUST have at least 15-25 bullet points across all sections. Short chapters = at least 10 points.
7. REAL CONTENT: Every bullet point must contain actual useful information, not vague placeholders.

═══════════════════════════════════════════════════
🎯 THE GOAL: "ONE-SHOT" REVISION
═══════════════════════════════════════════════════

A student should be able to:
- Read this cheatsheet in 1-2 hours and feel they"ve revised the ENTIRE textbook
- Find EVERY important formula/equation/definition in one place
- See ALL key facts, dates, events, processes organized clearly
- Use this as their ONLY revision material the night before the exam

═══════════════════════════════════════════════════
⚙️ BE SMART ABOUT SUBJECT-SPECIFIC NEEDS:
═══════════════════════════════════════════════════

- **STEM subjects (Math, Physics, Chemistry)**: PRIORITIZE formulas, tricks, shortcuts, problem-solving tips. SKIP comparison tables unless comparing solution methods.
- **Math specifically**: Focus on formulas, identities, theorems, calculation shortcuts, pattern recognition. Comparison tables are NOT useful here.
- **History/Geography**: PRIORITIZE timelines, dates, cause-effect chains, map points. Comparison tables ARE useful.
- **Commerce**: Both formulas AND comparison tables are important.
- **Languages**: Focus on grammar, formats, literary devices. NO formulas needed.

═══════════════════════════════════════════════════
CONTENT TO EXTRACT FOR EACH CHAPTER:
═══════════════════════════════════════════════════

For EACH chapter, include ALL of these sections (skip ONLY if truly not applicable to the subject):

** KEY TOPICS & CONCEPTS **
- List EVERY important topic and concept (3-5 line explanation each — not just names)
- Explain the core idea of each topic clearly enough that a student understands it
- Include subtopics and their relationships

** IMPORTANT DEFINITIONS **
- EVERY important term with its textbook definition
- Technical terms, scientific terms, named concepts — ALL of them
- Use exact textbook wording where possible
- Format: \\textbf{Term}: Definition

** FORMULAS, EQUATIONS & EXPRESSIONS ** (for STEM/Commerce — CRITICAL SECTION)
- List EVERY formula in the chapter — do NOT skip any
- For each formula: the equation + what each variable means + units
- Group related formulas together (e.g., all kinematics formulas together)
- Include derived forms and rearranged versions
- Include conditions under which each formula applies
- For Math: Include tricks for quick calculations, pattern shortcuts
- For Physics: When to use which formula, common sign conventions
- For Chemistry: ALL balanced chemical equations with conditions (temperature, catalyst)
- For Math: ALL theorems, identities, properties with conditions
- Include "formula selection guide" — which formula to use when

** KEY FACTS & POINTS TO REMEMBER **
- 10-15 must-know facts per chapter
- Important rules, principles, laws, properties
- Common exam traps and how to avoid them
- Frequently tested concepts marked with \\textbf{(IMP)}
- Exceptions to rules
- Special cases and boundary conditions

** IMPORTANT TABLES & COMPARISONS ** (subject-specific)
- For STEM: Skip comparison tables unless comparing different methods/approaches
- For Commerce/Humanities: Differences between similar concepts (minimum 4-5 rows per table)
- For Commerce: Classification tables with all categories (types of accounts, companies, etc.)
- For History: Timeline tables (Year | Event | Significance)
- For Biology: Classification and property comparison tables

** QUICK REVISION BULLETS **
- 8-12 bullet points per chapter for ABSOLUTE last-minute revision
- The "if you read ONLY this section" emergency notes
- For STEM: Include calculation tricks, shortcuts, common mistakes to avoid
- For Math: Pattern recognition tips, formula selection guidelines
- For all subjects: Include mnemonics or memory tricks from the textbook
- Mark the single most important point with \\textbf{MOST IMPORTANT}

** 5 MARKS IMPORTANT NOTES ** (CRITICAL SECTION)
- For EACH chapter, write 2-4 ready-made short notes that are commonly asked as 5-mark questions in exams
- Each note should be 80-120 words — the IDEAL length for a 5-mark answer
- Cover the most frequently examined topics from each chapter
- Structure each note with: Topic title + clear explanation + key points/steps + conclusion line
- For STEM subjects: include relevant formulas/equations within the note
- For History: cover important events, movements, reforms, acts with causes + effects
- For Geography: cover important processes, formations, distributions with reasons
- For Commerce: cover important concepts, principles, provisions with examples
- These should be EXAM-READY — a student can memorize and write them directly as answers
- Mark the most frequently asked one with \\textbf{(MOST ASKED)}

${subjectSpecificInstructions}

═══════════════════════════════════════════════════
LATEX OUTPUT FORMAT:
═══════════════════════════════════════════════════

Generate a COMPLETE, COMPILABLE LaTeX document. Use this EXACT structure:

\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=1.5cm]{geometry}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{enumitem}
\\usepackage{array}
\\usepackage{tabularx}
\\usepackage{booktabs}
\\usepackage{xcolor}
\\usepackage{titlesec}
\\usepackage{fancyhdr}
\\usepackage{multicol}
\\usepackage{tcolorbox}

\\definecolor{chaptercolor}{RGB}{25,25,112}
\\definecolor{sectioncolor}{RGB}{0,100,0}
\\definecolor{formulacolor}{RGB}{139,0,0}
\\definecolor{tipcolor}{RGB}{184,134,11}
\\definecolor{defcolor}{RGB}{75,0,130}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\textbf{${subjectLabel} - ${classLabel} Cheatsheet}}
\\fancyhead[R]{\\textit{Quick Revision Notes}}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{1pt}

\\titleformat{\\section}{\\Large\\bfseries\\color{chaptercolor}}{\\thesection}{1em}{}[\\titlerule]
\\titleformat{\\subsection}{\\large\\bfseries\\color{sectioncolor}}{\\thesubsection}{0.5em}{}

\\begin{document}

\\begin{center}
{\\Huge\\bfseries\\color{chaptercolor} ${subjectLabel} Cheatsheet}\\\\[6pt]
{\\Large ${classLabel} -- Quick Revision Notes}\\\\[4pt]
{\\small Comprehensive chapter-wise summary for exam preparation}\\\\[2pt]
\\rule{\\textwidth}{1.5pt}
\\end{center}

\\vspace{0.5cm}

% FOR EACH CHAPTER:
\\section{Chapter Name}

\\subsection*{\\color{sectioncolor} 📌 Key Topics \\& Concepts}
\\begin{itemize}[leftmargin=1.5em, itemsep=2pt]
  \\item ...
\\end{itemize}

\\subsection*{\\color{defcolor} 📝 Important Definitions}
\\begin{itemize}[leftmargin=1.5em, itemsep=2pt]
  \\item \\textbf{Term:} Definition...
\\end{itemize}

% For STEM/Commerce subjects:
\\subsection*{\\color{formulacolor} 📐 Formulas \\& Equations}
% Use proper math environments:
% \\[ formula \\]
% or
% \\begin{align*} ... \\end{align*}

\\subsection*{\\color{tipcolor} ⭐ Key Points to Remember}
\\begin{enumerate}[leftmargin=1.5em, itemsep=2pt]
  \\item ...
\\end{enumerate}

% If applicable:
\\subsection*{📊 Important Comparisons}
\\begin{tabularx}{\\textwidth}{|l|X|X|}
\\hline
\\textbf{Aspect} & \\textbf{Concept A} & \\textbf{Concept B} \\\\
\\hline
... & ... & ... \\\\
\\hline
\\end{tabularx}

\\subsection*{\\color{sectioncolor} 💡 Quick Revision}
\\begin{enumerate}[leftmargin=1.5em, itemsep=1pt]
  \\item ...
\\end{enumerate}
\subsection*{\color{formulacolor} ✏️ 5 Marks Important Notes}
% Ready-made short notes for 5-mark exam questions
\noindent\textbf{1. Topic Title} \hfill \textit{\small [5 Marks]} \\
 Write 80-120 word exam-ready note here covering the key concept,
 explanation, important points, and conclusion. Include formulas if STEM.
 This should be directly usable as a 5-mark exam answer.

\noindent\rule{\textwidth}{0.2pt}

\noindent\textbf{2. Another Important Topic} \hfill \textit{\small [5 Marks]} \\
 Another exam-ready note...
% Repeat for ALL chapters...

\\end{document}

═══════════════════════════════════════════════════
FORMATTING RULES:
═══════════════════════════════════════════════════

1. Use \\section{} for chapter names (numbered automatically)
2. Use \\subsection*{} for section headings within chapters (unnumbered)
3. All math MUST be in proper LaTeX math mode ($...$ for inline, \\[ \\] for display)
4. Use \\textbf{} for important terms being defined
5. Use \\textit{} for emphasis and book titles
6. Tables must use tabularx with proper column specs and \\hline borders
7. Keep formulas in display math (\\[ \\]) for readability and clarity
8. Use enumerate for numbered lists, itemize for bullet points
9. Do NOT use any Unicode emoji characters directly — use text labels like (IMP), (FAQ)
10. Ensure EVERY \\begin{} has a matching \\end{}
11. Ensure EVERY { has a matching }
12. Do NOT use \\tcolorbox or any undefined commands — stick to basic LaTeX packages listed in preamble
13. Use \\newpage between chapters to keep things clean and readable
14. Use \\textbf{(IMP)} to mark frequently-examined items
15. For chemical equations use LaTeX math mode: $\\text{reactant} \\rightarrow \\text{product}$ or \\[ \\] for display
16. Make the document LONG and DETAILED — do NOT cut corners. Cover everything.

LENGTH GUIDELINE: The output should be 40-80 pages when compiled. Do NOT shorten it. Include EVERYTHING important.

IMPORTANT: The output must be a COMPLETE, DIRECTLY COMPILABLE LaTeX document.
Do NOT wrap it in markdown code blocks.
Start directly with \\documentclass and end with \\end{document}.`;
}

function wrapInLatexDocument(content: string, subject: string, studentClass: string): string {
  const subjectLabel = subject.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const classLabel = studentClass === 'college' ? 'College/University' : `Class ${studentClass}`;

  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=1.5cm]{geometry}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{enumitem}
\\usepackage{array}
\\usepackage{tabularx}
\\usepackage{booktabs}
\\usepackage{xcolor}
\\usepackage{titlesec}
\\usepackage{fancyhdr}
\\usepackage{multicol}

\\definecolor{chaptercolor}{RGB}{25,25,112}
\\definecolor{sectioncolor}{RGB}{0,100,0}
\\definecolor{formulacolor}{RGB}{139,0,0}
\\definecolor{tipcolor}{RGB}{184,134,11}
\\definecolor{defcolor}{RGB}{75,0,130}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\textbf{${subjectLabel} - ${classLabel} Cheatsheet}}
\\fancyhead[R]{\\textit{Quick Revision Notes}}
\\fancyfoot[C]{\\thepage}
\\renewcommand{\\headrulewidth}{1pt}

\\titleformat{\\section}{\\Large\\bfseries\\color{chaptercolor}}{\\thesection}{1em}{}[\\titlerule]
\\titleformat{\\subsection}{\\large\\bfseries\\color{sectioncolor}}{\\thesubsection}{0.5em}{}

\\begin{document}

\\begin{center}
{\\Huge\\bfseries\\color{chaptercolor} ${subjectLabel} Cheatsheet}\\\\[6pt]
{\\Large ${classLabel} -- Quick Revision Notes}\\\\[4pt]
{\\small Comprehensive chapter-wise summary for exam preparation}\\\\[2pt]
\\rule{\\textwidth}{1.5pt}
\\end{center}

\\vspace{0.5cm}

${content}

\\end{document}`;
}
