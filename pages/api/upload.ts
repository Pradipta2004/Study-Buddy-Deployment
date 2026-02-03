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
  maxDuration: 600, // 10 minutes for Gemini processing
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

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: base64Data
        }
      },
      {
        text: `Extract all text content from this PDF document. Return ONLY the extracted text without any additional commentary, formatting, or explanations. Preserve the structure and order of the text as it appears in the document.`
      }
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
    ? `\n\n=== CRITICAL: QUESTION PAPER PATTERN TO REPLICATE EXACTLY ===\n\n${patternText}\n\n=== END OF PATTERN ===\n\nYOU MUST ANALYZE AND REPLICATE THIS PATTERN PRECISELY:\n\n1. STRUCTURE ANALYSIS:\n   - Identify all section divisions (Section A, B, C, etc.)\n   - Note the exact numbering format (Q.1, Question 1, 1., etc.)\n   - Observe spacing between questions\n   - Identify header/footer format\n\n2. MARK DISTRIBUTION:\n   - Count questions in each mark category\n   - Note how marks are indicated [X marks], (X), etc.\n   - Match the total marks and time duration\n\n3. QUESTION FORMAT:\n   - Replicate the exact question phrasing style\n   - Match MCQ format: (a), (b), (c), (d) OR A., B., C., D.\n   - Use same indentation and spacing\n   - Copy the instruction format exactly\n\n4. LAYOUT ELEMENTS:\n   - Replicate header boxes and borders\n   - Match font styles (\\\\textbf, \\\\large, etc.)\n   - Use same page margins and geometry\n   - Include any tables, rules, or decorative elements\n\n5. CONTENT STYLE:\n   - Match the difficulty level shown in pattern\n   - Use similar language and terminology\n   - Keep question lengths comparable\n   - Maintain same level of detail\n\nYOUR GENERATED OUTPUT MUST BE VISUALLY AND STRUCTURALLY INDISTINGUISHABLE FROM THE PATTERN.`
    : '';

  const prompt = `
You are an expert ${subject} educator and LaTeX document formatter.

${patternSection ? '>>> PRIORITY 1: PATTERN MATCHING <<<\n' + patternSection + '\n\n>>> PRIORITY 2: CONTENT SOURCE <<<\n' : ''}Content:
${pdfText}
${patternSection ? '' : '\n\nPlease generate high-quality ' + subject + ' questions based on this content.' + questionBreakdown}

${patternText ? '\n\n>>> GENERATION INSTRUCTIONS <<<\n\nYou MUST:\n1. Extract the EXACT LaTeX structure from the pattern above\n2. Keep ALL formatting elements: \\\\documentclass, \\\\usepackage, \\\\geometry, headers, footers, boxes, tables, rules\n3. Maintain the EXACT question numbering and section format\n4. Match the mark distribution precisely\n5. Generate NEW questions (from the content PDF) that fit this EXACT format\n6. Use the same spacing, fonts, and layout\n7. WRAP EVERY SOLUTION in specific markers: Put "% START SOLUTION" before the solution starts and "% END SOLUTION" after it ends.\n   - If the pattern has solutions, use the EXACT visual format found in the pattern inside these markers.\n   - If the pattern DOES NOT have solutions, you MUST generate them anyway using this format inside the markers:\n     \\subsection*{Solution}\n     [Step-by-step solution content]\n\nYour output should be ready-to-compile LaTeX that looks IDENTICAL to the pattern but with new questions from the content.' : 'Question Requirements:\n- Question types: ' + questionTypeDesc + '\n- Difficulty level: ' + difficulty + '\n- Each question should be clear and well-formatted\n- Provide detailed step-by-step solutions\n- Use proper LaTeX notation for all mathematical expressions' + customInstructionsSection + '\n\nFormat your response ENTIRELY in LaTeX using this EXACT structure for a proper exam paper:'}

${patternSection ? '' : '\n\\documentclass[12pt,a4paper]{article}\n\\usepackage{amsmath}\n\\usepackage{amssymb}\n\\usepackage{geometry}\n\\usepackage{enumitem}\n\\usepackage{fancyhdr}\n\\usepackage{graphicx}\n\\geometry{margin=0.75in, top=1in, bottom=1in}\n\n\\pagestyle{fancy}\n\\fancyhf{}\n\\fancyhead[L]{\\textbf{' + subject.charAt(0).toUpperCase() + subject.slice(1) + ' Examination}}\n\\fancyhead[R]{\\textbf{Page \\thepage}}\n\\fancyfoot[C]{\\small All questions carry marks as indicated}\n\n\\begin{document}\n\n% Header Section\n\\begin{center}\n{\\Large \\textbf{EXAMINATION PAPER}}\\\\[0.3cm]\n{\\large \\textbf{Subject: ' + subject.charAt(0).toUpperCase() + subject.slice(1) + '}}\\\\[0.2cm]\n{\\textbf{Difficulty Level: ' + difficulty.charAt(0).toUpperCase() + difficulty.slice(1) + '}}\\\\[0.2cm]\n\\rule{\\textwidth}{0.4pt}\n\\end{center}\n\n\\vspace{0.3cm}\n\n% Instructions Box\n\\noindent\\fbox{\\parbox{\\dimexpr\\textwidth-2\\fboxsep-2\\fboxrule}{\n\\textbf{INSTRUCTIONS TO CANDIDATES:}\\\\[0.2cm]\n\\begin{itemize}[leftmargin=*, itemsep=0pt]\n\\item Read all questions carefully before attempting.\n\\item Answer all questions in the space provided or on separate sheets.\n\\item Show all working for full credit.\n\\item Marks for each question are indicated in brackets.\n\\item Use of calculator is permitted (if applicable).\n' + (questionBreakdown ? '\\item ' + questionBreakdown.replace(/\n/g, '\n\\item ').replace('1 Mark Questions:', '\\textbf{Section A:} 1 Mark Questions').replace('Questions by Marks:', '\\textbf{Section B:} Higher Mark Questions') : '') + '\n\\end{itemize}\n}}\n\n\\vspace{0.5cm}\n\n% Questions Section\n\\section*{QUESTIONS}\n\n[Now generate each question using this EXACT format:\n\n\\subsection*{Question 1 [X marks]}\n[Question text with proper LaTeX math formatting]\n\n% START SOLUTION\n\\subsection*{Solution}\n[Detailed solution with step-by-step explanation]\n% END SOLUTION\n\n\\vspace{0.5cm}\n\nRepeat for all questions, ensuring proper numbering and mark allocation.]\n\n\\end{document}\n\nCRITICAL FORMATTING REQUIREMENTS:\n- Use \\subsection*{Question N [X marks]} for each question header\n- Use \\subsection*{Solution} for each solution\n- Wrap EVERY solution with % START SOLUTION and % END SOLUTION comments\n- Use $...$ for inline math and $$...$$ or \\[...\\] for display math\n- For MCQs: Use (a), (b), (c), (d) format\n- For Fill in Blanks: Use \\underline{\\hspace{3cm}} for blanks\n- Add \\vspace{0.5cm} between questions for spacing\n- Make questions relevant to the provided content\n- STRICTLY follow the custom instructions if provided\n- Number questions consecutively starting from 1'}
`;

  console.log('Sending request to Gemini API...');
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Gemini API request timed out after 9 minutes')), 540000);
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

        // Extract text from PDF
        console.log('Extracting text from PDF...');
        const pdfText = await extractTextFromPDF(filePath);
        console.log('PDF text extraction complete. Length:', pdfText.length);

        if (!pdfText.trim()) {
          // Clean up uploaded files
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          if (patternFilePath && fs.existsSync(patternFilePath)) {
            fs.unlinkSync(patternFilePath);
          }
          return res.status(400).json({ error: 'Could not extract text from PDF' });
        }

        // Extract pattern text if pattern file provided
        let patternText: string | undefined;
        if (patternFilePath) {
          try {
            console.log('Extracting pattern text...');
            patternText = await extractTextFromPDF(patternFilePath);
            console.log('Pattern text extraction complete. Raw length:', patternText.length);
            
            if (!patternText || patternText.trim().length === 0) {
               throw new Error('Pattern PDF contains no selectable text. If this is a scanned document/image, please convert it to a searchable PDF (OCR) first.');
            }

            // Clean pattern text to remove OCR artifacts and comment lines
            if (patternText) {
              patternText = patternText
                .split('\n')
                .filter(line => {
                  const trimmed = line.trim();
                  // Remove lines that are just comments or metadata
                  if (trimmed.startsWith('%')) return false;
                  if (trimmed.match(/^(For|Adjusted|No rule|Rule at|Small space|Clear all|To fit|Apply|Various|Custom list)/i)) return false;
                  // Keep meaningful content
                  return trimmed.length > 0;
                })
                .join('\n')
                .trim();
              
              console.log('Pattern text cleaned. Length:', patternText.length);
            }
          } catch (error: any) {
            console.error('Error extracting pattern text:', error);
            // Re-throw valid errors so the user knows why their pattern failed
            throw new Error(`Failed to process Pattern PDF: ${error.message}`);
          }
        }

        // Generate questions using Gemini
        let latexContent = '';
        try {
          // Truncate large inputs to avoid prompt-size/model-limit failures (common with big PDFs + pattern PDFs)
          const MAX_CONTENT_CHARS = 150000; // content PDF text
          const MAX_PATTERN_CHARS = 60000; // pattern PDF text (structure cues only)

          const contentForPrompt = truncateForPrompt(pdfText, MAX_CONTENT_CHARS, 'CONTENT');
          const patternForPrompt = patternText
            ? truncateForPrompt(patternText, MAX_PATTERN_CHARS, 'PATTERN')
            : null;

          console.log(
            `Sending to Gemini: content ${contentForPrompt.text.length}/${contentForPrompt.originalLength}` +
              (contentForPrompt.truncated ? ' (truncated)' : '') +
              `, pattern ${patternForPrompt ? `${patternForPrompt.text.length}/${patternForPrompt.originalLength}` : 0}` +
              (patternForPrompt?.truncated ? ' (truncated)' : '')
          );

          latexContent = await generateQuestionsWithGemini(
            contentForPrompt.text,
            metadata,
            patternForPrompt ? patternForPrompt.text : undefined
          );
        } catch (geminiError: any) {
          console.error('Gemini API error:', geminiError);
          throw new Error(`AI generation failed: ${geminiError.message || 'Unknown error'}`);
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
