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
  maxDuration: 300, // 5 minutes max for Netlify
};

interface PDFMetadata {
  subject?: string;
  questionTypes?: string[];
  difficulty?: string;
  customInstructions?: string;
  questionsByType?: {
    mcq: number;
    fillInBlanks: number;
    trueFalse: number;
    columnMatching: number;
    general: number;
  };
  questionsByMarks?: {
    '2': number;
    '3': number;
    '4': number;
    '5': number;
    '6': number;
    '10': number;
  };
}

function truncateForPrompt(
  text: string,
  maxChars: number,
  label: string
): { text: string; truncated: boolean; originalLength: number } {
  const originalLength = text.length;
  if (originalLength <= maxChars) {
    return { text, truncated: false, originalLength };
  }

  // Keep both the beginning and end so headings/structure and footer cues survive.
  const headLen = Math.floor(maxChars * 0.65);
  const tailLen = maxChars - headLen;
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);

  return {
    text:
      `${head}\n\n...[${label} TRUNCATED: kept first ${headLen} + last ${tailLen} chars out of ${originalLength}]...\n\n${tail}`,
    truncated: true,
    originalLength,
  };
}

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
      const msg = (error.message || '').toLowerCase();

      // Don't retry on non-retriable errors
      if (
        msg.includes('api key') || msg.includes('password') ||
        msg.includes('not a valid') || msg.includes('not configured') ||
        msg.includes('empty (0 bytes)') || msg.includes('file not found') ||
        msg.includes('no text could be extracted')
      ) {
        throw error;
      }

      // Retry on rate limits, timeouts, and server errors
      const isRetriable =
        msg.includes('429') || msg.includes('rate') ||
        msg.includes('quota') || msg.includes('timeout') || msg.includes('timed out') ||
        msg.includes('500') || msg.includes('503') || msg.includes('resource_exhausted') ||
        msg.includes('unavailable') || msg.includes('overloaded') ||
        msg.includes('internal') || msg.includes('failed to fetch') ||
        msg.includes('fetch failed') || msg.includes('econnreset') ||
        msg.includes('socket hang up');

      if (attempt < maxRetries && isRetriable) {
        console.warn(`Retriable error on attempt ${attempt + 1} for ${label}: ${error.message}`);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

// Specialized pattern analysis: extracts STRUCTURE (not raw text) from a question paper PDF
async function extractPatternStructure(filePath: string): Promise<string> {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Pattern file not found at: ${filePath}`);
    }
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      throw new Error('Pattern file is empty (0 bytes).');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const dataBuffer = fs.readFileSync(filePath);
    const base64Data = dataBuffer.toString('base64');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const extractTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Pattern analysis timed out after 2 minutes. Try a smaller pattern file.')), 120000);
    });

    console.log(`Analyzing pattern PDF structure: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    const result = await Promise.race([
      model.generateContent([
        { inlineData: { mimeType: 'application/pdf', data: base64Data } },
        {
          text: `You are an expert exam paper analyst. Analyze this examination question paper PDF and extract its COMPLETE structure and format.

Return your analysis in this EXACT format:

PAPER HEADER:
[Exact text of the paper title, institution name, subject, exam name as shown]

PAPER DETAILS:
- Duration: [time duration]
- Total Marks: [total marks]
- Date/Year: [if shown]

GENERAL INSTRUCTIONS:
[List ALL instructions exactly as written in the paper]

SECTIONS AND QUESTIONS:
For EACH section, provide:

SECTION [name/letter]:
- Section title: [exact title]
- Section instructions: [any section-specific instructions]
- Number of questions: [count]
- Marks per question: [marks]
- Question type: [MCQ / Short Answer / Long Answer / Fill-in-blanks / True-False / Numerical / Descriptive / etc.]
- Question numbering format: [e.g., Q.1, 1., Question 1, (i), etc.]
- Marks display format: [e.g., [2 marks], (2M), [2], etc.]
- MCQ option format (if MCQ): [e.g., (a)(b)(c)(d), A. B. C. D., (i)(ii)(iii)(iv)]
- Sub-parts format (if any): [e.g., (a), (i), a., etc.]
- Choice/OR options: [e.g., "Answer any 5 out of 7", "OR between Q3 and Q4"]
- Sample questions from this section (include 2-3 actual questions with full text, preserving any math using LaTeX $...$ notation):
  Q: [question text]
  Q: [question text]

FORMATTING NOTES:
- Paper layout style: [formal board-exam / university-exam / coaching-institute / school-test]
- Header/footer content: [describe]
- Visual elements: [boxes, tables, lines, special formatting]
- Any OR/choice patterns between questions

Be thorough and precise. This analysis will be used to generate a new paper with the IDENTICAL structure.`
        }
      ]),
      extractTimeout
    ]);

    const response = await result.response;
    const text = response.text();

    if (!text || text.trim().length === 0) {
      throw new Error('Could not analyze the pattern PDF structure. The file may be image-only — try a text-based PDF.');
    }

    console.log(`Pattern structure analysis complete. Length: ${text.length} chars`);
    return text;
  } catch (error: any) {
    console.error(`Error analyzing pattern PDF (${filePath}):`, error);

    const msg = error.message || String(error);

    if (msg.includes('GEMINI_API_KEY') || msg.includes('not configured')) {
      throw new Error('API key not configured. Please contact support.');
    }
    if (msg.includes('password')) {
      throw new Error('The pattern PDF is password protected. Please unlock it and try again.');
    }
    if (msg.includes('quota') || msg.includes('rate limit')) {
      throw new Error('API rate limit exceeded. Please wait a moment and try again.');
    }

    throw new Error(`Failed to analyze pattern PDF: ${msg}`);
  }
}

async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    // 1. Validate file existence and size
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at: ${filePath}`);
    }
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      throw new Error('File is empty (0 bytes).');
    }

    // 2. Use Gemini's File API for PDF text extraction (serverless-friendly)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    // 3. Read file as base64
    const dataBuffer = fs.readFileSync(filePath);
    const base64Data = dataBuffer.toString('base64');

    // 4. Use Gemini to extract text from PDF
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    // Add timeout for PDF extraction (2 minutes should be enough for most PDFs)
    const extractTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('PDF text extraction timed out after 2 minutes. Try a smaller PDF or split it into chapters.')), 120000);
    });

    console.log(`Starting PDF text extraction for file: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    const result = await Promise.race([
      model.generateContent([
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64Data
          }
        },
        {
          text: `Extract all text content from this PDF document. Return ONLY the extracted text without any additional commentary, formatting, or explanations. Preserve the structure and order of the text as it appears in the document.`
        }
      ]),
      extractTimeout
    ]);

    const response = await result.response;
    const text = response.text();
    
    // 5. Validate result
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('No text could be extracted from the PDF');
    }
    
    console.log(`Successfully extracted ${text.length} characters from PDF using Gemini`);
    return text;
  } catch (error: any) {
    console.error(`Error extracting text from PDF (${filePath}):`, error);
    
    const msg = error.message || String(error);
    
    if (msg.includes('GEMINI_API_KEY')) {
      throw new Error('API key not configured. Please contact support.');
    }
    if (msg.includes('password')) {
      throw new Error('The PDF is password protected. Please unlock it and try again.');
    }
    if (msg.includes('Invalid PDF') || msg.includes('not a valid')) {
      throw new Error('The file is not a valid PDF or is corrupted.');
    }
    if (msg.includes('quota') || msg.includes('rate limit')) {
      throw new Error('API rate limit exceeded. Please try again in a moment.');
    }
    
    throw new Error(`Failed to extract text from PDF: ${msg}`);
  }
}

async function generateQuestionsWithGemini(
  pdfText: string,
  metadata: PDFMetadata,
  patternText?: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const subject = metadata.subject || 'mathematics';
  const questionTypes = metadata.questionTypes || ['problem-solving', 'conceptual', 'application'];
  const difficulty = metadata.difficulty || 'mixed';

  const questionTypeDesc = questionTypes.join(', ');

  // Build question breakdown
  let questionBreakdown = '';
  
  if (metadata.questionsByType) {
    const types = metadata.questionsByType;
    const parts: string[] = [];
    if (types.mcq > 0) parts.push(`${types.mcq} Multiple Choice Questions (MCQ)`);
    if (types.fillInBlanks > 0) parts.push(`${types.fillInBlanks} Fill in the Blanks questions`);
    if (types.trueFalse > 0) parts.push(`${types.trueFalse} True/False questions`);
    if (types.columnMatching > 0) parts.push(`${types.columnMatching} Column Matching questions (Match Column A with Column B in a table format)`);
    if (types.general > 0) parts.push(`${types.general} General questions`);
    
    if (parts.length > 0) {
      questionBreakdown += '\n\n1 Mark Questions:\n' + parts.map(p => `- ${p}`).join('\n');
    }
  }
  
  if (metadata.questionsByMarks) {
    const marks = metadata.questionsByMarks;
    const parts: string[] = [];
    if (marks['2'] > 0) parts.push(`${marks['2']} questions of 2 marks each`);
    if (marks['3'] > 0) parts.push(`${marks['3']} questions of 3 marks each`);
    if (marks['4'] > 0) parts.push(`${marks['4']} questions of 4 marks each`);
    if (marks['5'] > 0) parts.push(`${marks['5']} questions of 5 marks each`);
    if (marks['6'] > 0) parts.push(`${marks['6']} questions of 6 marks each`);
    if (marks['10'] > 0) parts.push(`${marks['10']} questions of 10 marks each`);
    
    if (parts.length > 0) {
      questionBreakdown += '\n\nQuestions by Marks:\n' + parts.map(p => `- ${p}`).join('\n');
    }
  }

  const customInstructionsSection = metadata.customInstructions 
    ? `\n\nCUSTOM INSTRUCTIONS (HIGHEST PRIORITY):\n${metadata.customInstructions}\n\nPlease follow these custom instructions carefully as they take precedence over other settings.`
    : '';

  // Subject-specific intelligent question generation guidelines
  const subjectSpecificGuidelines = {
    mathematics: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 MATHEMATICS - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TOPIC COVERAGE - EQUAL WEIGHTAGE:
   - Analyze ALL topics/chapters in the provided content
   - Distribute questions EQUALLY across ALL topics (if 4 topics, ~25% questions per topic)
   - Don't skip any topic, even if briefly covered in the content
   - Example: If content covers Algebra, Calculus, Geometry, Statistics - ensure equal representation

2. QUESTION TYPE DISTRIBUTION:
   - 40% Numerical/Computational problems (calculations, solving equations, finding values)
   - 30% Conceptual understanding (proofs, derivations, explanations)
   - 20% Application-based (word problems, real-world scenarios)
   - 10% Theorem/Formula based (state and prove, verify formulas)

3. NUMERICAL QUESTIONS - MUST INCLUDE:
   - Actual calculations with numbers (NOT just symbolic)
   - Step-by-step arithmetic/algebraic solutions
   - Clear numerical answers (e.g., "Find the value of x" should give x = 5.2, not just x)
   - Mix of integers, decimals, fractions based on difficulty
   - Include units where applicable (meters, seconds, dollars, etc.)

4. DIFFICULTY PROGRESSION:
   - Easy (30%): Direct formula application, basic computations
   - Medium (50%): Multi-step problems, requires concept understanding
   - Hard (20%): Involves multiple concepts, creative thinking

5. SMART QUESTION CHARACTERISTICS:
   - Clear, unambiguous problem statements
   - Sufficient data provided (not missing information)
   - Realistic numbers (avoid extremely large or complex values for basic level)
   - Questions should test understanding, not just memorization
   - Include diagrams where helpful (mention "diagram not shown" if complex)

EXAMPLE QUESTION QUALITY:
❌ BAD: "Solve the equation." (Too vague)
✅ GOOD: "Solve for x: $3x + 7 = 22$. Show all steps."

❌ BAD: "Find the derivative." (Which function?)
✅ GOOD: "Find $\\frac{d}{dx}(x^3 + 2x^2 - 5x + 1)$ and evaluate at $x = 2$."
`,
    physics: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚛️ PHYSICS - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TOPIC COVERAGE:
   - Equal representation from all chapters (Mechanics, Thermodynamics, Optics, etc.)
   - Cover both theory and numerical problems
   
2. QUESTION DISTRIBUTION:
   - 50% Numerical problems with calculations
   - 25% Derivations and proofs
   - 15% Conceptual/Theory questions
   - 10% Diagram-based or experimental questions

3. NUMERICAL PROBLEMS - REQUIREMENTS:
   - Realistic values with proper SI units
   - Clear given data and what to find
   - Step-by-step solution with formula application
   - Final answer with correct units and significant figures

4. TOPIC BALANCE:
   - If content covers 5 topics, aim for 20% questions per topic
   - Don't overemphasize one topic

EXAMPLE:
✅ GOOD: "A car accelerates from rest to 20 m/s in 5 seconds. Calculate: (a) acceleration (b) distance traveled. Use $v = u + at$ and $s = ut + \\frac{1}{2}at^2$."
`,
    chemistry: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 CHEMISTRY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. BALANCED COVERAGE:
   - Organic, Inorganic, Physical Chemistry - equal weightage
   - Both theoretical and numerical questions

2. QUESTION TYPES:
   - 40% Numerical (stoichiometry, molarity, pH calculations)
   - 30% Reactions and equations
   - 20% Naming, structures, properties
   - 10% Experimental procedures

3. NUMERICAL PRECISION:
   - Use molar masses, Avogadro's number accurately
   - Show dimensional analysis
   - Proper chemical formulas and equations
`,
    biology: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧬 BIOLOGY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EQUAL TOPIC DISTRIBUTION:
   - Cover all units equally (Cell Biology, Genetics, Ecology, etc.)

2. QUESTION STYLE:
   - 50% Descriptive (explain, describe, differentiate)
   - 25% Diagram-based (label, draw, identify)
   - 15% Application (case studies, scenarios)
   - 10% Numerical (genetics ratios, population calculations)

3. QUALITY MARKERS:
   - Use proper scientific terminology
   - Include specific examples from nature
   - Avoid yes/no questions, prefer "explain why"
`,
    history: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 HISTORY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TIME PERIOD BALANCE:
   - Equal coverage across all time periods mentioned in content
   - Ancient, Medieval, Modern - balanced representation

2. QUESTION TYPES FOR HISTORY:
   - 40% Analytical (causes, effects, significance, analyze)
   - 30% Descriptive (describe events, movements, personalities)
   - 20% Chronological (timelines, sequence of events, dates)
   - 10% Comparative (compare two periods, leaders, movements)

3. PROPER HISTORICAL QUESTIONS:
   - Include specific dates, names, places
   - Ask "Why" and "How" not just "What"
   - Questions should test understanding of causation
   - Include primary source analysis where applicable

4. AVOID:
   - Generic "what happened" questions
   - Questions answerable in one word
   - Obscure trivial details

EXAMPLES:
❌ BAD: "Who was the first president?"
✅ GOOD: "Analyze the factors that led to [specific event] in [year]. How did this impact [region/people]?"

✅ GOOD: "Compare the economic policies of [Leader A] and [Leader B]. What were the key differences and their impacts on society?"

✅ GOOD: "Explain the significance of [Historical Event] in the context of [Time Period]. How did it change the course of history?"
`,
    'computer-science': `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💻 COMPUTER SCIENCE - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. BALANCED TOPICS:
   - Programming, Data Structures, Algorithms, Theory - equal coverage

2. QUESTION MIX:
   - 40% Code writing/analysis
   - 30% Algorithm design and analysis
   - 20% Theoretical concepts
   - 10% Problem-solving with pseudocode

3. CODE QUESTIONS:
   - Include actual code snippets
   - Ask for output, debugging, or code completion
   - Use proper syntax and formatting
`,
    economics: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 ECONOMICS - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. COVERAGE:
   - Microeconomics and Macroeconomics - balanced
   
2. QUESTION TYPES:
   - 40% Numerical (demand-supply, GDP, inflation calculations)
   - 30% Analytical (explain concepts, cause-effect)
   - 20% Graphical (draw and explain curves)
   - 10% Case studies

3. INCLUDE:
   - Real-world economic scenarios
   - Use of formulas with actual numbers
   - Graph sketches where needed
`,
    statistics: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STATISTICS - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TOPIC BALANCE:
   - Descriptive and Inferential statistics equally

2. HEAVY NUMERICAL:
   - 70% Numerical calculations (mean, median, variance, probability)
   - 20% Interpretation of results
   - 10% Theoretical concepts

3. DATA QUALITY:
   - Provide actual datasets
   - Realistic numbers
   - Step-by-step calculations shown
`,
    english: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 ENGLISH - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. BALANCED COVERAGE:
   - Literature, Grammar, Composition, Comprehension - equal weightage

2. QUESTION TYPES:
   - 30% Comprehension passages with questions
   - 25% Grammar and language usage
   - 25% Literature analysis (poems, prose, drama)
   - 20% Creative writing and composition

3. QUALITY STANDARDS:
   - Include actual text excerpts for analysis
   - Grammar questions with specific examples
   - Literary questions testing critical thinking
   - Essay/letter topics with clear instructions
`,
    hindi: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🇮🇳 HINDI - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. COVERAGE:
   - साहित्य (Literature), व्याकरण (Grammar), रचना (Composition)

2. QUESTION DISTRIBUTION:
   - 30% गद्यांश और पद्यांश (Comprehension)
   - 30% व्याकरण (Grammar - समास, संधि, etc.)
   - 25% साहित्य विश्लेषण (Literary analysis)
   - 15% निबंध और पत्र लेखन (Essays and letters)

3. INCLUDE:
   - Actual Hindi text excerpts
   - Proper Devanagari script
   - Mix of modern and classical literature
`,
    geography: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🗺️ GEOGRAPHY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TOPIC BALANCE:
   - Physical Geography and Human Geography - equal coverage

2. QUESTION TYPES:
   - 35% Map-based questions (identify, locate, mark)
   - 30% Descriptive (explain phenomena, processes)
   - 20% Analytical (causes, effects, comparisons)
   - 15% Numerical (population, resources, calculations)

3. INCLUDE:
   - Specific place names and coordinates
   - Climate data and statistics
   - Map references where applicable
   - Current geographical issues
`,
    'political-science': `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ POLITICAL SCIENCE - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. BALANCED TOPICS:
   - Political Theory, Indian Politics, International Relations

2. QUESTION TYPES:
   - 40% Analytical (analyze concepts, institutions, systems)
   - 30% Descriptive (explain concepts, processes)
   - 20% Comparative (compare systems, ideologies)
   - 10% Current affairs and case studies

3. QUALITY:
   - Include real political examples
   - Reference specific constitutions, laws, policies
   - Test critical thinking about democracy, rights, governance
`,
    'social-science': `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌍 SOCIAL SCIENCE - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. INTEGRATED APPROACH:
   - Cover History, Geography, Civics, Economics equally

2. QUESTION DISTRIBUTION:
   - 25% History (events, movements, personalities)
   - 25% Geography (physical and human)
   - 25% Civics (constitution, government, rights)
   - 25% Economics (basic economic concepts)

3. INTERDISCIPLINARY:
   - Connect topics across subjects
   - Real-world applications
   - Current social issues
`,
    accountancy: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ACCOUNTANCY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PRACTICAL FOCUS:
   - 70% Numerical problems (journal entries, ledger, final accounts)
   - 20% Theory (concepts, principles, standards)
   - 10% Case-based scenarios

2. INCLUDE:
   - Complete accounting problems with transactions
   - T-accounts and double-entry examples
   - Financial statement preparation
   - Ratio analysis with actual numbers
`,
    'business-studies': `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💼 BUSINESS STUDIES - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TOPIC COVERAGE:
   - Management, Marketing, Finance, HR - balanced

2. QUESTION TYPES:
   - 40% Case studies and scenarios
   - 30% Analytical (explain, analyze, evaluate)
   - 20% Descriptive (define, describe functions)
   - 10% Numerical (simple calculations)

3. REAL-WORLD:
   - Use actual business examples
   - Current business practices
   - Practical management scenarios
`,
    psychology: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 PSYCHOLOGY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. BALANCED APPROACH:
   - Cognitive, Behavioral, Social, Developmental psychology

2. QUESTION TYPES:
   - 40% Application (case studies, real-life scenarios)
   - 30% Analytical (explain theories, compare approaches)
   - 20% Experimental (design studies, interpret results)
   - 10% Descriptive (define concepts, describe processes)

3. INCLUDE:
   - Reference to classic experiments
   - Real psychological phenomena
   - Ethical considerations
`,
    sociology: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👥 SOCIOLOGY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. COMPREHENSIVE COVERAGE:
   - Social institutions, stratification, change, research methods

2. QUESTION DISTRIBUTION:
   - 40% Analytical (analyze social issues, institutions)
   - 30% Theoretical (explain concepts, theories)
   - 20% Contemporary (current social problems)
   - 10% Research methods and data interpretation

3. FOCUS:
   - Real social issues and examples
   - Reference sociological thinkers
   - Cultural diversity and social change
`,
    philosophy: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💭 PHILOSOPHY - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TOPIC BALANCE:
   - Ethics, Logic, Metaphysics, Epistemology equally

2. QUESTION TYPES:
   - 40% Analytical (analyze arguments, evaluate positions)
   - 30% Critical thinking (identify fallacies, construct arguments)
   - 20% Comparative (compare philosophers' views)
   - 10% Applied ethics (real-life dilemmas)

3. INCLUDE:
   - Reference to major philosophers
   - Logical reasoning problems
   - Ethical dilemmas and thought experiments
`,
    'environmental-science': `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌱 ENVIRONMENTAL SCIENCE - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. INTEGRATED APPROACH:
   - Ecology, Pollution, Conservation, Sustainability

2. QUESTION MIX:
   - 35% Analytical (environmental issues, impacts, solutions)
   - 30% Descriptive (ecosystems, cycles, processes)
   - 20% Numerical (pollution calculations, ecological footprint)
   - 15% Case studies (real environmental problems)

3. CURRENT FOCUS:
   - Climate change, biodiversity
   - Sustainable practices
   - Environmental laws and policies
`,
    sanskrit: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕉️ SANSKRIT - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. BALANCED CONTENT:
   - व्याकरण (Grammar), साहित्य (Literature), अनुवाद (Translation)

2. QUESTION TYPES:
   - 35% व्याकरण (Sandhi, Samasa, Dhatu, Pratyaya)
   - 30% गद्य और पद्य (Prose and poetry comprehension)
   - 20% अनुवाद (Translation Sanskrit to English/Hindi)
   - 15% रचना (Composition in Sanskrit)

3. USE:
   - Proper Devanagari script
   - Classical texts references
   - Grammatical rules with examples
`,
    'general-science': `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔬 GENERAL SCIENCE - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EQUAL COVERAGE:
   - Physics, Chemistry, Biology - equal parts (33% each)

2. QUESTION DISTRIBUTION:
   - 40% Conceptual (explain phenomena, processes)
   - 30% Factual (identify, name, define)
   - 20% Application (real-life science)
   - 10% Numerical (basic calculations)

3. ACCESSIBLE:
   - Age-appropriate content
   - Everyday science examples
   - Practical applications
`,
    engineering: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ ENGINEERING - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PRACTICAL FOCUS:
   - 50% Problem-solving with calculations
   - 25% Design and analysis
   - 15% Theoretical concepts
   - 10% Diagram-based

2. INCLUDE:
   - Real engineering problems
   - Standard formulas and units
   - Circuit diagrams, mechanical drawings where needed
   - Step-by-step solutions
`
  };

  const selectedGuideline = subjectSpecificGuidelines[subject as keyof typeof subjectSpecificGuidelines] || `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 GENERAL SUBJECT - SMART QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EQUAL TOPIC COVERAGE:
   - Identify all topics in the content
   - Distribute questions equally across all topics

2. QUESTION QUALITY:
   - Clear, specific questions
   - Include examples and context
   - Test understanding, not just recall
   - Provide sufficient detail in solutions
`;

  const patternSection = patternText
    ? `\n\n=== QUESTION PAPER PATTERN ANALYSIS ===\n\n${patternText}\n\n=== END OF PATTERN ANALYSIS ===`
    : '';

  const prompt = patternText
    ? `You are an expert ${subject} educator and professional LaTeX exam paper creator.

TASK: Generate a NEW exam question paper that EXACTLY replicates the structure and format described in the pattern analysis below, using ONLY content from the provided textbook material.

${patternSection}

TEXTBOOK CONTENT (source for new questions):
${pdfText}

GENERATION RULES:
1. Create a COMPLETE, compilable LaTeX document (\\documentclass through \\end{document})
2. Match the pattern's structure EXACTLY: same sections, same number of questions per section, same marks distribution, same question types
3. Replicate the pattern's formatting: same numbering style, same marks display format, same header/instruction layout
4. Generate NEW questions from the textbook content — do NOT copy the sample questions from the pattern
5. Match the difficulty level: ${difficulty}
6. For EVERY question, include a solution wrapped in markers:
   % START SOLUTION
   [Step-by-step solution]
   % END SOLUTION
7. Use proper LaTeX packages: amsmath, amssymb, geometry, enumitem, fancyhdr
8. Use $...$ for inline math and \\[...\\] or $$...$$ for display math
9. For MCQs: use the exact option format from the pattern (e.g., (a)(b)(c)(d))
10. For fill-in-blanks: use \\underline{\\hspace{3cm}}
11. For Column Matching: use a LaTeX tabular with Column A and Column B. Shuffle Column B so answers don't align directly. Solution should list correct pairs.

IMPORTANT: Output ONLY the complete LaTeX document. No markdown, no explanations, no code fences.`
    : `You are an expert ${subject} educator and LaTeX document formatter.

Content:
${pdfText}

Please generate high-quality ${subject} questions based on this content.${questionBreakdown}

Question Requirements:
- Question types: ${questionTypeDesc}
- Difficulty level: ${difficulty}
- Each question should be clear and well-formatted
- Provide detailed step-by-step solutions
- Use proper LaTeX notation for all mathematical expressions${customInstructionsSection}

Format your response ENTIRELY in LaTeX using this EXACT structure for a proper exam paper:

\\documentclass[12pt,a4paper]{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{geometry}
\\usepackage{enumitem}
\\usepackage{fancyhdr}
\\usepackage{graphicx}
\\geometry{margin=0.75in, top=1in, bottom=1in}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\textbf{${subject.charAt(0).toUpperCase() + subject.slice(1)} Examination}}
\\fancyhead[R]{\\textbf{Page \\thepage}}
\\fancyfoot[C]{\\small All questions carry marks as indicated}

\\begin{document}

% Header Section
\\begin{center}
{\\Large \\textbf{EXAMINATION PAPER}}\\\\[0.3cm]
{\\large \\textbf{Subject: ${subject.charAt(0).toUpperCase() + subject.slice(1)}}}\\\\[0.2cm]
{\\textbf{Difficulty Level: ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}}}\\\\[0.2cm]
\\rule{\\textwidth}{0.4pt}
\\end{center}

\\vspace{0.3cm}

% Instructions Box
\\noindent\\fbox{\\parbox{\\dimexpr\\textwidth-2\\fboxsep-2\\fboxrule}{
\\textbf{INSTRUCTIONS TO CANDIDATES:}\\\\[0.2cm]
\\begin{itemize}[leftmargin=*, itemsep=0pt]
\\item Read all questions carefully before attempting.
\\item Answer all questions in the space provided or on separate sheets.
\\item Show all working for full credit.
\\item Marks for each question are indicated in brackets.
\\item Use of calculator is permitted (if applicable).
${questionBreakdown ? '\\item ' + questionBreakdown.replace(/\n/g, '\n\\item ').replace('1 Mark Questions:', '\\textbf{Section A:} 1 Mark Questions').replace('Questions by Marks:', '\\textbf{Section B:} Higher Mark Questions') : ''}
\\end{itemize}
}}

\\vspace{0.5cm}

% Questions Section
\\section*{QUESTIONS}

[Now generate each question using this EXACT format:

\\subsection*{Question 1 [X marks]}
[Question text with proper LaTeX math formatting]

% START SOLUTION
\\subsection*{Solution}
[Detailed solution with step-by-step explanation]
% END SOLUTION

\\vspace{0.5cm}

Repeat for all questions, ensuring proper numbering and mark allocation.]

\\end{document}

CRITICAL FORMATTING REQUIREMENTS:
- Use \\subsection*{Question N [X marks]} for each question header
- Use \\subsection*{Solution} for each solution
- Wrap EVERY solution with % START SOLUTION and % END SOLUTION comments
- Use $...$ for inline math and $$...$$ or \\[...\\] for display math
- For MCQs: Use (a), (b), (c), (d) format
- For Fill in Blanks: Use \\underline{\\hspace{3cm}} for blanks
- For Column Matching: Use a proper LaTeX table with two columns (Column A and Column B). Format example:
  \\begin{tabular}{|c|p{5cm}|c|p{5cm}|}
  \\hline
  \\textbf{Column A} & & \\textbf{Column B} & \\\\
  \\hline
  (i) & Item 1 & (a) & Match 1 \\\\
  (ii) & Item 2 & (b) & Match 2 \\\\
  \\hline
  \\end{tabular}
  Shuffle Column B so it does NOT directly align with Column A. The solution should list correct pairs like (i)-(c), (ii)-(a), etc.
- Add \\vspace{0.5cm} between questions for spacing
- Make questions relevant to the provided content
- STRICTLY follow the custom instructions if provided
- Number questions consecutively starting from 1`;

  console.log('Sending request to Gemini API...');
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Question generation timed out. Try with a smaller PDF or fewer questions.')), 180000);
  });

  const result = await Promise.race([
    model.generateContent(prompt),
    timeoutPromise
  ]);
  
  const response = await result.response;
  const responseText = response.text();
  
  console.log('Received response from Gemini. Length:', responseText.length);
  
  if (!responseText || responseText.trim().length === 0) {
    throw new Error('Gemini returned empty response');
  }
  
  return responseText;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Vercel/serverless writable path is /tmp
    const uploadDir = path.join(os.tmpdir(), 'study-buddy-uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const form = formidable({
      uploadDir,
      keepExtensions: true,
      maxFileSize: 64 * 1024 * 1024, // 64MB
      maxTotalFileSize: 128 * 1024 * 1024, // 128MB (Total for all files)
      allowEmptyFiles: true,
      minFileSize: 0,
    });

    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Form parse error:', err);
        // Handle specific formidable errors
        if (err.message && (err.message.includes('maxFileSize') || err.message.includes('maxTotalFileSize'))) {
          return res.status(400).json({ error: 'File size exceeds the limit (64MB per file, 128MB total)' });
        }
        return res.status(500).json({ error: 'Failed to upload files: ' + (err.message || 'Unknown error') });
      }

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const patternFile = Array.isArray(files.patternFile) ? files.patternFile[0] : files.patternFile;

      const filePath = (file as File).filepath;
      const patternFilePath = patternFile ? (patternFile as File).filepath : null;

      try {
        // Extract metadata
        const metadata: PDFMetadata = {
          subject: Array.isArray(fields.subject) ? fields.subject[0] : fields.subject,
          questionTypes: Array.isArray(fields.questionTypes) 
            ? fields.questionTypes 
            : (fields.questionTypes ? [fields.questionTypes] : undefined),
          difficulty: Array.isArray(fields.difficulty) ? fields.difficulty[0] : fields.difficulty,
          customInstructions: Array.isArray(fields.customInstructions) ? fields.customInstructions[0] : fields.customInstructions,
        };

        // Parse JSON fields
        if (fields.questionsByType) {
          const qbtStr = Array.isArray(fields.questionsByType) ? fields.questionsByType[0] : fields.questionsByType;
          try {
            metadata.questionsByType = JSON.parse(qbtStr);
          } catch (e) {
            console.error('Error parsing questionsByType:', e);
          }
        }

        if (fields.questionsByMarks) {
          const qbmStr = Array.isArray(fields.questionsByMarks) ? fields.questionsByMarks[0] : fields.questionsByMarks;
          try {
            metadata.questionsByMarks = JSON.parse(qbmStr);
          } catch (e) {
            console.error('Error parsing questionsByMarks:', e);
          }
        }

        // Extract text from PDF(s) — run in PARALLEL for pattern mode to save time
        // Use retry logic to handle transient Gemini rate limits / server errors
        console.log('Starting PDF extraction...' + (patternFilePath ? ' (parallel: content + pattern)' : ''));

        const contentPromise = withRetry(
          () => extractTextFromPDF(filePath),
          { maxRetries: 2, baseDelay: 3000, label: 'content-extraction' }
        );

        // For pattern mode: use specialized structure extractor (not raw text)
        // This produces a compact structural analysis instead of huge raw text
        const patternPromise = patternFilePath
          ? withRetry(
              () => extractPatternStructure(patternFilePath),
              { maxRetries: 2, baseDelay: 4000, label: 'pattern-analysis' }
            )
          : Promise.resolve(undefined);

        let pdfText: string;
        let patternText: string | undefined;

        try {
          [pdfText, patternText] = await Promise.all([contentPromise, patternPromise]);
        } catch (extractionError: any) {
          // Clean up uploaded files on extraction failure
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          if (patternFilePath && fs.existsSync(patternFilePath)) fs.unlinkSync(patternFilePath);

          const msg = extractionError.message || 'PDF extraction failed';
          console.error('Extraction error:', msg);

          // Provide user-friendly error messages
          if (msg.includes('rate limit') || msg.includes('quota') || msg.includes('429')) {
            return res.status(429).json({ error: 'API rate limit reached. Please wait 30 seconds and try again.' });
          }
          if (msg.includes('timed out') || msg.includes('timeout')) {
            return res.status(504).json({ error: 'PDF processing timed out. Try a smaller PDF file.' });
          }
          return res.status(500).json({ error: msg });
        }

        console.log('PDF text extraction complete. Length:', pdfText.length);
        if (patternText) {
          console.log('Pattern analysis complete. Length:', patternText.length);
        }

        if (!pdfText.trim()) {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          if (patternFilePath && fs.existsSync(patternFilePath)) fs.unlinkSync(patternFilePath);
          return res.status(400).json({ error: 'Could not extract text from PDF. The file may be image-only or corrupted.' });
        }

        // Generate questions using Gemini (with delay to avoid rate limits after extraction)
        let latexContent = '';
        try {
          // Use smaller content limit when pattern is present (pattern analysis is already compact)
          const MAX_CONTENT_CHARS = patternText ? 50000 : 80000;

          const contentForPrompt = truncateForPrompt(pdfText, MAX_CONTENT_CHARS, 'CONTENT');

          console.log(
            `Sending to Gemini: content ${contentForPrompt.text.length}/${contentForPrompt.originalLength}` +
              (contentForPrompt.truncated ? ' (truncated)' : '') +
              `, pattern analysis ${patternText ? patternText.length : 0} chars`
          );

          // Add delay before generation to avoid rate limits (especially after parallel extraction)
          if (patternText) {
            console.log('Waiting 2s before generation to avoid rate limits...');
            await delay(2000);
          }

          latexContent = await withRetry(
            () => generateQuestionsWithGemini(
              contentForPrompt.text,
              metadata,
              patternText || undefined
            ),
            { maxRetries: 1, baseDelay: 5000, label: 'question-generation' }
          );
        } catch (geminiError: any) {
          console.error('Gemini API error:', geminiError);
          const msg = geminiError.message || 'Unknown error';
          if (msg.includes('rate') || msg.includes('quota') || msg.includes('429')) {
            throw new Error('AI service rate limit reached. Please wait a minute and try again.');
          }
          if (msg.includes('timed out') || msg.includes('timeout')) {
            throw new Error('Question generation timed out. Try with a smaller textbook PDF.');
          }
          throw new Error(`AI generation failed: ${msg}`);
        }

        if (!latexContent || latexContent.trim().length === 0) {
          throw new Error('AI generated empty content');
        }
        
        // Extract LaTeX from AI response - handle multiple formats
        // 1. Remove any conversational text before the LaTeX
        // 2. Extract content from markdown code blocks
        // 3. Find the actual \documentclass start
        
        // First, try to extract from markdown code blocks
        const codeBlockMatch = latexContent.match(/```(?:latex)?\s*\n([\s\S]*?)\n```/i);
        if (codeBlockMatch) {
          latexContent = codeBlockMatch[1];
        } else {
          // Remove leading markdown code fence if present
          latexContent = latexContent.replace(/^```(?:latex)?\s*\n?/i, '');
          // Remove trailing markdown code fence if present
          latexContent = latexContent.replace(/\n?```\s*$/i, '');
        }
        
        // Find the start of actual LaTeX (should begin with \documentclass)
        const docStartMatch = latexContent.match(/\\documentclass[\s\S]*/);
        if (docStartMatch) {
          latexContent = docStartMatch[0];
        }
        
        // Trim any remaining whitespace
        latexContent = latexContent.trim();

        if (!latexContent.includes('\\documentclass')) {
          console.error('Invalid LaTeX content. First 500 chars:', latexContent.substring(0, 500));
          throw new Error('Generated content is not valid LaTeX');
        }

        // Clean up uploaded files
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        if (patternFilePath && fs.existsSync(patternFilePath)) {
          fs.unlinkSync(patternFilePath);
        }

        return res.status(200).json({
          success: true,
          latex: latexContent,
        });
      } catch (error: any) {
        console.error('Processing error:', error);
        // Clean up on error
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
          }
        }
        if (patternFilePath && fs.existsSync(patternFilePath)) {
          try {
            fs.unlinkSync(patternFilePath);
          } catch (cleanupError) {
            console.error('Pattern cleanup error:', cleanupError);
          }
        }
        return res.status(500).json({ error: error.message || 'Failed to process PDF' });
      }
    });
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
