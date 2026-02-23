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

  // Keep both the beginning and end. Give MORE weight to the end (45%)
  // because exercise/practice sections are typically at the end of chapters/books.
  const headLen = Math.floor(maxChars * 0.55);
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
interface TokenUsage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ExtractionResult {
  text: string;
  tokens: TokenUsage;
}

async function extractPatternStructure(filePath: string): Promise<ExtractionResult> {
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

QUESTION-BY-QUESTION BREAKDOWN:
For EVERY question in the paper, list it in order:

Q[number] ([marks] marks):
- Type: [MCQ / Fill-in-blank / True-False / Column-Matching / Numerical / Short-Answer / Long-Answer / Descriptive / Assertion-Reason / Diagram-based / Proof / Derivation / Case-study]
- Sub-parts: [if the question has sub-parts (a), (b), (c) etc., list each sub-part's type separately]
  (a) Type: [type] — Brief description of what is asked
  (b) Type: [type] — Brief description of what is asked
- Section: [which section this belongs to, e.g., Section A, Section B]
- Has OR/choice: [Yes/No — if there's an alternative question]
- Sample text: [Include the actual question text, preserving math with $...$ notation]

Example:
Q1 (1 mark):
- Type: MCQ
- Section: Section A
- Has OR/choice: No
- Sample text: Which of the following is a prime number? (a) 4 (b) 7 (c) 9 (d) 12

Q5 (5 marks):
- Sub-parts:
  (a) Type: Numerical — Calculate the area
  (b) Type: True-False — State whether the statement is true or false
  (c) Type: Column-Matching — Match Column A with Column B
  (d) Type: Short-Answer — Define the term
- Section: Section C
- Has OR/choice: Yes (OR with Q6)

SECTION SUMMARY:
For EACH section:
- Section name: [exact title]
- Section instructions: [any section-specific instructions]
- Question number range: [e.g., Q1-Q10]
- Marks per question: [marks]
- Question numbering format: [e.g., Q.1, 1., Question 1]
- Marks display format: [e.g., [2 marks], (2M), [2]]
- MCQ option format (if any): [e.g., (a)(b)(c)(d)]

FORMATTING NOTES:
- Paper layout style: [formal board-exam / university-exam / coaching-institute / school-test]
- Header/footer content: [describe]
- Visual elements: [boxes, tables, lines, special formatting]

IMPORTANT: Be extremely precise about the TYPE of each question and sub-part. This analysis will be used to generate a new paper where each question MUST be the same type as the original.`
        }
      ]),
      extractTimeout
    ]);

    const response = await result.response;
    const text = response.text();

    if (!text || text.trim().length === 0) {
      throw new Error('Could not analyze the pattern PDF structure. The file may be image-only — try a text-based PDF.');
    }

    const usage = response.usageMetadata;
    console.log(`Pattern structure analysis complete. Length: ${text.length} chars. Tokens: ${usage?.totalTokenCount || 'N/A'}`);
    return { text, tokens: { promptTokens: usage?.promptTokenCount || 0, outputTokens: usage?.candidatesTokenCount || 0, totalTokens: usage?.totalTokenCount || 0 } };
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

async function extractTextFromPDF(filePath: string): Promise<ExtractionResult> {
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
          text: `Extract ALL text content from this PDF document — from the FIRST page to the LAST page, including ALL chapters, units, and sections.

CRITICAL PRIORITY SECTIONS TO EXTRACT (do NOT skip these):
1. **Exercise / Practice / Solved Examples / Worked Examples sections** at the end of each chapter — these are the MOST IMPORTANT parts. Extract EVERY question from these sections.
2. **Review Questions / Chapter-end Questions / Miscellaneous Exercises** — extract ALL of these verbatim.
3. **Important formulas, theorems, derivations, key concepts** from within each chapter.
4. **Table of Contents / Index** — so chapter structure is clear.
5. **In-text examples and illustrations** that demonstrate problem-solving.

DO NOT just extract the first few pages and stop. Read the ENTIRE PDF from cover to cover.
Return ONLY the extracted text without any additional commentary or explanations. Preserve the structure, chapter headings, and order of the text as it appears in the document.
Mark exercise/practice sections clearly with headers like [EXERCISE - Chapter X] so they are identifiable.`
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
    
    const usage = response.usageMetadata;
    console.log(`Successfully extracted ${text.length} characters from PDF using Gemini. Tokens: ${usage?.totalTokenCount || 'N/A'}`);
    return { text, tokens: { promptTokens: usage?.promptTokenCount || 0, outputTokens: usage?.candidatesTokenCount || 0, totalTokens: usage?.totalTokenCount || 0 } };
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

async function generateQuestionsDirectFromPDF(
  filePath: string,
  metadata: PDFMetadata,
  patternText?: string
): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found at: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error('File is empty (0 bytes).');
  }

  const dataBuffer = fs.readFileSync(filePath);
  const base64Data = dataBuffer.toString('base64');

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
    if (types.columnMatching > 0) parts.push(`${types.columnMatching} Column Matching questions`);
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
    ? `\n\nCUSTOM INSTRUCTIONS (HIGHEST PRIORITY — follow these carefully, they override other settings):\n${metadata.customInstructions}`
    : '';

  // Rich subject-specific guidelines that enforce quality, innovation, and proper question style
  const subjectSpecificGuidelines: { [key: string]: string } = {
    mathematics: `MATHEMATICS — QUESTION QUALITY RULES:
CRITICAL: Do NOT generate basic definition questions like "Define polynomial" or "What is a fraction?".
Instead, generate PROPER NUMERICAL & COMPUTATIONAL questions that require actual calculation.

Question Distribution:
- 50% NUMERICAL/COMPUTATIONAL: Actual math problems requiring step-by-step calculation
  Examples: "Solve: $3x^2 - 7x + 2 = 0$", "Find the area of triangle with vertices A(2,3), B(5,7), C(-1,4)"
  "Evaluate: $\\int_0^{\\pi} \\sin^2 x\\, dx$", "If $\\log_2(x-1) + \\log_2(x+3) = 5$, find $x$"
- 20% APPLICATION/WORD PROBLEMS: Real-world scenarios requiring mathematical modeling
  Examples: "A train travels 360 km. If speed increased by 20 km/h, time reduces by 1 hour. Find original speed."
- 15% PROOF/DERIVATION: Prove theorems, derive formulas, verify identities
  Examples: "Prove that $\\sqrt{3}$ is irrational", "Derive the quadratic formula"
- 10% CONCEPTUAL (but NOT definition): Questions testing deep understanding
  Examples: "Explain geometrically why $\\sin^2\\theta + \\cos^2\\theta = 1$"
- 5% MCQ: With numerical options, not "which of the following is the definition of..."

BANNED question types for Math: "Define X", "What is X?", "State the formula for X", "Write the definition of X"
REQUIRED: Every math question must involve NUMBERS, EQUATIONS, or LOGICAL REASONING.`,

    physics: `PHYSICS — QUESTION QUALITY RULES:
CRITICAL: Prioritize NUMERICAL PROBLEMS with real values and SI units.

Question Distribution:
- 50% NUMERICAL PROBLEMS: With given data, formula application, and calculated answers
  Examples: "A ball is thrown vertically upward with velocity 20 m/s. Find maximum height and time of flight. (g=10 m/s²)"
  "A 5 kg block slides down a 30° incline with μ=0.2. Find acceleration and velocity after 3 seconds."
- 20% DERIVATION: Derive expressions, prove relationships
  Examples: "Derive the expression for time period of a simple pendulum", "Derive lens maker's formula"
- 15% APPLICATION/CONCEPTUAL: Why/How questions requiring physical reasoning
  Examples: "Why does a spinning top not fall?", "Explain how a transformer works with energy conservation"
- 10% DIAGRAM-BASED: Ray diagrams, circuit diagrams, force diagrams
- 5% MCQ: With calculated numerical options

BANNED: "Define force", "What is momentum?", "State Newton's first law" as standalone questions.
REQUIRED: Numerical problems must include realistic values, proper units, and step-by-step solutions.`,

    chemistry: `CHEMISTRY — QUESTION QUALITY RULES:
CRITICAL: Balance between numerical chemistry and reaction-based questions.

Question Distribution:
- 35% NUMERICAL: Stoichiometry, molarity, pH, electrochemistry calculations
  Examples: "Calculate the mass of NaOH needed to prepare 500 mL of 0.2M solution"
  "What volume of 0.1M HCl is needed to neutralize 25 mL of 0.15M NaOH?"
- 25% REACTION & MECHANISM: Write balanced equations, predict products, explain mechanisms
  Examples: "Write the balanced equation for the reaction of ethanol with acidified potassium dichromate"
- 20% CONCEPTUAL/ANALYTICAL: Explain trends, compare properties, predict behavior
  Examples: "Explain why ionization energy increases across a period but decreases down a group"
- 10% STRUCTURE/DIAGRAM: Draw structures, orbital diagrams, crystal structures
- 10% MCQ/SHORT: Quick calculations or identification

BANNED: "Define mole", "What is an atom?" as standalone questions.
REQUIRED: Use accurate molar masses, Avogadro's number, and proper chemical notation.`,

    biology: `BIOLOGY — QUESTION QUALITY RULES:
CRITICAL: Go beyond rote memorization. Test application, analysis, and critical thinking.

Question Distribution:
- 30% ANALYTICAL: Cause-effect, compare-contrast, explain WHY
  Examples: "Compare mitosis and meiosis in terms of genetic variation and biological significance"
  "Why are antibiotics ineffective against viral infections? Explain with reference to cell structure."
- 25% APPLICATION/CASE-STUDY: Real-world biological scenarios
  Examples: "A patient shows symptoms of fatigue, weight gain, and cold intolerance. Which gland is likely affected and why?"
- 20% DIAGRAM-BASED: Label, draw, interpret diagrams
  Examples: "Draw the structure of a nephron and trace the path of urine formation"
- 15% DESCRIPTIVE (but specific): Explain processes with detail
  Examples: "Describe the light-dependent reactions of photosynthesis, including the role of NADP+ and ATP synthase"
- 10% NUMERICAL: Genetics ratios, population ecology calculations
  Examples: "In a cross between Tt × Tt pea plants, predict the phenotypic ratio of tall to short plants in F2 generation"

BANNED: "Define photosynthesis", "What is DNA?" as standalone questions.`,

    history: `HISTORY — QUESTION QUALITY RULES:
CRITICAL: Generate ANALYTICAL and INNOVATIVE questions. NOT basic recall of dates and names.

Question Distribution:
- 35% ANALYTICAL/CAUSE-EFFECT: Why did X happen? What were the consequences?
  Examples: "Analyze the economic and political factors that led to the French Revolution"
  "How did the Treaty of Versailles contribute to the rise of Nazism in Germany?"
- 25% COMPARATIVE: Compare movements, leaders, policies, eras
  Examples: "Compare the independence movements of India and South Africa in terms of methods and leadership"
  "Contrast the economic policies of capitalism and socialism as practiced in the 20th century"
- 20% SIGNIFICANCE/IMPACT: Evaluate the impact or significance of events
  Examples: "Assess the significance of the printing press in the spread of the Renaissance"
  "How did the Industrial Revolution transform social class structures in Europe?"
- 10% SOURCE-BASED/PASSAGE: Analyze a historical passage, map, or document
  Examples: "Read the following excerpt from [historical speech]. What was the speaker's main argument?"
- 10% CHRONOLOGICAL/FACTUAL: Timeline, sequence of events (but combine with analysis)
  Examples: "Arrange the following events in chronological order and explain how each led to the next"

BANNED: "Who was X?", "In which year did X happen?", "Define nationalism" as standalone questions.
REQUIRED: Every question should require THINKING, not just MEMORIZATION.`,

    english: `ENGLISH — QUESTION QUALITY RULES:
Question Distribution:
- 30% COMPREHENSION: Provide actual passages and ask inferential questions (not just "what happened")
  Examples: "Read the passage and explain the author's use of irony in paragraph 3"
- 25% LITERATURE ANALYSIS: Deep analysis of poems, prose, drama
  Examples: "How does Shakespeare use the motif of light and darkness in Romeo and Juliet?"
- 20% GRAMMAR IN CONTEXT: Transform sentences, identify errors in paragraphs, rewrite
  Examples: "Rewrite the following passage changing the voice from active to passive"
- 15% CREATIVE WRITING: Essays, letters, reports with specific prompts
- 10% VOCABULARY IN CONTEXT: Word usage, synonyms/antonyms in sentences

BANNED: "Define a noun", "What is a verb?" as standalone questions.`,

    'physical-science': `PHYSICAL SCIENCE — QUESTION QUALITY RULES:
Combine physics and chemistry approach:
- 50% NUMERICAL: Calculation-based problems with real values and units
- 20% EXPERIMENTAL: Describe experiments, predict outcomes, analyze data
- 15% CONCEPTUAL/ANALYTICAL: Explain phenomena with scientific reasoning
- 10% DIAGRAM-BASED: Draw, label, interpret scientific diagrams
- 5% MCQ with calculated answers
BANNED: Basic definitions as standalone questions. Every question should involve reasoning or calculation.`,

    'life-science': `LIFE SCIENCE — QUESTION QUALITY RULES:
- 30% ANALYTICAL: Compare processes, explain cause-effect relationships
- 25% APPLICATION: Real-world scenarios, case studies, health applications
- 20% DIAGRAM-BASED: Draw and label biological structures, explain functions
- 15% PROCESS-BASED: Describe biological processes step-by-step with detail
- 10% NUMERICAL: Genetics ratios, ecological calculations
BANNED: "Define X" as standalone questions. Always require explanation or application.`,

    geography: `GEOGRAPHY — QUESTION QUALITY RULES:
- 35% MAP/DIAGRAM-BASED: Locate, identify, mark on maps, interpret climate data
- 25% ANALYTICAL: Explain geographical phenomena, cause-effect of natural events
  Examples: "Explain how ocean currents influence the climate of Western Europe"
- 20% COMPARATIVE: Compare regions, climates, geological features
- 10% DATA INTERPRETATION: Read and analyze climate graphs, population tables
- 10% APPLICATION: How geography affects human life, resource management
BANNED: "Define latitude" style questions.`,

    economics: `ECONOMICS — QUESTION QUALITY RULES:
- 40% NUMERICAL: Demand-supply calculations, GDP, inflation, elasticity, national income
  Examples: "If price rises from ₹10 to ₹12 and demand falls from 100 to 80 units, calculate price elasticity of demand"
- 25% ANALYTICAL: Explain economic concepts with real-world examples
  Examples: "Analyze how demonetization affects the money supply in an economy"
- 20% GRAPHICAL: Draw and interpret demand-supply curves, cost curves
- 15% CASE STUDY: Real economic scenarios requiring analysis
BANNED: "Define GDP", "What is demand?" as full questions. Definitions only as sub-parts of larger questions.`,

    'computer-science': `COMPUTER SCIENCE — QUESTION QUALITY RULES:
- 40% CODE/PROGRAM: Write code, trace output, debug, complete programs
  Examples: "Write a function to check if a string is palindrome", "Trace the output of the given recursive function"
- 25% ALGORITHM/LOGIC: Design algorithms, analyze complexity, flowcharts
- 20% CONCEPTUAL (deep): Explain how things work internally (not definitions)
  Examples: "Explain how a hash table handles collisions using chaining"
- 15% MCQ/SHORT: Quick technical questions with reasoning
BANNED: "Define variable", "What is an array?" as standalone questions.`,

    'political-science': `POLITICAL SCIENCE — QUESTION QUALITY RULES:
- 40% ANALYTICAL: Analyze concepts, policies, institutions with reasoning
  Examples: "Analyze the role of judiciary in protecting fundamental rights with examples"
- 25% COMPARATIVE: Compare political systems, ideologies, constitutions
- 20% CASE-BASED: Real political scenarios requiring analysis
- 15% DESCRIPTIVE (specific): Explain specific processes, not just definitions
BANNED: "Define democracy" as a standalone question. Require analysis in every question.`,

    accountancy: `ACCOUNTANCY — QUESTION QUALITY RULES:
- 70% NUMERICAL: Journal entries, ledger posting, trial balance, final accounts, ratio analysis
  Examples: "Prepare Trading and P&L Account from the following trial balance"
- 15% PRACTICAL SCENARIOS: Real business transaction recording
- 10% THEORETICAL (specific): Explain accounting principles with examples
- 5% MCQ
REQUIRED: Every numerical must have complete data and step-by-step solution.`,

    'business-studies': `BUSINESS STUDIES — QUESTION QUALITY RULES:
- 40% CASE STUDY: Real business scenarios requiring analysis
  Examples: "Read the case and identify which management principles are being violated"
- 30% ANALYTICAL: Analyze functions, processes, strategies
- 20% COMPARATIVE: Compare management styles, marketing strategies
- 10% DESCRIPTIVE (specific)
BANNED: "Define management" as standalone questions.`,

    psychology: `PSYCHOLOGY — QUESTION QUALITY RULES:
- 40% CASE-BASED: Analyze behavioral scenarios using psychological concepts
  Examples: "A child shows aggression after watching violent TV. Explain using Bandura's Social Learning Theory"
- 25% ANALYTICAL: Compare theories, analyze experimental findings
- 20% APPLICATION: Apply concepts to real-life situations
- 15% EXPERIMENTAL: Design studies, interpret results, ethical considerations
BANNED: "Define psychology" or "Who is Freud?" as standalone questions.`,
  };

  const guidelines = subjectSpecificGuidelines[subject] || `GENERAL SUBJECT — QUESTION QUALITY RULES:
- Generate INNOVATIVE and THOUGHT-PROVOKING questions, not basic definitions
- 35% ANALYTICAL: Why/How questions requiring reasoning and critical thinking
- 25% APPLICATION: Real-world scenarios and case studies
- 20% COMPARATIVE: Compare concepts, processes, or entities
- 15% DESCRIPTIVE (specific): Explain processes with detail, not just define terms
- 5% MCQ/SHORT: Quick questions but testing understanding, not recall
BANNED: "Define X", "What is X?" as standalone questions. Every question must require THINKING.
REQUIRED: Cover ALL chapters/topics from the PDF equally.`;

  // Use enhanced directive directly in prompts
  const enhancedUniversalDirective = `
╔════════════════════════════════════════════════════════════════════════════════════════╗
║            🎯 UNIVERSAL QUESTION GENERATION STANDARDS - EXAM FOCUSED 🎯               ║
║                        ⚠️ HIGHEST PRIORITY - MUST FOLLOW ⚠️                          ║
╚════════════════════════════════════════════════════════════════════════════════════════╝

CRITICAL PRINCIPLE #1: MODERATE-TO-DIFFICULT, EXAM-IMPORTANT QUESTIONS ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✗ NEVER generate basic/brute-force level questions (e.g., "What is X?", "Define Y")
✗ NEVER generate definition-based questions as standalone questions
✗ NEVER generate trivial "memorization" or "recall" questions  
✗ NEVER generate "fill-in-the-blank" with obvious one-word answers
✗ NEVER ask questions ONLY from the first page or introduction of the textbook
✗ NEVER generate simple direct-formula-substitution questions
✓ ONLY generate questions at MODERATE to DIFFICULT level appropriate for secondary (Class 9-10) and higher secondary (Class 11-12) board exams
✓ ONLY generate questions requiring ANALYSIS, CALCULATION, REASONING, APPLICATION, MULTI-STEP THINKING
✓ ONLY generate questions that challenge students and test deep understanding
✓ ONLY generate questions that are MOST LIKELY to appear in board/competitive exams
✓ PRIORITIZE questions from EXERCISE/PRACTICE SECTIONS of the textbook (chapter-end exercises, solved examples, miscellaneous exercises)
✓ Questions should be at a level where students need to THINK and APPLY concepts, not just recall facts

DIFFICULTY DISTRIBUTION (${metadata.difficulty || 'mixed'} level):
- If EASY: 30% medium-easy, 50% medium, 20% moderate-hard
- If MEDIUM: 15% easy, 50% medium, 35% hard
- If HARD: 50% hard, 40% medium, 10% easy  
- If MIXED: 30% hard, 50% medium, 20% easy

FOR SECONDARY & HIGHER SECONDARY LEVEL:
- Questions MUST be at board-exam standard (not coaching-worksheet easy level)
- Include multi-step problems, application-based questions, and higher-order thinking
- For Math/Science: Minimum 60% numerical/computational problems requiring step-by-step solving
- For Humanities: Minimum 60% analytical/evaluative questions requiring detailed reasoning

CRITICAL PRINCIPLE #2: COMPLETE ALL-CHAPTERS COVERAGE WITH EQUAL DISTRIBUTION (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ STEP 1: First, read the ENTIRE PDF and identify ALL chapters, units, topics, or sections in the textbook
✓ STEP 2: Count the total number of chapters (N)
✓ STEP 3: Calculate questions per chapter = ceil(Total Questions / N)
✓ STEP 4: Distribute questions STRICTLY EVENLY (±1) across ALL identified chapters
✓ STEP 5: NO chapter should be left out — not even the last chapter or briefly mentioned chapters
✓ STEP 6: Include chapter/topic name in EVERY question as [Chapter X: Topic Name] label
✓ STEP 7: After generating, VERIFY: count questions per chapter and rebalance if any chapter has significantly fewer
✓ STEP 8: Questions should come from THROUGHOUT each chapter — not just the beginning of the chapter

EXAMPLE: If textbook has 8 chapters and you generate 40 questions:
- Chapter 1: 5 questions | Chapter 2: 5 questions | Chapter 3: 5 questions | Chapter 4: 5 questions
- Chapter 5: 5 questions | Chapter 6: 5 questions | Chapter 7: 5 questions | Chapter 8: 5 questions

⚠️ DISTRIBUTION VIOLATION CHECK: If any chapter has 0 questions or < (Total/N - 2) questions, you MUST regenerate to fix the imbalance.

CRITICAL PRINCIPLE #3: QUESTION SOURCE — USE EXERCISE/PRACTICE SECTIONS (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ PRIORITIZE questions from the EXERCISE/PRACTICE sections at the end of each chapter
✓ Use SOLVED EXAMPLES and WORKED EXAMPLES from within the chapter as inspiration for similar-level questions
✓ Include questions from MISCELLANEOUS exercises, ADDITIONAL problems, and REVIEW questions sections
✓ Do NOT just read the first page/introduction and generate questions from it
✓ Scan the ENTIRE chapter including end-of-chapter exercises before generating questions
✓ The most important questions are typically in: Exercise sections → Solved Examples → In-text problems → Theory
✓ For questions inspired by exercises, modify the numbers/context slightly so they are not exact copies

CRITICAL PRINCIPLE #4: QUESTION QUALITY STANDARDS (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BANNED QUESTIONS (AUTO-REJECT IF FOUND):
❌ "Define X" as standalone questions
❌ "What is X?" as full question  
❌ "State the formula for X"
❌ "Write the definition of X"
❌ "List the characteristics of X" (if only a list, not needing analysis)
❌ Basic recall questions with obvious one-word answers
❌ "Which of the following is a characteristic of..." (only list-based MCQs)
❌ Questions from ONLY the first page or introduction section
❌ Trivial fill-in-the-blank with answers directly stated in the chapter
❌ Single-step, direct formula substitution problems

REQUIRED ELEMENTS FOR EACH QUESTION:
✓ Specific, clear problem statement (no ambiguity)
✓ Sufficient data/information provided (no missing values)
✓ Real numbers not symbolic (for numerical subjects)
✓ Clear expected output (what needs to be found/shown)
✓ Multi-step reasoning or calculation required (not one-liner answers)
✓ For solutions: Full step-by-step working, intermediate calculations shown
✓ For MCQs: Plausible distractors that require actual problem-solving to eliminate
✓ Realistic and practical context where applicable
✓ Questions should test APPLICATION of concepts, not just RECALL

CRITICAL PRINCIPLE #5: SOLUTION QUALITY (MANDATORY FOR ALL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ EVERY question must have a complete solution
✓ Solutions must show ALL steps and working (not just final answer)
✓ For numerical: Show formulas, substitutions, calculations
✓ For descriptive: Provide detailed explanation with proper reasoning
✓ For proofs: Show logical steps, state theorems/principles used
✓ Solutions must be wrapped: % START SOLUTION ... % END SOLUTION
✓ Wrap in proper LaTeX: $$...$$ or \\[...\\]

═══════════════════════════════════════════════════════════════════════════════════════
`;

  const universalQualityDirective = enhancedUniversalDirective;

  const prompt = patternText
    ? `You are an expert ${subject} educator and professional LaTeX exam paper creator.

TASK: Generate a NEW exam question paper that EXACTLY replicates the structure and format described in the pattern analysis below, using ONLY content from the provided PDF textbook (attached).

${universalQualityDirective}

${guidelines}

=== QUESTION PAPER PATTERN ANALYSIS ===
${patternText}
=== END OF PATTERN ANALYSIS ===

Read the attached PDF textbook THOROUGHLY from FIRST page to LAST page — identify ALL chapters, units, and sections. Pay special attention to:
- EXERCISE/PRACTICE sections at the end of each chapter
- Solved Examples and Worked Examples within chapters
- Miscellaneous Exercises and Review Questions
- Important theorems, derivations, and application problems

Generate questions covering ALL chapters/topics, distributed STRICTLY EVENLY across the entire textbook. Questions should be at MODERATE to DIFFICULT level — the kind that actually appear in board exams and competitive tests, NOT basic recall questions.${customInstructionsSection}

GENERATION RULES:
1. Create a COMPLETE, compilable LaTeX document (\\documentclass through \\end{document})
2. QUESTION-BY-QUESTION TYPE MATCHING: For every question in the pattern, generate the SAME type at the SAME position
3. Match the pattern's structure EXACTLY: sections, question counts, marks distribution
4. Generate NEW, INNOVATIVE questions INSPIRED BY the exercise/practice sections of the textbook — do NOT copy pattern questions
5. Difficulty level: ${difficulty} (but NEVER below moderate for secondary/higher-secondary)
6. **MANDATORY**: Distribute questions EQUALLY across ALL chapters/topics. If the textbook has N chapters, each chapter MUST have approximately (Total Questions / N) questions. No chapter should have 0 questions.
7. **PRIORITY SOURCE**: Questions should primarily come from exercise sections, solved examples, and important problems — NOT from introductory paragraphs or definitions on the first page.
8. For EVERY question, include a solution wrapped in:
   % START SOLUTION
   [Step-by-step solution with detailed working]
   % END SOLUTION
8. Use proper LaTeX: amsmath, amssymb, geometry, enumitem, fancyhdr
9. Use $...$ for inline math, \\[...\\] for display math
10. For MCQs: use (a)(b)(c)(d) format with plausible distractors
11. For fill-in-blanks: use \\underline{\\hspace{3cm}}
12. For Column Matching: use LaTeX tabular with shuffled Column B

IMPORTANT: Output ONLY the complete LaTeX document. No markdown, no explanations, no code fences.`
    : `You are an expert ${subject} educator and LaTeX document formatter.

${universalQualityDirective}

${guidelines}

Read the attached PDF textbook THOROUGHLY from FIRST page to LAST page. 

STEP 1: Identify ALL chapters, units, and sections in the textbook.
STEP 2: For EACH chapter, read the EXERCISE/PRACTICE section at the end, plus any Solved Examples.
STEP 3: Generate questions primarily INSPIRED BY the exercises, practice problems, and solved examples from EVERY chapter.

Then generate high-quality ${subject} questions covering ALL chapters with STRICT EQUAL DISTRIBUTION.${questionBreakdown}${customInstructionsSection}

Question Requirements:
- Question types: ${questionTypeDesc}
- Difficulty level: ${difficulty} (MINIMUM moderate level for secondary/higher-secondary students)
- **MANDATORY EQUAL DISTRIBUTION**: If the textbook has N chapters, each chapter MUST have approximately (Total Questions / N) questions. Every single chapter must be represented. Verify this before outputting.
- **EXERCISE PRIORITY**: At least 70% of questions should be inspired by or similar to exercise/practice section problems. The remaining 30% can come from solved examples and important in-text problems.
- Each question should be INNOVATIVE, EXAM-STANDARD, and MODERATE-TO-DIFFICULT — not basic recall or first-page definitions
- Do NOT generate questions only from the beginning of the book — cover ALL chapters including the last ones
- Provide detailed step-by-step solutions with full working

Format your response ENTIRELY in LaTeX using this structure:

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

\\begin{center}
{\\Large \\textbf{EXAMINATION PAPER}}\\\\[0.3cm]
{\\large \\textbf{Subject: ${subject.charAt(0).toUpperCase() + subject.slice(1)}}}\\\\[0.2cm]
{\\textbf{Difficulty Level: ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}}}\\\\[0.2cm]
\\rule{\\textwidth}{0.4pt}
\\end{center}

\\vspace{0.3cm}

\\noindent\\fbox{\\parbox{\\dimexpr\\textwidth-2\\fboxsep-2\\fboxrule}{
\\textbf{INSTRUCTIONS TO CANDIDATES:}\\\\[0.2cm]
\\begin{itemize}[leftmargin=*, itemsep=0pt]
\\item Read all questions carefully before attempting.
\\item Show all working for full credit.
\\item Marks for each question are indicated in brackets.
\\end{itemize}
}}

\\vspace{0.5cm}
\\section*{QUESTIONS}

[Generate each question as:
\\subsection*{Question N [X marks]}
[Question text]

% START SOLUTION
\\subsection*{Solution}
[Detailed solution]
% END SOLUTION

\\vspace{0.5cm}
]

\\end{document}

CRITICAL FORMATTING:
- Use \\subsection*{Question N [X marks]} for each question
- Wrap EVERY solution with % START SOLUTION and % END SOLUTION
- Use $...$ for inline math, $$...$$ for display math
- For MCQs: (a), (b), (c), (d) format
- For Fill in Blanks: \\underline{\\hspace{3cm}}
- For Column Matching: LaTeX tabular with shuffled Column B
- Number questions consecutively starting from 1

IMPORTANT: Output ONLY the complete LaTeX document. No markdown, no code fences.`;

  console.log(`Sending PDF directly to Gemini for question generation (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Question generation timed out. Try with a smaller PDF or fewer questions.')), 240000);
  });

  const result = await Promise.race([
    model.generateContent([
      { inlineData: { mimeType: 'application/pdf', data: base64Data } },
      { text: prompt }
    ]),
    timeoutPromise
  ]);

  const response = await result.response;
  const responseText = response.text();
  
  const usage = response.usageMetadata;
  console.log(`Direct PDF generation complete. Response length: ${responseText.length}. Tokens: ${usage?.totalTokenCount || 'N/A'}`);

  if (!responseText || responseText.trim().length === 0) {
    throw new Error('Gemini returned empty response');
  }

  return {
    text: responseText,
    tokens: {
      promptTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
      totalTokens: usage?.totalTokenCount || 0
    }
  };
}

async function generateQuestionsWithGemini(
  pdfText: string,
  metadata: PDFMetadata,
  patternText?: string
): Promise<ExtractionResult> {
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
🎯 MATHEMATICS - EXAM-FOCUSED QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. DIFFICULTY FOCUS (IMPORTANT TOPICS FROM EXAM PAPERS):
   ⭐ PRIORITY: Generate questions on topics that frequently appear in board/competitive exams
   ⭐ High-weightage topics: Ensure at least 40% of questions from these
   ⭐ Application problems: Minimum 20% of questions
   ⭐ Proof/derivation questions: At least 15%

2. TOPIC COVERAGE - EQUAL WEIGHTAGE:
   - Analyze ALL chapters/units in the provided content
   - Distribute questions EQUALLY across ALL chapters
   - Each chapter gets approximately (Total Questions ÷ Number of Chapters)
   - Never skip any chapter, even if briefly covered

3. QUESTION DIFFICULTY APPROPRIATE TO LEVEL:
   - Include challenging multi-step problems requiring multiple concepts
   - Avoid trivial single-formula application
   - At least 30% should be "hard" or "very hard" level
   - Progressively more challenging as questions increase

4. NUMERICAL QUESTIONS (MANDATORY ELEMENT):
   - Minimum 50% of questions must include actual numbers/calculations
   - Use realistic values relevant to real-world contexts
   - Step-by-step working with intermediate calculations
   - Clear numerical answers with appropriate precision

5. EXAM-STANDARD QUESTION TYPES:
   ✓ Multi-step numerical problems
   ✓ Proofs of theorems or identities
   ✓ Derivations of formulas
   ✓ Application-based word problems requiring modeling
   ✓ Problems requiring multiple concepts (NOT single concept)

EXAMPLES OF EXAM-STANDARD QUESTIONS:
✅ "Solve the quadratic equation $2x^2 - 7x + 3 = 0$ and verify your solution."
✅ "Find the sum of the series $2 + 4 + 8 + ... + 256$. Also find the general term."
✅ "A rectangular plot has perimeter 60m. If length is 6m more than width, find area. Also find length of diagonal."
✅ "Prove that $\\sin^2A + \\cos^2A = 1$ using the Pythagorean theorem."
✅ "Find $\\lim_{x\\to 2} \\frac{x^3 - 8}{x^2 - 4}$ and explain your method."
`,
    physics: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚛️ PHYSICS - EXAM-FOCUSED QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EQUAL CHAPTER DISTRIBUTION:
   - Cover all chapters equally (Mechanics, Thermodynamics, Optics, etc.)
   - Each chapter should have proportional questions
   
2. FOCUS ON EXAM-IMPORTANT TOPICS:
   - 50%+ Numerical problems with REAL values and SI units
   - 25% Derivations and theoretical proofs
   - 15% Conceptual/Analysis questions
   - 10% Diagram-based or experimental questions

3. NUMERICAL PROBLEMS (CRITICAL):
   - Realistic values with proper SI units
   - Multi-step calculation required (not one-line answers)
   - Include intermediate calculations and formulas
   - Final answer with correct significant figures and units
   - Problems combining 2-3 concepts, not just single formula

4. CHALLENGING PROBLEM CHARACTERISTICS:
   - Requires understanding of physical principles
   - Not just direct formula substitution
   - Real-world contexts
   - At least 30% should require multiple steps or combined concepts

5. EXAM-STANDARD EXAMPLES:
   ✅ "A projectile is launched at 45° with initial velocity 20 m/s. Calculate max height, range, and time of flight. (g=10 m/s²)"
   ✅ "A hot water sphere cools from 80°C to 30°C in 10 minutes. Using Newton's law of cooling (T=T₀ + (T₁-T₀)e^(-kt)), find the temperature after 5 more minutes."
   ✅ "An object with specific heat 400 J/kg°C gains 24000 J energy. Its mass is 5 kg. Find temperature change and final temperature if initial is 20°C."
`,
    chemistry: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 CHEMISTRY - EXAM-FOCUSED QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EQUAL CHAPTER DISTRIBUTION:
   - Organic, Inorganic, Physical Chemistry - equal weightage
   - Cover all chapters/units equally
   
2. EXAM-FOCUSED DISTRIBUTION:
   - 40% Numerical calculations (stoichiometry, molarity, pH, redox, equilibrium)
   - 30% Reactions, balancing equations, mechanisms  
   - 20% Structure, naming, properties
   - 10% Experimental procedures and analysis

3. NUMERICAL PRECISION (MANDATORY):
   - Accurate molar masses and Avogadro's number
   - Show dimensional analysis
   - Step-by-step calculations with units
   - Real-world chemical quantities

4. CHALLENGING PROBLEM FOCUS:
   - Multi-step stoichiometry problems
   - Problems requiring concept combination
   - NOT simple one-step calculations
   - Include limiting reagent concepts where applicable

5. EXAM-STANDARD EXAMPLES:
   ✅ "25 mL of 0.2M HCl is titrated with NaOH solution. 20 mL of NaOH is required for complete neutralization. Calculate molarity of NaOH and mass of NaOH in the flask."
   ✅ "For the reaction 2A + 3B → 4C, starting with 5 mol A and 8 mol B, identify limiting reagent and calculate: (i) moles of C formed (ii) moles of B remaining"
`,
    biology: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧬 BIOLOGY - EXAM-FOCUSED QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. EQUAL CHAPTER DISTRIBUTION:
   - Cover all chapters/units equally (Cell Biology, Genetics, Ecology, Botany, Zoology)
   - Each chapter gets proportional questions
   - No chapter left behind

2. EXAM-FOCUSED QUESTION DISTRIBUTION:
   - 40% Analytical/Application (case studies, explain mechanisms, predict outcomes)
   - 25% Diagram-based (draw structures, label parts, trace processes)
   - 20% Descriptive (explain processes, compare, differentiate)
   - 10% Numerical (genetics ratios, population ecology calculations)
   - 5% Direct definition (only as sub-parts, not standalone)

3. CHALLENGING QUESTION CHARACTERISTICS:
   - Multi-step reasoning required
   - Combines multiple concepts
   - Requires critical thinking, not just memorization
   - Real-world biological scenarios
   - NOT simple "define" or "list" questions

4. EXAM-STANDARD EXAMPLES:
   ✅ "A cross between Tt (tall) and tt (short) pea plants produces F1 offspring. Among 100 F1 plants, 48 are tall. Explain why. What is the genotype ratio?"
   ✅ "Compare mitosis and meiosis with respect to genetic variation, chromosome number change, and biological significance."
   ✅ "In an ecosystem with 10,000 J energy at grass level, only 100 J reaches carnivores. Explain with the concept of energy transfer."
`,
    history: `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📜 HISTORY - EXAM-FOCUSED QUESTION GENERATION GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. CHRONOLOGICAL & THEMATIC BALANCE:
   - Equal coverage across all time periods (Ancient, Medieval, Modern)
   - Cover all major themes/units equally
   - No period or unit neglected

2. EXAM-FOCUSED DISTRIBUTION:
   - 45% Analytical/Cause-Effect (analyze factors, consequences, significance)
   - 25% Comparative (compare movements, leaders, policies, impacts)
   - 15% Descriptive (describe events with specificity, NOT just dates/names)
   - 10% Factual/Chronological (dates, sequences combined with analysis)
   - 5% Source-based (analyze documents, speeches)

3. CHALLENGING CHARACTERISTICS:
   - Requires critical analysis, NOT memorization
   - Multi-part questions testing different aspects
   - Connects historical events to their impacts
   - NOT single-word answers
   - Demands historical reasoning

4. EXAM-STANDARD EXAMPLES:
   ✅ "Analyze the economic and political factors that led to French Revolution. How did these factors specifically contribute to the overthrow of monarchy?"
   ✅ "Compare the independence movements of India and South Africa: (a) Methods used (b) Key leaders (c) International support received (d) Post-independence challenges"
   ✅ "How did the Treaty of Versailles contribute to the rise of fascism in Germany? Explain with specific examples."
   ❌ AVOID: "In which year did X happen?" or "Who was X?"
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
2. QUESTION-BY-QUESTION TYPE MATCHING (CRITICAL):
   - For every question number in the pattern, the generated question at that SAME position MUST be the SAME TYPE.
   - If pattern Q1(a) is MCQ → generated Q1(a) MUST be MCQ
   - If pattern Q1(b) is Numerical → generated Q1(b) MUST be Numerical
   - If pattern Q1(c) is True/False → generated Q1(c) MUST be True/False
   - If pattern Q2(c) is Column Matching → generated Q2(c) MUST be Column Matching
   - If pattern Q3 is a Long-Answer with proof → generated Q3 MUST be a Long-Answer with proof
   - This applies to EVERY question and EVERY sub-part. No exceptions.
3. Match the pattern's structure EXACTLY: same sections, same number of questions per section, same marks distribution
4. Replicate the pattern's formatting: same numbering style, same marks display format, same header/instruction layout
5. Generate NEW questions primarily INSPIRED BY exercise/practice sections, solved examples, and important problems from the textbook content — do NOT copy the sample questions from the pattern
6. Match the difficulty level: ${difficulty} (MINIMUM moderate level for secondary/higher-secondary students — no basic recall questions)
7. Distribute questions STRICTLY EVENLY across all chapters/topics in the textbook content. If N chapters exist, each chapter gets approximately (Total Questions / N) questions. No chapter should have 0 questions.
8. **EXERCISE PRIORITY**: At least 70% of questions should be inspired by exercise/practice section problems from the textbook, not introductory text.
8. For EVERY question, include a solution wrapped in markers:
   % START SOLUTION
   [Step-by-step solution]
   % END SOLUTION
9. Use proper LaTeX packages: amsmath, amssymb, geometry, enumitem, fancyhdr
10. Use $...$ for inline math and \\[...\\] or $$...$$ for display math
11. For MCQs: use the exact option format from the pattern (e.g., (a)(b)(c)(d))
12. For fill-in-blanks: use \\underline{\\hspace{3cm}}
13. For True/False: state a clear declarative statement and ask if it's True or False
14. For Column Matching: use a LaTeX tabular with Column A and Column B. Shuffle Column B so answers don't align directly. Solution should list correct pairs.
15. For Assertion-Reason: follow the exact assertion-reason format from the pattern
16. For Numerical: include actual calculations with numbers and units

IMPORTANT: Output ONLY the complete LaTeX document. No markdown, no explanations, no code fences.`
    : `You are an expert ${subject} educator and LaTeX document formatter.

Content:
${pdfText}

IMPORTANT: Read the ENTIRE content above carefully. Pay special attention to:
- EXERCISE/PRACTICE sections at the end of each chapter (these are your PRIMARY source for questions)
- Solved Examples and Worked Examples within each chapter
- Miscellaneous Exercises and Review Questions
- Important theorems, derivations, and application problems from ALL chapters

Please generate high-quality, MODERATE-TO-DIFFICULT level ${subject} questions based on this content.${questionBreakdown}

Question Requirements:
- Question types: ${questionTypeDesc}
- Difficulty level: ${difficulty} (MINIMUM moderate level — questions must require multi-step thinking, analysis, or calculation)
- **MANDATORY EQUAL DISTRIBUTION**: Distribute questions STRICTLY EVENLY across ALL chapters/topics. If N chapters exist, each chapter gets approximately (Total Questions / N) questions. Every chapter MUST be represented.
- **EXERCISE PRIORITY**: At least 70% of questions should be inspired by exercise/practice section problems. Do NOT generate questions only from chapter introductions or the first page.
- Each question should be exam-standard, challenging, and test deep understanding — NOT basic definitions or recall
- Provide detailed step-by-step solutions with full working
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
  
  const usage = response.usageMetadata;
  console.log(`Received response from Gemini. Length: ${responseText.length}. Tokens: ${usage?.totalTokenCount || 'N/A'}`);
  
  if (!responseText || responseText.trim().length === 0) {
    throw new Error('Gemini returned empty response');
  }
  
  return { text: responseText, tokens: { promptTokens: usage?.promptTokenCount || 0, outputTokens: usage?.candidatesTokenCount || 0, totalTokens: usage?.totalTokenCount || 0 } };
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

        // DIRECT PDF-to-Gemini: Send PDF directly to Gemini for question generation
        // This is faster and more accurate than extracting text first
        const tokenStats = { extraction: { promptTokens: 0, outputTokens: 0, totalTokens: 0 }, pattern: { promptTokens: 0, outputTokens: 0, totalTokens: 0 }, generation: { promptTokens: 0, outputTokens: 0, totalTokens: 0 }, total: { promptTokens: 0, outputTokens: 0, totalTokens: 0 } };

        let latexContent = '';
        let patternText: string | undefined;

        try {
          // If pattern file is provided, analyze its structure first
          if (patternFilePath) {
            console.log('Analyzing pattern PDF structure...');
            const patternResult = await withRetry(
              () => extractPatternStructure(patternFilePath),
              { maxRetries: 2, baseDelay: 4000, label: 'pattern-analysis' }
            );
            patternText = patternResult.text;
            tokenStats.pattern = patternResult.tokens;
            console.log('Pattern analysis complete. Length:', patternText.length);

            // Small delay to avoid rate limits after pattern analysis
            console.log('Waiting 2s before generation to avoid rate limits...');
            await delay(2000);
          }

          // Send PDF directly to Gemini with the question generation prompt
          console.log('Sending PDF directly to Gemini for question generation...');
          const genResult = await withRetry(
            () => generateQuestionsDirectFromPDF(filePath, metadata, patternText),
            { maxRetries: 1, baseDelay: 5000, label: 'direct-pdf-generation' }
          );
          latexContent = genResult.text;
          tokenStats.generation = genResult.tokens;
        } catch (geminiError: any) {
          console.error('Gemini API error:', geminiError);
          const msg = geminiError.message || 'Unknown error';

          // Clean up files on error
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          if (patternFilePath && fs.existsSync(patternFilePath)) fs.unlinkSync(patternFilePath);

          if (msg.includes('rate') || msg.includes('quota') || msg.includes('429')) {
            return res.status(429).json({ error: 'AI service rate limit reached. Please wait a minute and try again.' });
          }
          if (msg.includes('timed out') || msg.includes('timeout')) {
            return res.status(504).json({ error: 'Question generation timed out. Try with a smaller textbook PDF.' });
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

        // Calculate totals
        tokenStats.total = {
          promptTokens: tokenStats.extraction.promptTokens + tokenStats.pattern.promptTokens + tokenStats.generation.promptTokens,
          outputTokens: tokenStats.extraction.outputTokens + tokenStats.pattern.outputTokens + tokenStats.generation.outputTokens,
          totalTokens: tokenStats.extraction.totalTokens + tokenStats.pattern.totalTokens + tokenStats.generation.totalTokens,
        };
        console.log('Total token usage:', JSON.stringify(tokenStats.total));

        return res.status(200).json({
          success: true,
          latex: latexContent,
          tokenUsage: tokenStats,
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
